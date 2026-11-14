import { ACTIVITY_KINDS, ACTIVITY_PAGE_SIZE, activityKind, encodeActivityCursor, normalizeActivityTime, type ActivityStatus, type parseActivityQuery } from "./admin-activity";

type Query = ReturnType<typeof parseActivityQuery>;
type OperationRow = {
  id: string; kind: string; actor_user_id: string; status: string; created_at: string; expires_at: string; committed_at: string | null;
  receipt_id: string | null; audit_count: number; summary_json?: string; result_json?: string | null;
};
type AuditRow = { id: string; action: string; target_type: string; target_id: string; actor_user_id: string | null; created_at: string };
type ListRow = OperationRow & Partial<AuditRow> & { operation_id: string | null; order_key: number };
const RECEIPT_JOIN = `LEFT JOIN admin_operation_commits c ON c.operation_id=o.id AND c.actor_user_id=o.actor_user_id
  AND c.kind=o.kind AND c.committed_at=o.committed_at`;
const AUDIT_COUNT = `(SELECT count(*) FROM (SELECT 1 FROM admin_audit_logs al
  WHERE al.action='ADMIN_OPERATION_COMMITTED' AND al.target_type='ADMIN_OPERATION'
  AND al.target_id=o.id AND al.actor_user_id=o.actor_user_id LIMIT 2))`;
const AUDIT_NAMES: Record<string, string> = {
  APPROVE_CANDIDATE: "후보 승인", REJECT_CANDIDATE: "후보 반려", PLACE_REVIEW_PUBLISH: "장소 공개",
  PLACE_REVIEW_HOLD: "장소 검수 보류", PLACE_REVIEW_EXCLUDE: "장소 제외", RSI_SELF_CHECK: "서비스 경로 점검",
  EMAIL_DOMAIN_REPAIR: "발신 도메인 작업", RESOLVE_OPERATIONAL_ALERT: "운영 경보 처리",
};
async function reference(value: string | null | undefined) {
  if (!value) return "없음";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`activity:${value}`)));
  return `참조 ${Array.from(digest.slice(0, 6), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function status(row: Pick<OperationRow, "status" | "expires_at" | "receipt_id" | "audit_count">, now: string): ActivityStatus {
  if (row.status === "PENDING") return row.expires_at <= now ? "EXPIRED" : "PENDING";
  return row.status === "COMMITTED" && row.receipt_id && row.audit_count === 1 ? "COMMITTED" : "INCOMPLETE";
}
function object(value: string | null | undefined): Record<string, unknown> | null {
  try {
    if (!value || value.length > 8192) return null;
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
function identifier(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) ? value : null;
}
function timestamp(value: unknown) {
  return normalizeActivityTime(value);
}

async function readDetail(database: D1Database, operationId: string, now: string) {
  const row = await database.prepare(`SELECT o.id,o.kind,o.actor_user_id,o.status,o.created_at,o.expires_at,o.committed_at,
    o.summary_json,o.result_json,c.operation_id AS receipt_id,${AUDIT_COUNT} AS audit_count
    FROM admin_operations o ${RECEIPT_JOIN} WHERE o.id=?`).bind(operationId).first<OperationRow>();
  if (!row) return null;
  const linked = row.status === "COMMITTED" && row.audit_count === 1 && Boolean(row.receipt_id);
  const kind = activityKind(row.kind), summary = object(row.summary_json), result = linked ? object(row.result_json) : null;
  const fields: { label: string; value: string }[] = [];
  const addCount = (key: string, label: string) => {
    const value = result?.[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) fields.push({ label, value: String(value) });
  };
  const addRef = async (key: string, label: string) => {
    const value = identifier(result?.[key]);
    if (value) fields.push({ label, value: await reference(value) });
  };
  if (kind === "CSV_IMPORT") addCount("imported", "반영 건수");
  if (kind === "ADMIN_ROLE_CHANGE" || kind === "ADMIN_SESSIONS_REVOKE") {
    addCount("revokedSessions", "회수 세션 수");
    for (const [key, label] of [["beforeRole", "이전 역할"], ["role", "변경 역할"]])
      if (["USER", "REVIEWER", "ADMIN"].includes(String(result?.[key]))) fields.push({ label, value: String(result?.[key]) });
    await addRef("targetUserId", "대상 회원");
  }
  if (kind === "INTEGRITY_CASE_TRANSITION" || kind === "VOTE_INVALIDATE") {
    await addRef("caseId", "사건");
    if (["OPEN", "REVIEWING", "CONFIRMED", "DISMISSED"].includes(String(result?.status))) fields.push({ label: "사건 상태", value: String(result?.status) });
    if (result?.invalidated === true) fields.push({ label: "투표 무효화", value: "반영됨" });
  }
  if (kind === "TEMP_PUBLISH" || kind === "TEMP_UNPUBLISH") {
    addCount("published", "공개 건수"); addCount("withdrawn", "회수 건수"); addCount("count", "처리 건수");
  }
  let job: { reference: string; status: string; checkedAt: string; finishedAt: string | null } | null = null;
  if (kind === "RATING_RECOMPUTE" && row.status === "COMMITTED") {
    const jobId = identifier(result?.jobId), placeId = identifier(result?.placeId), configId = identifier(result?.configId);
    const current = linked && jobId && placeId && configId ? await database.prepare(`SELECT status,finished_at FROM rating_recompute_jobs
      WHERE id=? AND place_id=? AND config_id=? AND scope='PLACE'`).bind(jobId, placeId, configId).first<{ status: string; finished_at: string | null }>() : null;
    job = { reference: await reference(jobId), status: current && ["PENDING", "RUNNING", "COMPLETED", "FAILED"].includes(current.status) ? current.status : "UNKNOWN",
      checkedAt: now, finishedAt: timestamp(current?.finished_at) };
  }
  return {
    operationId: row.id, kind, title: kind ? ACTIVITY_KINDS[kind] : "기타 작업", state: status(row, now),
    actor: await reference(row.actor_user_id), createdAt: timestamp(row.created_at), expiresAt: timestamp(row.expires_at), committedAt: timestamp(row.committed_at),
    count: (row.status === "PENDING" || linked) && typeof summary?.count === "number" && Number.isSafeInteger(summary.count) && summary.count > 0 && summary.count <= 200 ? summary.count : null,
    auditLinked: linked, fields, job,
    resultUnavailable: row.status === "COMMITTED" && result === null,
  };
}

export async function readAdminActivity(database: D1Database, query: Query, now: string) {
  const alias = query.view === "audit" ? "a" : "o", table = query.view === "audit" ? "admin_audit_logs" : "admin_operations";
  const highWater = query.cursor?.highWater ?? Number(await database.prepare(`SELECT coalesce(max(rowid),0) AS value FROM ${table}`).first("value"));
  const cutoff = query.cursor?.cutoff ?? now;
  const conditions = [`${alias}.rowid<=?`, `julianday(${alias}.created_at)<=julianday(?)`];
  const bindings: (string | number)[] = [highWater, cutoff];
  if (query.cursor) { conditions.push(`(julianday(${alias}.created_at),${alias}.id)<(?,?)`); bindings.push(query.cursor.afterKey, query.cursor.afterId); }
  if (query.kind !== "all") { conditions.push("o.kind=?"); bindings.push(query.kind); }
  const sql = query.view === "audit"
    ? `SELECT a.id,a.action,a.target_type,a.target_id,a.actor_user_id,a.created_at,julianday(a.created_at) AS order_key,
        o.id AS operation_id,o.kind,o.status,o.expires_at,c.operation_id AS receipt_id,${AUDIT_COUNT} AS audit_count
      FROM admin_audit_logs a LEFT JOIN admin_operations o ON a.action='ADMIN_OPERATION_COMMITTED'
        AND a.target_type='ADMIN_OPERATION' AND a.target_id=o.id AND a.actor_user_id=o.actor_user_id ${RECEIPT_JOIN}`
    : `SELECT o.id,o.id AS operation_id,o.kind,o.actor_user_id,o.status,o.created_at,o.expires_at,julianday(o.created_at) AS order_key,
        c.operation_id AS receipt_id,${AUDIT_COUNT} AS audit_count FROM admin_operations o ${RECEIPT_JOIN}`;
  const raw = (await database.prepare(`${sql} WHERE ${conditions.join(" AND ")} ORDER BY julianday(${alias}.created_at) DESC,${alias}.id DESC LIMIT ${ACTIVITY_PAGE_SIZE + 1}`).bind(...bindings).all<ListRow>()).results;
  const page = raw.slice(0, ACTIVITY_PAGE_SIZE);
  const rows = await Promise.all(page.map(async (row) => {
    const kind = activityKind(row.kind);
    return { key: await reference(`${query.view}:${row.id}`), createdAt: timestamp(row.created_at), actor: await reference(row.actor_user_id),
      title: kind ? ACTIVITY_KINDS[kind] : Object.hasOwn(AUDIT_NAMES, row.action ?? "") ? AUDIT_NAMES[row.action!] : "기타 관리 작업",
      target: await reference(query.view === "audit" ? row.target_id : row.operation_id),
      operationId: row.operation_id, state: row.operation_id ? status(row, now) : "RECORDED" as ActivityStatus };
  }));
  const last = page.at(-1);
  const nextCursor = raw.length > ACTIVITY_PAGE_SIZE && last ? encodeActivityCursor({ version: 1, view: query.view, kind: query.kind,
    cutoff, highWater, afterKey: last.order_key, afterId: last.id }) : null;
  const detail = query.operationId ? await readDetail(database, query.operationId, now) : null;
  return { rows, nextCursor, cutoff, queriedAt: now, detail, detailMissing: Boolean(query.operationId && !detail), pageSize: ACTIVITY_PAGE_SIZE };
}
