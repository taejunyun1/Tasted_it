import { isWithdrawnEmail } from "../auth/withdraw";
import { assertMemberAccess } from "../auth/member-access.server";
import { createDb } from "../../db/client.server";

export type AdminJson = null | boolean | number | string | AdminJson[] | { [key: string]: AdminJson };
export const ADMIN_OPERATION_POLICY = {
  OPERATIONAL_ALERT_RESOLVE: { maxCount: 1, recentAuth: true },
  PUBLIC_SYNC_CONTROL: { maxCount: 1, recentAuth: true },
  CSV_IMPORT: { maxCount: 200, recentAuth: true },
  RATING_RECOMPUTE: { maxCount: 1, recentAuth: false },
  RATING_JOB_CONTROL: { maxCount: 1, recentAuth: true },
  INTEGRITY_CASE_TRANSITION: { maxCount: 1, recentAuth: true },
  VOTE_INVALIDATE: { maxCount: 1, recentAuth: true },
  ADMIN_ROLE_CHANGE: { maxCount: 1, recentAuth: true },
  ADMIN_SESSIONS_REVOKE: { maxCount: 1, recentAuth: true },
  TEMP_PUBLISH: { maxCount: 100, recentAuth: true },
  TEMP_UNPUBLISH: { maxCount: 100, recentAuth: true },
  MEMBER_ACCESS_CHANGE: { maxCount: 1, recentAuth: true },
  REVIEWER_ADMIN_CHANGE: { maxCount: 25, recentAuth: true },
  STUDENT_ADMIN_CHANGE: { maxCount: 25, recentAuth: true },
  PLACE_ADMIN_CHANGE: { maxCount: 1, recentAuth: true },
} as const;
export type AdminOperationKind = keyof typeof ADMIN_OPERATION_POLICY;
type Caller = { actorUserId: string; sessionId: string; now: string };
export type AdminOperationInput = Caller & { operationId: string; kind: AdminOperationKind };
export type AdminOperationSummary = { title: string; count: number };
export type AdminOperation = {
  id: string; kind: AdminOperationKind; payload: AdminJson; summary: AdminOperationSummary;
  status: "PENDING" | "COMMITTED"; result: AdminJson; expiresAt: string;
};
type StoredOperation = {
  id: string; kind: AdminOperationKind; actor_user_id: string; session_id: string | null;
  payload_json: string | null; payload_hash: string; summary_json: string;
  requires_recent_auth: number; status: "PENDING" | "COMMITTED"; result_json: string | null; expires_at: string;
};
const TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();
function fail(code: string): never { throw new Error(code); }
function validCaller(input: Caller) {
  if (!input.actorUserId || input.actorUserId.length > 128 || !input.sessionId || input.sessionId.length > 256
    || !Number.isFinite(Date.parse(input.now)) || new Date(input.now).toISOString() !== input.now) fail("ADMIN_OPERATION_INPUT_INVALID");
}
function canonical(value: unknown, limit: number): string {
  let nodes = 0;
  const walk = (item: unknown, depth: number): AdminJson => {
    if (++nodes > 30_000 || depth > 12) fail("ADMIN_OPERATION_INPUT_INVALID");
    if (item === null || typeof item === "boolean" || typeof item === "string") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map((v) => walk(v, depth + 1));
    if (!item || typeof item !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail("ADMIN_OPERATION_INPUT_INVALID");
    const result: Record<string, AdminJson> = Object.create(null);
    for (const key of Object.keys(item).sort()) {
      if (/password|secret|token|cookie|authorization|credential|salt|^__proto__$|^constructor$|^prototype$/i.test(key)) fail("ADMIN_OPERATION_INPUT_INVALID");
      result[key] = walk((item as Record<string, unknown>)[key], depth + 1);
    }
    return result;
  };
  const encoded = JSON.stringify(walk(value, 0));
  if (encoder.encode(encoded).byteLength > limit) fail("ADMIN_OPERATION_INPUT_INVALID");
  return encoded;
}
async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function assertCaller(database: D1Database, input: Caller, recent = false) {
  validCaller(input);
  const row = await database.prepare("SELECT u.role,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.expires_at>?")
    .bind(input.sessionId, input.actorUserId, input.now).first<{ role: string; email: string }>();
  if (!row || row.role !== "ADMIN" || isWithdrawnEmail(row.email)) fail("ADMIN_REQUIRED");
  await assertMemberAccess(createDb(database), input.actorUserId, input.now);
  if (recent && !await database.prepare("SELECT session_id FROM admin_session_assurances WHERE session_id=? AND actor_user_id=? AND verified_at<=? AND expires_at>?")
    .bind(input.sessionId, input.actorUserId, input.now, input.now).first()) fail("ADMIN_RECENT_AUTH_REQUIRED");
}
function policy(kind: AdminOperationKind) {
  if (!Object.hasOwn(ADMIN_OPERATION_POLICY, kind)) fail("ADMIN_OPERATION_INPUT_INVALID");
  return ADMIN_OPERATION_POLICY[kind];
}
export async function prepareAdminOperation(database: D1Database, input: Caller & {
  kind: AdminOperationKind; payload: unknown; summary: AdminOperationSummary;
}) {
  await assertCaller(database, input);
  const rule = policy(input.kind);
  if (!input.summary || typeof input.summary.title !== "string" || !input.summary.title.trim() || input.summary.title.length > 120
    || !Number.isSafeInteger(input.summary.count) || input.summary.count < 1 || input.summary.count > rule.maxCount) fail("ADMIN_OPERATION_INPUT_INVALID");
  const payload = canonical(input.payload, 2 * 1024 * 1024), summary = canonical(input.summary, 8192);
  const operationId = crypto.randomUUID(), expiresAt = new Date(Date.parse(input.now) + TTL_MS).toISOString();
  // Only expired, never-committed previews are discarded; receipts and audit stay.
  await database.prepare("DELETE FROM admin_operations WHERE id IN (SELECT id FROM admin_operations WHERE status='PENDING' AND expires_at<=? LIMIT 50)").bind(input.now).run();
  try {
    await database.prepare("INSERT INTO admin_operations(id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(operationId, input.kind, input.actorUserId, input.sessionId, payload, await digest(payload), summary, rule.recentAuth ? 1 : 0, input.now, expiresAt).run();
  } catch (error) {
    if (String(error).includes("ADMIN_OPERATION_LIMIT")) fail("ADMIN_OPERATION_LIMIT");
    if (String(error).includes("ADMIN_REQUIRED")) fail("ADMIN_REQUIRED");
    fail("ADMIN_OPERATION_UNAVAILABLE");
  }
  return { operationId, expiresAt };
}
export async function getAdminOperation(database: D1Database, input: AdminOperationInput): Promise<AdminOperation> {
  await assertCaller(database, input); const rule = policy(input.kind);
  if (!input.operationId || input.operationId.length > 128) fail("ADMIN_OPERATION_INPUT_INVALID");
  const row = await database.prepare("SELECT * FROM admin_operations WHERE id=? AND actor_user_id=? AND session_id=? AND kind=?")
    .bind(input.operationId, input.actorUserId, input.sessionId, input.kind).first<StoredOperation>();
  if (!row || Boolean(row.requires_recent_auth) !== rule.recentAuth) fail("ADMIN_OPERATION_UNAVAILABLE");
  if (row.status === "PENDING" && row.expires_at <= input.now) fail("ADMIN_OPERATION_EXPIRED");
  if (row.payload_json && await digest(row.payload_json) !== row.payload_hash) fail("ADMIN_OPERATION_UNAVAILABLE");
  return { id: row.id, kind: row.kind, payload: row.payload_json ? JSON.parse(row.payload_json) as AdminJson : null,
    summary: JSON.parse(row.summary_json) as AdminOperationSummary, status: row.status,
    result: row.result_json ? JSON.parse(row.result_json) as AdminJson : null, expiresAt: row.expires_at };
}
/** Read a session-bound operation and verify the durable receipt before showing success. */
export async function getVerifiedAdminOperation(database: D1Database, input: AdminOperationInput): Promise<AdminOperation> {
  const operation = await getAdminOperation(database, input);
  if (operation.status === "COMMITTED") {
    const receipt = await database.prepare(`SELECT 1 FROM admin_operations o JOIN admin_operation_commits c
      ON c.operation_id=o.id AND c.actor_user_id=o.actor_user_id AND c.kind=o.kind AND c.committed_at=o.committed_at
      WHERE o.id=? AND o.actor_user_id=? AND c.session_id=? AND o.kind=? AND o.status='COMMITTED'
      AND (SELECT COUNT(*) FROM (SELECT 1 FROM admin_audit_logs a
        WHERE a.action='ADMIN_OPERATION_COMMITTED' AND a.target_type='ADMIN_OPERATION'
        AND a.target_id=o.id AND a.actor_user_id=o.actor_user_id LIMIT 2))=1`)
      .bind(operation.id, input.actorUserId, input.sessionId, input.kind).first();
    if (!receipt) fail("ADMIN_OPERATION_RECEIPT_UNAVAILABLE");
  }
  return operation;
}

export async function commitAdminOperation(database: D1Database, input: AdminOperationInput, build: (operation: AdminOperation) => {
  checks: D1PreparedStatement[]; statements: D1PreparedStatement[]; result: unknown;
} | Promise<{ checks: D1PreparedStatement[]; statements: D1PreparedStatement[]; result: unknown }>) {
  const operation = await getAdminOperation(database, input);
  if (operation.status === "COMMITTED") return { operationId: operation.id, replayed: true, result: operation.result };
  await assertCaller(database, input, policy(input.kind).recentAuth);
  const plan = await build(operation);
  if (!plan.checks.length || plan.checks.length > 250 || plan.statements.length > 1000) fail("ADMIN_OPERATION_INPUT_INVALID");
  const result = canonical(plan.result, 8192);
  const audit = canonical({ kind: input.kind, summary: operation.summary, result: JSON.parse(result) }, 8192);
  try {
    await database.batch([
      database.prepare("INSERT INTO admin_operation_commits(operation_id,actor_user_id,session_id,kind,committed_at) VALUES(?,?,?,?,?)")
        .bind(operation.id, input.actorUserId, input.sessionId, input.kind, input.now),
      ...plan.checks, ...plan.statements,
      database.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at) VALUES(?,?,'ADMIN_OPERATION_COMMITTED','ADMIN_OPERATION',?,?,?)")
        .bind(crypto.randomUUID(), input.actorUserId, operation.id, audit, input.now),
      database.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json=?,committed_at=? WHERE id=? AND status='PENDING'")
        .bind(result, input.now, operation.id),
    ]);
  } catch (error) {
    // A lost response or competing identical request may have committed already.
    const current = await getAdminOperation(database, input).catch(() => null);
    if (current?.status === "COMMITTED") return { operationId: current.id, replayed: true, result: current.result };
    const message = String(error);
    if (message.includes("MEMBER_LAST_ADMIN")) fail("MEMBER_LAST_ADMIN");
    if (message.includes("ADMIN_RECENT_AUTH_REQUIRED")) fail("ADMIN_RECENT_AUTH_REQUIRED");
    if (message.includes("ADMIN_OPERATION_UNAVAILABLE")) fail("ADMIN_OPERATION_UNAVAILABLE");
    if (/CHECK constraint|UNIQUE constraint|FOREIGN KEY constraint|CONFLICT|STALE|VERSION|MISMATCH/i.test(message)) fail("ADMIN_OPERATION_CONFLICT");
    fail("ADMIN_OPERATION_RESULT_UNKNOWN");
  }
  return { operationId: operation.id, replayed: false, result: JSON.parse(result) as AdminJson };
}
