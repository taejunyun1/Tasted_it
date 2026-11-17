import { z } from "zod";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "./admin-operation.server";

type Operator = { actorUserId: string; sessionId: string; now: string };
const kind = "OPERATIONAL_ALERT_RESOLVE" as const;
const snapshotSchema = z.object({
  alertId: z.string().min(1).max(128), note: z.string().trim().min(5).max(300),
  alertType: z.enum(["PUBLIC_DATA_SYNC", "RATING_RECOMPUTE", "NAVER_LOCAL_SEARCH"]),
  severity: z.enum(["WARNING", "ERROR"]), sourceId: z.string().nullable(),
  occurrenceCount: z.number().int().positive(), firstOccurredAt: z.string(), lastOccurredAt: z.string(),
});
export async function prepareAlertResolution(database: D1Database, input: Operator & { alertId: string; note: string }) {
  const parsed = z.object({ alertId: z.string().min(1).max(128), note: z.string().trim().min(5).max(300) }).safeParse(input);
  if (!parsed.success) throw new Error("ALERT_INPUT_INVALID");
  const row = await database.prepare(`SELECT alert_type,severity,source_id,occurrence_count,first_occurred_at,last_occurred_at
    FROM operational_alerts WHERE id=? AND status='OPEN'`).bind(parsed.data.alertId)
    .first<{ alert_type: string; severity: string; source_id: string | null; occurrence_count: number; first_occurred_at: string; last_occurred_at: string }>();
  if (!row) throw new Error("ALERT_UNAVAILABLE");
  const payload = snapshotSchema.parse({ ...parsed.data, alertType: row.alert_type, severity: row.severity, sourceId: row.source_id,
    occurrenceCount: row.occurrence_count, firstOccurredAt: row.first_occurred_at, lastOccurredAt: row.last_occurred_at });
  return prepareAdminOperation(database, { ...input, kind, payload, summary: { title: "운영 경보 검토 처리", count: 1 } });
}
export async function readAlertResolution(database: D1Database, input: Operator & { operationId: string }) {
  const operation = await getVerifiedAdminOperation(database, { ...input, kind });
  // The source identifier stays in the server-side compare-and-swap payload.
  const payload = operation.status === "PENDING" ? snapshotSchema.parse(operation.payload) : null;
  return { operationId: operation.id, status: operation.status, expiresAt: operation.expiresAt,
    note: payload?.note ?? null, alertId: payload?.alertId ?? null };
}
export async function commitAlertResolution(database: D1Database, input: Operator & { operationId: string }) {
  const receipt = await commitAdminOperation(database, { ...input, kind }, (operation) => {
    const p = snapshotSchema.parse(operation.payload);
    return {
      checks: [database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
        SELECT ?,'alert_snapshot',CASE WHEN EXISTS(SELECT 1 FROM operational_alerts
          WHERE id=? AND status='OPEN' AND alert_type=? AND severity=? AND source_id IS ?
          AND occurrence_count=? AND first_occurred_at=? AND last_occurred_at=?) THEN 1 ELSE 0 END`)
        .bind(operation.id, p.alertId, p.alertType, p.severity, p.sourceId, p.occurrenceCount, p.firstOccurredAt, p.lastOccurredAt)],
      statements: [database.prepare(`UPDATE operational_alerts SET status='RESOLVED',resolved_by=?,resolved_at=?,resolution_note=? WHERE id=? AND status='OPEN'`)
        .bind(input.actorUserId, input.now, p.note, p.alertId)],
      result: { alertId: p.alertId, status: "RESOLVED", meaning: "HUMAN_REVIEW_RECORDED", recoveryVerified: false },
    };
  });
  await getVerifiedAdminOperation(database, { ...input, kind });
  return { operationId: receipt.operationId, replayed: receipt.replayed };
}
