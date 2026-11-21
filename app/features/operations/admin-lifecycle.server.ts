import { z } from "zod";
import { GUEST_TTL_SECONDS } from "../onboarding/guest-session.server";
import { GUEST_SAVE_LIMIT } from "../onboarding/guest-saves.server";
import { PRODUCT_EVENT_RETENTION_DAYS, RATE_WINDOW_RETENTION_HOURS } from "../onboarding/data-lifecycle.server";

export const LIFECYCLE_SAMPLE_LIMIT = 1000;
const count = z.number().int().nonnegative().nullable();
const telemetrySchema = z.object({ version: z.literal(1), status: z.enum(["COMPLETED", "PARTIAL_OR_UNKNOWN"]),
  cutoff: z.string().datetime(), guestSessions: count, productEvents: count, rateWindows: z.null() }).strict();
type Sample = { sampled: number; truncated: boolean; [key: string]: number | boolean };
async function sample(database: D1Database, table: string, columns: string, metrics: string, bindings: string[] = []): Promise<Sample> {
  // Only constant SQL fragments below reach this helper. The bounded scan projects no user text or session identifiers.
  const row = await database.prepare(`WITH candidates AS (
      SELECT rowid AS position,${columns} FROM ${table} ORDER BY rowid DESC LIMIT ${LIFECYCLE_SAMPLE_LIMIT + 1}
    ), sample AS (SELECT * FROM candidates ORDER BY position DESC LIMIT ${LIFECYCLE_SAMPLE_LIMIT})
    SELECT (SELECT count(*) FROM candidates)>${LIFECYCLE_SAMPLE_LIMIT} AS truncated,
      count(*) AS sampled,${metrics} FROM sample`).bind(...bindings).first<Record<string, number>>();
  if (!row) throw new Error("LIFECYCLE_READ_UNAVAILABLE");
  return { ...row, sampled: row.sampled, truncated: Boolean(row.truncated) };
}
const sum = (predicate: string, name: string) => `coalesce(sum(CASE WHEN ${predicate} THEN 1 ELSE 0 END),0) AS ${name}`;

export async function readAdminLifecycle(database: D1Database, now: string) {
  const cutoff = new Date(now);
  if (!Number.isFinite(cutoff.getTime()) || cutoff.toISOString() !== now) throw new Error("LIFECYCLE_TIME_INVALID");
  const eventCutoff = new Date(cutoff.getTime() - PRODUCT_EVENT_RETENTION_DAYS * 86_400_000).toISOString();
  const rateCutoff = new Date(cutoff.getTime() - RATE_WINDOW_RETENTION_HOURS * 3_600_000).toISOString();
  const [guest, saves, badges, events, rates, audit] = await Promise.all([
    sample(database, "guest_taste_sessions", `expires_at<=? AS due,expires_at>? AS current,
      merged_user_id IS NOT NULL AS merged,completed_at IS NOT NULL AS completed,skipped_at IS NOT NULL AS skipped`,
    [sum("due", "due"), sum("merged", "merged"), sum("current AND NOT merged AND NOT completed AND NOT skipped", "active"),
      sum("current AND NOT merged AND completed", "completed"), sum("current AND NOT merged AND NOT completed AND skipped", "skipped")].join(","), [now, now]),
    sample(database, "guest_saved_places", `EXISTS(SELECT 1 FROM guest_taste_sessions g WHERE g.id=guest_saved_places.session_id AND g.expires_at<=?) AS due,
      EXISTS(SELECT 1 FROM guest_taste_sessions g WHERE g.id=guest_saved_places.session_id AND g.merged_user_id IS NOT NULL) AS merged`,
    `${sum("due", "due")},${sum("merged", "merged")}`, [now]),
    sample(database, "guest_taste_badges", `EXISTS(SELECT 1 FROM guest_taste_sessions g WHERE g.id=guest_taste_badges.session_id AND g.expires_at<=?) AS due,
      EXISTS(SELECT 1 FROM guest_taste_sessions g WHERE g.id=guest_taste_badges.session_id AND g.merged_user_id IS NOT NULL) AS merged`,
    `${sum("due", "due")},${sum("merged", "merged")}`, [now]),
    sample(database, "product_events", "occurred_at<=? AS due,event_name='GUEST_CONVERTED' AS converted",
      `${sum("due", "due")},${sum("converted", "conversions")}`, [eventCutoff]),
    sample(database, "rate_limit_windows", "window_started_at<? AS due", sum("due", "due"), [rateCutoff]),
    database.prepare(`SELECT created_at,after_state FROM admin_audit_logs
      WHERE rowid IN (SELECT rowid FROM admin_audit_logs ORDER BY rowid DESC LIMIT ${LIFECYCLE_SAMPLE_LIMIT})
      AND action='ONBOARDING_DATA_LIFECYCLE' AND target_type='LIFECYCLE' AND target_id='onboarding'
      ORDER BY rowid DESC LIMIT 1`).first<{ created_at: string; after_state: string | null }>(),
  ]);
  let cleanup: { status: string; recordedAt: string | null; cutoff: string | null;
    guestSessions: number | null; productEvents: number | null; rateWindows: null } = {
    status: "UNOBSERVED", recordedAt: null, cutoff: null, guestSessions: null, productEvents: null, rateWindows: null,
  };
  if (audit) {
    cleanup.status = "INCOMPLETE";
    try {
      if (!audit.after_state || audit.after_state.length > 2048) throw new Error();
      const value = telemetrySchema.parse(JSON.parse(audit.after_state));
      if (value.status === "COMPLETED" && (value.guestSessions === null || value.productEvents === null)) throw new Error();
      if (value.status === "PARTIAL_OR_UNKNOWN" && (value.guestSessions !== null || value.productEvents !== null)) throw new Error();
      cleanup = { ...value, recordedAt: Number.isFinite(Date.parse(audit.created_at)) ? audit.created_at : null };
    } catch { /* Invalid telemetry is not evidence of successful cleanup. */ }
  }
  return { queriedAt: now, sampleLimit: LIFECYCLE_SAMPLE_LIMIT, guest, saves, badges, events, rates, cleanup,
    technical: { guestDays: GUEST_TTL_SECONDS / 86_400, saveLimit: GUEST_SAVE_LIMIT,
      eventDays: PRODUCT_EVENT_RETENTION_DAYS, rateWindowHours: RATE_WINDOW_RETENTION_HOURS }, eventCutoff, rateCutoff };
}
