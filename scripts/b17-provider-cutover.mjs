import { createHash } from "node:crypto";

const fields = ["rowid", "provider", "utc_day", "legacy_total", "legacy_gwangju", "legacy_jeonnam",
  "reserved_total", "reserved_gwangju", "reserved_jeonnam", "baseline_at", "baseline_source", "cutover_state",
  "is_cutover_anchor", "cutover_verified_at", "ready_after_utc_day", "cutover_receipt_ref", "last_reservation_id", "created_at", "updated_at"];
const counters = ["legacy_total", "legacy_gwangju", "legacy_jeonnam", "reserved_total", "reserved_gwangju", "reserved_jeonnam"];
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const day = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const identifier = (value, max) => typeof value === "string" && value.length >= 1 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const quote = (value) => value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const sha = (value) => createHash("sha256").update(value).digest("hex");

/** Offline SQL generation only. This module never connects to a database or provider. */
export function buildB17ProviderCutoverSql({ snapshot, operatorId, sessionId, now, drainEvidenceSha256, previousWorkerVersion, nextWorkerVersion }) {
  if (!identifier(operatorId, 128) || !identifier(sessionId, 256) || !iso(now)
    || !day(now.slice(0, 10)) || typeof drainEvidenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(drainEvidenceSha256)
    || !uuid(previousWorkerVersion) || !uuid(nextWorkerVersion)
    || previousWorkerVersion.toLowerCase() === nextWorkerVersion.toLowerCase()) throw new Error("B17_CUTOVER_INPUT_INVALID");
  if (!snapshot || Object.getPrototypeOf(snapshot) !== Object.prototype
    || fields.some((field) => !Object.hasOwn(snapshot, field)) || Object.keys(snapshot).some((field) => !fields.includes(field))
    || !Number.isSafeInteger(snapshot.rowid) || snapshot.rowid < 1
    || snapshot.provider !== "NAVER_LOCAL_SEARCH" || snapshot.is_cutover_anchor !== 1
    || snapshot.cutover_state !== "CLOSED_LEGACY_UNCERTAIN" || !day(snapshot.utc_day)
    || counters.some((field) => !Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0)
    || snapshot.reserved_total !== snapshot.reserved_gwangju + snapshot.reserved_jeonnam
    || !["LEGACY_RUN_ESTIMATE", "EMPTY_NEW_DAY"].includes(snapshot.baseline_source)
    || !["baseline_at", "created_at", "updated_at"].every((field) => iso(snapshot[field]) && snapshot[field] <= now)
    || !["cutover_verified_at", "ready_after_utc_day", "cutover_receipt_ref"].every((field) => snapshot[field] === null)
    || snapshot.last_reservation_id !== null && !identifier(snapshot.last_reservation_id, 128)) throw new Error("B17_CUTOVER_SNAPSHOT_INVALID");

  const laterDay = snapshot.utc_day > now.slice(0, 10) ? snapshot.utc_day : now.slice(0, 10);
  const readyAfterUtcDay = new Date(Date.parse(`${laterDay}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  if (!day(readyAfterUtcDay)) throw new Error("B17_CUTOVER_INPUT_INVALID");
  const before = Object.fromEntries(fields.map((field) => [field, snapshot[field]]));
  const after = { ...before, cutover_verified_at: now, ready_after_utc_day: readyAfterUtcDay, cutover_receipt_ref: `sha256:${drainEvidenceSha256}` };
  const proof = { drainEvidenceSha256, previousWorkerVersion, nextWorkerVersion, policy: "audited-offline-naver-cutover" };
  const digest = sha(JSON.stringify({ before, operatorId, sessionId, now, ...proof }));
  const marker = `b17-provider-cutover-${digest}`;
  const guard = `b17_provider_guard_${digest.slice(0, 24)}`, apply = `b17_provider_apply_${digest.slice(0, 24)}`;
  const auditFields = { actor_user_id: operatorId, action: "B17_PROVIDER_CUTOVER", target_type: "PROVIDER_CUTOVER",
    target_id: "NAVER_LOCAL_SEARCH", before_state: JSON.stringify({ anchor: before }), after_state: JSON.stringify({ anchor: after, ...proof }), created_at: now };
  const auditEquals = (alias) => Object.entries(auditFields).map(([field, value]) => `${alias}.${field} IS ${quote(value)}`).join(" AND ");
  const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const auth = `EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=${quote(sessionId)} AND s.user_id=${quote(operatorId)} AND s.expires_at>${clock}
    AND u.role='ADMIN' AND u.email_verified_at IS NOT NULL AND u.email NOT LIKE 'withdrawn.%@invalid.local'
    AND NOT EXISTS(SELECT 1 FROM member_access_restrictions r WHERE r.user_id=u.id AND r.lifted_at IS NULL AND r.starts_at<=${clock} AND r.expires_at>${clock}))`;
  const frozen = fields.map((field) => `${field} IS ${quote(before[field])}`).join(" AND ");
  const installSql = `CREATE TRIGGER ${guard} BEFORE INSERT ON admin_audit_logs WHEN NEW.id=${quote(marker)} BEGIN
 SELECT CASE WHEN NOT (${auditEquals("NEW")}) THEN RAISE(ABORT,'B17_CUTOVER_AUDIT_MISMATCH') END;
 SELECT CASE WHEN NOT (${auth}) THEN RAISE(ABORT,'B17_CUTOVER_ADMIN_REQUIRED') END;
 SELECT CASE WHEN date(${clock})<>date(${quote(now)}) OR ${clock}<${quote(now)} THEN RAISE(ABORT,'B17_CUTOVER_TIME_STALE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM admin_audit_logs a WHERE a.id=${quote(marker)} AND NOT (${auditEquals("a")})) THEN RAISE(ABORT,'B17_CUTOVER_AUDIT_MISMATCH') END;
END;
CREATE TRIGGER ${apply} AFTER INSERT ON admin_audit_logs WHEN NEW.id=${quote(marker)} BEGIN
 SELECT CASE WHEN NOT (${auth}) THEN RAISE(ABORT,'B17_CUTOVER_ADMIN_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM naver_local_category_runs WHERE status='RUNNING') THEN RAISE(ABORT,'B17_CUTOVER_RUN_ACTIVE') END;
 SELECT CASE WHEN (SELECT count(*) FROM provider_daily_quotas WHERE provider='NAVER_LOCAL_SEARCH' AND is_cutover_anchor=1)<>1
   OR NOT EXISTS(SELECT 1 FROM provider_daily_quotas WHERE ${frozen}) THEN RAISE(ABORT,'B17_CUTOVER_SNAPSHOT_CHANGED') END;
 UPDATE provider_daily_quotas SET cutover_verified_at=${quote(now)},ready_after_utc_day=${quote(readyAfterUtcDay)},cutover_receipt_ref=${quote(after.cutover_receipt_ref)} WHERE ${frozen};
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'B17_CUTOVER_SNAPSHOT_CHANGED') END;
END;\n`;
  const applySql = `INSERT OR IGNORE INTO admin_audit_logs(id,${Object.keys(auditFields).join(",")}) VALUES(${[marker, ...Object.values(auditFields)].map(quote).join(",")});\n`;
  const cleanupSql = `DROP TRIGGER IF EXISTS ${guard};\nDROP TRIGGER IF EXISTS ${apply};\n`;
  return { marker, anchorDay: before.utc_day, readyAfterUtcDay, triggerNames: [guard, apply], installSql, applySql, cleanupSql,
    sha256: sha(installSql + applySql + cleanupSql) };
}
