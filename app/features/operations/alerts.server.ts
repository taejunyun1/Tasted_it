import { and, eq, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { operationalAlerts } from "../../db/schema";

export async function recordOperationalAlert(db: AppDb, input: { alertType: "PUBLIC_DATA_SYNC" | "AI_CLASSIFICATION" | "RATING_RECOMPUTE"; severity?: "WARNING" | "ERROR"; sourceId: string | null; message: string; details: unknown; now: string }) {
  const open = await db.query.operationalAlerts.findFirst({ where: and(eq(operationalAlerts.alertType, input.alertType), eq(operationalAlerts.status, "OPEN"), input.sourceId ? eq(operationalAlerts.sourceId, input.sourceId) : sql`${operationalAlerts.sourceId} is null`) });
  if (open) {
    await db.update(operationalAlerts).set({ message: input.message, detailsJson: JSON.stringify(input.details), occurrenceCount: sql`${operationalAlerts.occurrenceCount} + 1`, lastOccurredAt: input.now }).where(eq(operationalAlerts.id, open.id));
    return open.id;
  }
  const id = crypto.randomUUID();
  await db.insert(operationalAlerts).values({ id, alertType: input.alertType, severity: input.severity ?? "ERROR", status: "OPEN", sourceId: input.sourceId, message: input.message, detailsJson: JSON.stringify(input.details), firstOccurredAt: input.now, lastOccurredAt: input.now });
  return id;
}

export async function resolveOperationalAlert(db: AppDb, input: { alertId: string; actorUserId: string; note: string; now: string }) {
  if (!input.note.trim()) throw new Error("RESOLUTION_NOTE_REQUIRED");
  await db.update(operationalAlerts).set({ status: "RESOLVED", resolvedBy: input.actorUserId, resolvedAt: input.now, resolutionNote: input.note.trim() }).where(eq(operationalAlerts.id, input.alertId));
}
