import { createHash } from "node:crypto";

const fields = ["id", "source_type", "region_code", "address_field", "status", "next_page", "total_count", "fetched_count", "inserted_count", "updated_count", "skipped_count", "started_at", "finished_at", "error_summary", "created_at", "updated_at", "attempts", "lease_id", "lease_expires_at", "cancel_requested_at", "request_count", "retry_count"];
const counters = ["next_page", "total_count", "fetched_count", "inserted_count", "updated_count", "skipped_count", "attempts", "request_count", "retry_count"];
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const identifier = (value, max) => typeof value === "string" && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
const quote = (value) => value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const sha = (value) => createHash("sha256").update(value).digest("hex");

/** Offline, explicitly reviewed rollout only. Nothing imports this from a Worker. */
export function buildB10LegacyPublicResumeSql({ snapshot, operatorId, sessionId, now, drainEvidenceSha256, previousWorkerVersion, fenceVersion }) {
  if (!identifier(operatorId, 128) || !identifier(sessionId, 256) || !iso(now)
    || !/^[0-9a-f]{64}$/.test(drainEvidenceSha256) || !uuid(previousWorkerVersion) || !uuid(fenceVersion) || previousWorkerVersion === fenceVersion) {
    throw new Error("B10_RESUME_INPUT_INVALID");
  }
  if (!snapshot || Object.getPrototypeOf(snapshot) !== Object.prototype
    || fields.some((field) => !Object.hasOwn(snapshot, field))
    || Object.keys(snapshot).some((field) => !fields.includes(field) && field !== "rowid")
    || !identifier(snapshot.id, 128) || snapshot.source_type !== "REST_CAFE" || snapshot.region_code !== "GWANGJU_JEONNAM"
    || snapshot.address_field !== "LOTNO_ADDR" || snapshot.status !== "RUNNING"
    || counters.some((field) => !Number.isSafeInteger(snapshot[field]) || snapshot[field] < (field === "next_page" ? 1 : 0))
    || !["started_at", "created_at", "updated_at"].every((field) => iso(snapshot[field]))
    || !["finished_at", "error_summary", "lease_id", "lease_expires_at", "cancel_requested_at"].every((field) => snapshot[field] === null)
    || snapshot.attempts !== 0 || snapshot.request_count !== 0 || snapshot.retry_count !== 0
    || Object.hasOwn(snapshot, "rowid") && (!Number.isSafeInteger(snapshot.rowid) || snapshot.rowid < 1)) {
    throw new Error("B10_RESUME_SNAPSHOT_INVALID");
  }
  const before = Object.fromEntries(fields.map((field) => [field, snapshot[field]]));
  if (Object.hasOwn(snapshot, "rowid")) before.rowid = snapshot.rowid;
  const after = { ...before, status: "PENDING", updated_at: now };
  const proof = { drainEvidenceSha256, previousWorkerVersion, fenceVersion, policy: "audited-offline-drained-legacy-resume" };
  const beforeJson = JSON.stringify({ run: before }), afterJson = JSON.stringify({ run: after, ...proof });
  const digest = sha(JSON.stringify({ before, operatorId, sessionId, now, ...proof }));
  const marker = `b10-legacy-resume-${digest}`;
  const beforeTrigger = `b10_resume_identity_${digest.slice(0, 24)}`, afterTrigger = `b10_resume_apply_${digest.slice(0, 24)}`;
  const action = "B10_LEGACY_PUBLIC_RESUME", targetType = "PUBLIC_DATA_SYNC_RUN";
  const auditFields = { actor_user_id: operatorId, action, target_type: targetType, target_id: before.id, before_state: beforeJson, after_state: afterJson, created_at: now };
  const auditEquals = (alias) => Object.entries(auditFields).map(([field, value]) => `${alias}.${field} IS ${quote(value)}`).join(" AND ");
  const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const auth = `EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=${quote(sessionId)} AND s.user_id=${quote(operatorId)} AND s.expires_at>${clock}
    AND u.role='ADMIN' AND u.email_verified_at IS NOT NULL AND u.email NOT LIKE 'withdrawn.%@invalid.local'
    AND NOT EXISTS(SELECT 1 FROM member_access_restrictions r WHERE r.user_id=u.id AND r.lifted_at IS NULL AND r.starts_at<=${clock} AND r.expires_at>${clock}))`;
  const frozen = Object.entries(before).map(([field, value]) => `${field} IS ${quote(value)}`).join(" AND ");
  const installSql = `CREATE TRIGGER IF NOT EXISTS ${beforeTrigger} BEFORE INSERT ON admin_audit_logs WHEN NEW.id=${quote(marker)} BEGIN
 SELECT CASE WHEN NOT (${auditEquals("NEW")}) THEN RAISE(ABORT,'B10_RESUME_AUDIT_MISMATCH') END;
 SELECT CASE WHEN NOT (${auth}) THEN RAISE(ABORT,'B10_RESUME_ADMIN_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM admin_audit_logs a WHERE a.id=${quote(marker)} AND NOT (${auditEquals("a")})) THEN RAISE(ABORT,'B10_RESUME_AUDIT_MISMATCH') END;
END;
CREATE TRIGGER IF NOT EXISTS ${afterTrigger} AFTER INSERT ON admin_audit_logs WHEN NEW.id=${quote(marker)} BEGIN
 SELECT CASE WHEN NOT (${auth}) THEN RAISE(ABORT,'B10_RESUME_ADMIN_REQUIRED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public_data_sync_runs WHERE ${frozen}) THEN RAISE(ABORT,'B10_RESUME_SNAPSHOT_CHANGED') END;
 UPDATE public_data_sync_runs SET status='PENDING',updated_at=${quote(now)} WHERE ${frozen};
END;\n`;
  const columns = ["id", ...Object.keys(auditFields)], values = [marker, ...Object.values(auditFields)];
  const applySql = `INSERT OR IGNORE INTO admin_audit_logs(${columns.join(",")}) VALUES(${values.map(quote).join(",")});\n`;
  const cleanupSql = `DROP TRIGGER IF EXISTS ${beforeTrigger};\nDROP TRIGGER IF EXISTS ${afterTrigger};\n`;
  return { marker, triggerNames: [beforeTrigger, afterTrigger], runId: before.id, installSql, applySql, cleanupSql, sha256: sha(installSql + applySql + cleanupSql) };
}
