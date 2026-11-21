import { RSI_PUBLIC_PATH_CHECKS } from "./rsi-self-check";

const HOUR = 3_600_000;
export function summarizeRsiRecord(row: { id: string; created_at: string; after_state: string | null }, now: string) {
  const age = Date.parse(now) - Date.parse(row.created_at);
  const base = { id: row.id, checkedAt: row.created_at, trigger: "UNKNOWN", status: "INCOMPLETE", stale: !Number.isFinite(age) || age < 0 || age > 12 * HOUR,
    paths: [] as { path: string; status: number; ok: boolean }[] };
  try {
    if (!row.after_state || row.after_state.length > 8192) return base;
    const p = JSON.parse(row.after_state);
    if (!p || !["scheduled", "admin"].includes(p.trigger)) return base;
    base.trigger = p.trigger;
    if (p.skipped === true) return { ...base, status: "SKIPPED" };
    if (!Array.isArray(p.paths) || p.paths.length !== RSI_PUBLIC_PATH_CHECKS.length || typeof p.ok !== "boolean") return base;
    const paths = RSI_PUBLIC_PATH_CHECKS.map((expected) => {
      const matches = p.paths.filter((path: { path?: unknown }) => path?.path === expected.path);
      const item = matches[0];
      if (matches.length !== 1 || !Number.isInteger(item.status) || item.status < 0 || item.status > 599 || typeof item.ok !== "boolean"
        || item.ok && item.status !== expected.status) throw new Error("INVALID_RSI_RECORD");
      return { path: expected.path, status: item.status, ok: item.ok };
    });
    const failed = paths.filter((path) => !path.ok).length;
    if (p.ok !== (failed === 0) || p.failed !== failed) return base;
    return { ...base, status: p.ok ? "PASSED" : "FAILED", paths };
  } catch { return base; }
}

export async function readReliability(database: D1Database, now: string) {
  const [rsi, scheduled, alerts] = await Promise.all([
    database.prepare(`SELECT id,created_at,after_state FROM admin_audit_logs WHERE action='RSI_SELF_CHECK' AND target_type='OPERATIONS'
      ORDER BY julianday(created_at) DESC,id DESC LIMIT 20`).all<{ id: string; created_at: string; after_state: string | null }>(),
    database.prepare(`SELECT id,created_at,after_state FROM admin_audit_logs WHERE action='RSI_SELF_CHECK' AND target_type='OPERATIONS' AND target_id='rsi-scheduled'
      ORDER BY julianday(created_at) DESC,id DESC LIMIT 1`).first<{ id: string; created_at: string; after_state: string | null }>(),
    database.prepare(`SELECT id,alert_type,severity,status,occurrence_count,first_occurred_at,last_occurred_at,resolved_at
      FROM operational_alerts ORDER BY CASE status WHEN 'OPEN' THEN 0 ELSE 1 END,last_occurred_at DESC,id DESC LIMIT 50`)
      .all<{ id: string; alert_type: string; severity: string; status: string; occurrence_count: number; first_occurred_at: string; last_occurred_at: string; resolved_at: string | null }>(),
  ]);
  return { queriedAt: now, rsi: rsi.results.map((row) => summarizeRsiRecord(row, now)),
    scheduled: scheduled ? summarizeRsiRecord(scheduled, now) : null,
    alerts: alerts.results.map((row) => ({ id: row.id, type: ["PUBLIC_DATA_SYNC", "RATING_RECOMPUTE", "NAVER_LOCAL_SEARCH"].includes(row.alert_type) ? row.alert_type : "UNKNOWN",
      severity: row.severity === "ERROR" ? "ERROR" : "WARNING", status: row.status === "OPEN" ? "OPEN" : "RESOLVED",
      occurrences: row.occurrence_count, firstAt: row.first_occurred_at, lastAt: row.last_occurred_at, resolvedAt: row.resolved_at })) };
}
