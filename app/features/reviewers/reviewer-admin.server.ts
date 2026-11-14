import { z } from "zod";
import { slugifyPlaceName } from "../places/place-slug";
import { isWithdrawnEmail } from "../auth/withdraw";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";
import { REVIEWER_CHANGES, reviewerBatchResultSchema, reviewerChangeSchema, reviewerChangeValueSchema, type ReviewerBatchResult, type ReviewerChange } from "./reviewer-admin";

type Caller = { actorUserId: string; sessionId: string; now: string };
type TargetRow = { id: string; userId: string; version: number; status: string; name: string; email: string; role: string; userUpdatedAt: string;
  accessVersion: number; restricted: number; submittedCount: number | null; currentCount: number; lastActivityAt: string | null; profileExists: number;
  statement: string | null; occupation: string; tasteDirection: string };
const snapSchema = z.object({ id: z.string(), userId: z.string(), targetRef: z.string(), version: z.number().int().nonnegative(), status: z.string(),
  role: z.string(), userUpdatedAt: z.string(), accessVersion: z.number().int().nonnegative(), currentCount: z.number().int().nonnegative(),
  submittedCount: z.number().int().nonnegative().nullable(), lastActivityAt: z.string().nullable(), slug: z.string().nullable() });
const selectionSchema = z.object({ id: z.string(), targetRef: z.string(), outcome: z.enum(["READY", "SKIPPED"]), code: z.string(),
  submittedCount: z.number().int().nonnegative().nullable(), currentCount: z.number().int().nonnegative().nullable(), previousStatus: z.string().nullable() });
const payloadSchema = z.object({ v: z.literal(1), change: reviewerChangeValueSchema, reason: z.string().max(300),
  selections: z.array(selectionSchema).min(1).max(25), targets: z.array(snapSchema).min(1).max(25) }).strict()
  .refine((value) => new Set(value.selections.map((item) => item.id)).size === value.selections.length
    && value.selections.filter((item) => item.outcome === "READY").length === value.targets.length
    && value.targets.every((target) => value.selections.some((item) => item.id === target.id && item.targetRef === target.targetRef && item.outcome === "READY")));
type Snapshot = z.infer<typeof snapSchema>;
const applicationChange = (change: ReviewerChange) => ["START_REVIEW", "APPROVE", "OVERRIDE_APPROVE", "REJECT"].includes(change);
const approval = (change: ReviewerChange) => change === "APPROVE" || change === "OVERRIDE_APPROVE";
const desiredStatus = (change: ReviewerChange) => change === "START_REVIEW" ? "REVIEWING" : change === "REJECT" ? "REJECTED" : approval(change) ? "APPROVED" : change === "AUTO_DORMANCY" ? "DORMANT" : change;
const placeholders = (count: number) => Array(count).fill("?").join(",");
function fail(code: string): never { throw new Error(code); }
async function ref(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`reviewer-admin:${value}`)));
  return `reviewer-${Array.from(bytes.slice(0, 6), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
async function authorize(db: D1Database, input: Caller) {
  if (!input.actorUserId || !input.sessionId || !Number.isFinite(Date.parse(input.now))) fail("ADMIN_REQUIRED");
  const row = await db.prepare(`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.id=? AND s.expires_at>?
    AND u.role='ADMIN' AND u.email NOT LIKE 'withdrawn.%@invalid.local' AND NOT EXISTS(SELECT 1 FROM member_access_restrictions r
      WHERE r.user_id=u.id AND r.lifted_at IS NULL AND r.starts_at<=? AND r.expires_at>?)`)
    .bind(input.actorUserId, input.sessionId, input.now, input.now, input.now).first();
  if (!row) fail("ADMIN_REQUIRED");
}
async function readTargets(db: D1Database, ids: string[], change: ReviewerChange, now: string) {
  if (!ids.length) return [];
  const app = applicationChange(change), alias = app ? "a" : "p";
  const rows = (await db.prepare(`SELECT ${alias}.${app ? "id" : "user_id"} AS id,${alias}.user_id AS userId,${alias}.version,${alias}.status,
    u.display_name AS name,u.email,u.role,u.updated_at AS userUpdatedAt,coalesce(r.version,0) AS accessVersion,
    CASE WHEN r.lifted_at IS NULL AND r.starts_at<=? AND r.expires_at>? THEN 1 ELSE 0 END AS restricted,
    ${app ? "a.approved_suggestion_count" : "NULL"} AS submittedCount,
    (SELECT count(*) FROM place_suggestions s WHERE s.user_id=u.id AND s.status='APPROVED') AS currentCount,
    ${app ? "NULL" : "p.last_activity_at"} AS lastActivityAt,
    ${app ? "EXISTS(SELECT 1 FROM reviewer_profiles p WHERE p.user_id=u.id)" : "1"} AS profileExists,
    ${app ? "a.statement" : "NULL"} AS statement,${alias}.occupation,${alias}.taste_direction AS tasteDirection
    FROM ${app ? "reviewer_applications a" : "reviewer_profiles p"} JOIN users u ON u.id=${alias}.user_id
    LEFT JOIN member_access_restrictions r ON r.user_id=u.id WHERE ${alias}.${app ? "id" : "user_id"} IN (${placeholders(ids.length)})`)
    .bind(now, now, ...ids).all<TargetRow>()).results;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
}
function skip(row: TargetRow | undefined, change: ReviewerChange, now: string): string | null {
  if (!row) return "NOT_FOUND";
  if (row.role === "ADMIN") return "PROTECTED_ADMIN";
  if (isWithdrawnEmail(row.email)) return "ACCOUNT_UNAVAILABLE";
  if ((approval(change) || change === "ACTIVE") && row.restricted) return "ACCOUNT_RESTRICTED";
  if (applicationChange(change)) {
    if (!["APPLIED", "REVIEWING"].includes(row.status)) return "APPLICATION_CLOSED";
    if (approval(change) && row.profileExists) return "PROFILE_EXISTS";
    if (change === "APPROVE" && (row.submittedCount ?? 0) < 10) return "STORED_REQUIREMENT_NOT_MET";
  }
  if (row.status === desiredStatus(change)) return "ALREADY_STATUS";
  if (change === "AUTO_DORMANCY" && (row.status !== "ACTIVE" || !row.lastActivityAt || Date.parse(now) - Date.parse(row.lastActivityAt) < 90 * 86400000)) return "NOT_DORMANT";
  return null;
}
export async function prepareReviewerAdmin(db: D1Database, input: Caller & { change: ReviewerChange; targetIds: string[]; reason: string }) {
  await authorize(db, input);
  const parsed = reviewerChangeSchema.parse({ change: input.change, targetIds: input.targetIds, reason: input.reason });
  let ids = [...parsed.targetIds].sort();
  if (parsed.change === "AUTO_DORMANCY" && !ids.length) ids = (await db.prepare(`SELECT p.user_id AS id FROM reviewer_profiles p JOIN users u ON u.id=p.user_id
    WHERE p.status='ACTIVE' AND u.role<>'ADMIN' AND u.email NOT LIKE 'withdrawn.%@invalid.local'
    AND julianday(p.last_activity_at)<=julianday(?)-90 ORDER BY julianday(p.last_activity_at),p.user_id LIMIT 25`).bind(input.now).all<{ id: string }>()).results.map((row) => row.id);
  const rows = await readTargets(db, ids, parsed.change, input.now), byId = new Map(rows.map((row) => [row.id, row]));
  const selections = await Promise.all(ids.map(async (id) => ({ id, targetRef: await ref(id), outcome: "READY" as "READY" | "SKIPPED", code: "READY",
    submittedCount: byId.get(id)?.submittedCount ?? null, currentCount: byId.get(id)?.currentCount ?? null, previousStatus: byId.get(id)?.status ?? null })));
  const targets: Snapshot[] = [];
  const usedSlugs = new Set<string>();
  const approvingUsers = new Set<string>();
  if (approval(parsed.change)) {
    const candidates = selections.flatMap((selection) => { const row = byId.get(selection.id); return row ? [slugifyPlaceName(row.name), `${slugifyPlaceName(row.name)}-${selection.targetRef}`] : []; });
    if (candidates.length) for (const row of (await db.prepare(`SELECT slug FROM reviewer_profiles WHERE slug IN (${placeholders(candidates.length)})`).bind(...candidates).all<{ slug: string }>()).results) usedSlugs.add(row.slug);
  }
  for (const selection of selections) {
    const row = byId.get(selection.id); let code = skip(row, parsed.change, input.now), slug: string | null = null;
    if (!code && row && approval(parsed.change) && approvingUsers.has(row.userId)) code = "DUPLICATE_APPLICANT";
    if (!code && row && approval(parsed.change)) {
      const base = slugifyPlaceName(row.name); slug = usedSlugs.has(base) ? `${base}-${selection.targetRef}` : base;
      if (usedSlugs.has(slug)) code = "SLUG_CONFLICT"; else usedSlugs.add(slug);
    }
    if (code || !row) { selection.outcome = "SKIPPED"; selection.code = code ?? "NOT_FOUND"; continue; }
    if (approval(parsed.change)) approvingUsers.add(row.userId);
    targets.push({ id: row.id, userId: row.userId, targetRef: selection.targetRef, version: row.version, status: row.status, role: row.role,
      userUpdatedAt: row.userUpdatedAt, accessVersion: row.accessVersion, currentCount: row.currentCount,
      submittedCount: row.submittedCount, lastActivityAt: row.lastActivityAt, slug });
  }
  const payload = { v: 1 as const, change: parsed.change, reason: parsed.change === "AUTO_DORMANCY" ? "90일 리뷰어 활동 없음" : parsed.reason, selections, targets };
  if (!targets.length) return { operationId: null, preview: preview(payload, rows) };
  const prepared = await prepareAdminOperation(db, { ...input, kind: "REVIEWER_ADMIN_CHANGE", payload,
    summary: { title: REVIEWER_CHANGES[parsed.change], count: targets.length } });
  return { ...prepared, preview: preview(payload, rows) };
}
function preview(payload: { change: ReviewerChange; selections: z.infer<typeof selectionSchema>[]; targets: Snapshot[] }, rows: TargetRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return { committed: false as const, change: payload.change, requestedCount: payload.selections.length,
    items: payload.selections.map((item) => ({ targetRef: item.targetRef, outcome: item.outcome, code: item.code,
      name: byId.get(item.id)?.name ?? item.targetRef, submittedCount: item.submittedCount,
      currentCount: item.currentCount, previousStatus: item.previousStatus })) };
}
export async function getReviewerAdminPreview(db: D1Database, input: Caller & { operationId: string }) {
  const op = await getVerifiedAdminOperation(db, { ...input, kind: "REVIEWER_ADMIN_CHANGE" });
  if (op.status === "COMMITTED") {
    const result = reviewerBatchResultSchema.parse(op.result);
    for (const item of result.results) if (item.targetRef !== await ref(item.targetId)
      || item.targetType !== (applicationChange(result.change) ? "APPLICATION" : "PROFILE")) fail("REVIEWER_ADMIN_UNAVAILABLE");
    const rows = await readTargets(db, result.results.map((item) => item.targetId), result.change, input.now);
    const names = new Map(rows.map((row) => [row.id, row.name]));
    return { committed: true as const, operationId: op.id, result,
      displayNames: Object.fromEntries(result.results.map((item) => [item.targetRef, names.get(item.targetId) ?? "대상 확인 불가"])) };
  }
  const payload = payloadSchema.parse(op.payload);
  const rows = await readTargets(db, payload.selections.map((item) => item.id), payload.change, input.now);
  return { ...preview(payload, rows), operationId: op.id, expiresAt: op.expiresAt };
}
export async function commitReviewerAdmin(db: D1Database, input: Caller & { operationId: string }) {
  await getVerifiedAdminOperation(db, { ...input, kind: "REVIEWER_ADMIN_CHANGE" });
  const committed = await commitAdminOperation(db, { ...input, kind: "REVIEWER_ADMIN_CHANGE" }, async (operation) => {
    const payload = payloadSchema.parse(operation.payload);
    const rows = await readTargets(db, payload.targets.map((target) => target.id), payload.change, input.now);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const checks: D1PreparedStatement[] = [], statements: D1PreparedStatement[] = [];
    for (const [index, target] of payload.targets.entries()) {
      const row = byId.get(target.id);
      if (!row || skip(row, payload.change, input.now)) fail("ADMIN_OPERATION_CONFLICT");
      const app = applicationChange(payload.change);
      checks.push(db.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed) SELECT ?,?,CASE WHEN
        EXISTS(SELECT 1 FROM users WHERE id=? AND role=? AND updated_at=? AND email NOT LIKE 'withdrawn.%@invalid.local')
        AND coalesce((SELECT version FROM member_access_restrictions WHERE user_id=?),0)=?
        AND EXISTS(SELECT 1 FROM ${app ? "reviewer_applications" : "reviewer_profiles"} WHERE ${app ? "id" : "user_id"}=? AND version=? AND status=?)
        ${app ? "AND (SELECT count(*) FROM place_suggestions WHERE user_id=? AND status='APPROVED')=?" : ""}
        THEN 1 ELSE 0 END`).bind(operation.id, `reviewer-${index}`, target.userId, target.role, target.userUpdatedAt, target.userId, target.accessVersion,
          target.id, target.version, target.status, ...(app ? [target.userId, target.currentCount] : [])));
      const next = desiredStatus(payload.change);
      if (approval(payload.change)) {
        checks.push(db.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed) SELECT ?,?,CASE WHEN
          NOT EXISTS(SELECT 1 FROM reviewer_profiles WHERE user_id=? OR slug=?) THEN 1 ELSE 0 END`).bind(operation.id, `profile-new-${index}`, target.userId, target.slug));
        statements.push(db.prepare(`INSERT INTO reviewer_profiles(user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,approved_by,status_reason,created_at,updated_at)
          SELECT user_id,?,'ACTIVE',occupation,taste_direction,region_code,specialty_slugs,?,?,?,?,?,? FROM reviewer_applications WHERE id=?`)
          .bind(target.slug, input.now, input.now, input.actorUserId, payload.change === "OVERRIDE_APPROVE" ? payload.reason : null, input.now, input.now, target.id));
        statements.push(db.prepare("UPDATE users SET role='REVIEWER',updated_at=? WHERE id=? AND role<>'ADMIN'").bind(input.now, target.userId));
      }
      if (app) statements.push(db.prepare(`UPDATE reviewer_applications SET status=?,admin_note=?,override_reason=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?`)
        .bind(next, payload.reason || null, payload.change === "OVERRIDE_APPROVE" ? payload.reason : null, input.actorUserId,
          payload.change === "START_REVIEW" ? null : input.now, input.now, target.id));
      else {
        if (payload.change === "AUTO_DORMANCY") checks.push(db.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed) SELECT ?,?,CASE WHEN
          EXISTS(SELECT 1 FROM reviewer_profiles WHERE user_id=? AND julianday(last_activity_at)<=julianday(?)-90) THEN 1 ELSE 0 END`)
          .bind(operation.id, `dormancy-${index}`, target.userId, input.now));
        statements.push(db.prepare("UPDATE reviewer_profiles SET status=?,status_reason=?,last_activity_at=?,updated_at=? WHERE user_id=?")
          .bind(next, payload.reason, payload.change === "ACTIVE" ? input.now : target.lastActivityAt, input.now, target.userId));
        statements.push(db.prepare("UPDATE users SET role=?,updated_at=? WHERE id=? AND role<>'ADMIN'").bind(next === "ACTIVE" ? "REVIEWER" : "USER", input.now, target.userId));
      }
      statements.push(db.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,before_state,after_state,created_at) VALUES(?,?,?,'REVIEWER',?,?,?,?)")
        .bind(crypto.randomUUID(), input.actorUserId, `REVIEWER_ADMIN_${payload.change}`, target.id, target.status, next, input.now));
    }
    const result: ReviewerBatchResult = { change: payload.change, requestedCount: payload.selections.length, appliedCount: payload.targets.length,
      skippedCount: payload.selections.length - payload.targets.length,
      results: payload.selections.map((item) => ({ targetRef: item.targetRef, targetId: item.id, targetType: applicationChange(payload.change) ? "APPLICATION" : "PROFILE",
        outcome: item.outcome === "READY" ? "APPLIED" : "SKIPPED", code: item.outcome === "READY" ? "APPLIED" : item.code })) };
    return { checks, statements, result };
  });
  const proof = await getVerifiedAdminOperation(db, { ...input, kind: "REVIEWER_ADMIN_CHANGE" });
  if (proof.status !== "COMMITTED") fail("ADMIN_OPERATION_RESULT_UNKNOWN");
  return { ...committed, result: reviewerBatchResultSchema.parse(proof.result) };
}
export async function listReviewerAdmin(db: D1Database, input: Caller & { status?: string; query?: string }) {
  await authorize(db, input);
  const status = input.status ?? "ALL", query = (input.query ?? "").trim();
  if (!["ALL", "APPLIED", "REVIEWING", "REJECTED", "ACTIVE", "DORMANT", "SUSPENDED"].includes(status) || query.length > 100) fail("REVIEWER_ADMIN_INPUT_INVALID");
  const appIds = ["ACTIVE", "DORMANT", "SUSPENDED"].includes(status) ? [] : (await db.prepare(`SELECT a.id FROM reviewer_applications a JOIN users u ON u.id=a.user_id
    WHERE a.status IN ('APPLIED','REVIEWING','REJECTED') AND (?='ALL' OR a.status=?) AND (instr(lower(u.display_name),lower(?))>0 OR instr(lower(u.email),lower(?))>0)
    ORDER BY a.created_at DESC,a.id DESC LIMIT 51`).bind(status, status, query, query).all<{ id: string }>()).results.map((row) => row.id);
  const profileIds = ["APPLIED", "REVIEWING", "REJECTED"].includes(status) ? [] : (await db.prepare(`SELECT p.user_id AS id FROM reviewer_profiles p JOIN users u ON u.id=p.user_id
    WHERE (?='ALL' OR p.status=?) AND (instr(lower(u.display_name),lower(?))>0 OR instr(lower(u.email),lower(?))>0)
    ORDER BY u.display_name,p.user_id LIMIT 51`).bind(status, status, query, query).all<{ id: string }>()).results.map((row) => row.id);
  const safe = async (rows: TargetRow[]) => Promise.all(rows.map(async (row) => ({ id: row.id, name: row.name, targetRef: await ref(row.id), status: row.status,
    submittedCount: row.submittedCount, currentCount: row.currentCount, lastActivityAt: row.lastActivityAt, version: row.version,
    statement: row.statement, occupation: row.occupation, tasteDirection: row.tasteDirection })));
  return { applications: await safe(await readTargets(db, appIds.slice(0, 50), "APPROVE", input.now)),
    profiles: await safe(await readTargets(db, profileIds.slice(0, 50), "ACTIVE", input.now)), limited: appIds.length > 50 || profileIds.length > 50, status, query };
}
