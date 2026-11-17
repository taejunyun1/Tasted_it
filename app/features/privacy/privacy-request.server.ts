import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../../db/client.server";
import { privacyRequests, users } from "../../db/schema";
import { isWithdrawnEmail } from "../auth/withdraw";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";

export const privacyRequestKinds = ["ACCESS", "CORRECTION", "DELETION", "RESTRICTION"] as const;
export const privacyDecisionCodes = ["REVIEW_STARTED", "POLICY_UNRESOLVED", "SELF_SERVICE_GUIDANCE"] as const;
const kindSchema = z.enum(privacyRequestKinds);
const decisionSchema = z.enum(privacyDecisionCodes);
const nextStatus = { REVIEW_STARTED: "REVIEWING", POLICY_UNRESOLVED: "POLICY_HOLD", SELF_SERVICE_GUIDANCE: "GUIDANCE_RECORDED" } as const;
type Operator = { actorUserId: string; sessionId: string; now: string };
const snapshotSchema = z.object({ requestId: z.string().min(1).max(128), kind: kindSchema, revision: z.number().int().positive(),
  previousStatus: z.enum(["RECEIVED", "REVIEWING", "POLICY_HOLD"]), decision: decisionSchema });

export async function createPrivacyRequest(database: D1Database, input: { userId: string; kind: string; now: string }) {
  const kind = kindSchema.safeParse(input.kind);
  if (!kind.success) throw new Error("PRIVACY_REQUEST_INPUT_INVALID");
  const db = createDb(database), user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
  if (!user || isWithdrawnEmail(user.email) || !user.emailVerifiedAt) throw new Error("PRIVACY_REQUEST_VERIFIED_ACCOUNT_REQUIRED");
  const id = crypto.randomUUID();
  await database.prepare(`INSERT INTO privacy_requests(id,user_id,kind,status,revision,received_at,updated_at)
    SELECT ?,id,?,'RECEIVED',1,?,? FROM users WHERE id=? AND email_verified_at IS NOT NULL
    AND email<>'withdrawn.'||id||'@invalid.local' ON CONFLICT DO NOTHING`).bind(id, kind.data, input.now, input.now, input.userId).run();
  const row = await database.prepare("SELECT id FROM privacy_requests WHERE user_id=? AND kind=? AND status IN ('RECEIVED','REVIEWING','POLICY_HOLD') ORDER BY received_at DESC LIMIT 1")
    .bind(input.userId, kind.data).first<{ id: string }>();
  if (!row) throw new Error("PRIVACY_REQUEST_RESULT_UNKNOWN");
  return { id: row.id, created: row.id === id };
}

export async function listOwnPrivacyRequests(database: D1Database, userId: string) {
  return createDb(database).select({ id: privacyRequests.id, kind: privacyRequests.kind, status: privacyRequests.status,
    decisionCode: privacyRequests.decisionCode, receivedAt: privacyRequests.receivedAt, updatedAt: privacyRequests.updatedAt })
    .from(privacyRequests).where(eq(privacyRequests.userId, userId)).orderBy(desc(privacyRequests.receivedAt), desc(privacyRequests.id)).limit(20);
}

const cursorSchema = z.object({ at: z.string().datetime(), id: z.string().min(1).max(128) });
export function decodePrivacyCursor(cursor: string | null) {
  if (!cursor) return null;
  try { if (cursor.length > 600) throw new Error(); return cursorSchema.parse(JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")))); }
  catch { throw new Error("PRIVACY_CURSOR_INVALID"); }
}
export const encodePrivacyCursor = (at: string, id: string) => btoa(JSON.stringify({ at, id })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function listPrivacyRequests(database: D1Database, cursor: string | null) {
  const after = decodePrivacyCursor(cursor), db = createDb(database);
  const rows = await db.select({ id: privacyRequests.id, kind: privacyRequests.kind, status: privacyRequests.status,
    revision: privacyRequests.revision, decisionCode: privacyRequests.decisionCode, receivedAt: privacyRequests.receivedAt, updatedAt: privacyRequests.updatedAt })
    .from(privacyRequests).where(after ? sql`${privacyRequests.updatedAt}<${after.at} OR (${privacyRequests.updatedAt}=${after.at} AND ${privacyRequests.id}<${after.id})` : undefined)
    .orderBy(desc(privacyRequests.updatedAt), desc(privacyRequests.id)).limit(51);
  const page = rows.slice(0, 50), last = page.at(-1);
  return { rows: page, nextCursor: rows.length > 50 && last ? encodePrivacyCursor(last.updatedAt, last.id) : null };
}

export async function preparePrivacyRequestUpdate(database: D1Database, input: Operator & { requestId: string; decision: string }) {
  const decision = decisionSchema.safeParse(input.decision);
  if (!decision.success || !input.requestId || input.requestId.length > 128) throw new Error("PRIVACY_REQUEST_INPUT_INVALID");
  const row = await createDb(database).query.privacyRequests.findFirst({ where: eq(privacyRequests.id, input.requestId) });
  if (!row || row.status === "GUIDANCE_RECORDED") throw new Error("PRIVACY_REQUEST_UNAVAILABLE");
  const payload = snapshotSchema.parse({ requestId: row.id, kind: row.kind, revision: row.revision, previousStatus: row.status, decision: decision.data });
  return { ...await prepareAdminOperation(database, { ...input, kind: "PRIVACY_REQUEST_UPDATE", payload,
    summary: { title: "개인정보 요청 처리 기록", count: 1 } }), ...payload };
}
export async function readPrivacyRequestUpdate(database: D1Database, input: Operator & { operationId: string }) {
  const operation = await getVerifiedAdminOperation(database, { ...input, kind: "PRIVACY_REQUEST_UPDATE" });
  const payload = snapshotSchema.parse(operation.status === "COMMITTED" ? operation.result : operation.payload);
  return { ...payload, operationId: operation.id, status: operation.status, nextStatus: nextStatus[payload.decision] };
}
export async function commitPrivacyRequestUpdate(database: D1Database, input: Operator & { operationId: string }) {
  return commitAdminOperation(database, { ...input, kind: "PRIVACY_REQUEST_UPDATE" }, (operation) => {
    const s = snapshotSchema.parse(operation.payload);
    return { checks: [database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?, 'privacy_request', CASE WHEN EXISTS(SELECT 1 FROM privacy_requests WHERE id=? AND kind=? AND status=? AND revision=?) THEN 1 ELSE 0 END`)
      .bind(operation.id, s.requestId, s.kind, s.previousStatus, s.revision)],
      statements: [database.prepare("UPDATE privacy_requests SET status=?,decision_code=?,decided_by=?,revision=revision+1,updated_at=? WHERE id=?")
        .bind(nextStatus[s.decision], s.decision, input.actorUserId, input.now, s.requestId)], result: s };
  });
}
