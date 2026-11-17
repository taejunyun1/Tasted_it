import { and, eq, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { operationalAlerts } from "../../db/schema";

export async function recordOperationalAlert(db: AppDb, input: { alertType: "PUBLIC_DATA_SYNC" | "RATING_RECOMPUTE" | "NAVER_LOCAL_SEARCH"; severity?: "WARNING" | "ERROR"; sourceId: string | null; message: string; details: unknown; now: string }) {
  const open = await db.query.operationalAlerts.findFirst({ where: and(eq(operationalAlerts.alertType, input.alertType), eq(operationalAlerts.status, "OPEN"), input.sourceId ? eq(operationalAlerts.sourceId, input.sourceId) : sql`${operationalAlerts.sourceId} is null`) });
  if (open) {
    const changed = await db.update(operationalAlerts).set({ message: input.message, detailsJson: JSON.stringify(input.details), occurrenceCount: sql`${operationalAlerts.occurrenceCount} + 1`, lastOccurredAt: input.now })
      .where(and(eq(operationalAlerts.id, open.id), eq(operationalAlerts.status, "OPEN"))).returning({ id: operationalAlerts.id });
    if (changed.length) return open.id;
  }
  const id = crypto.randomUUID();
  await db.insert(operationalAlerts).values({ id, alertType: input.alertType, severity: input.severity ?? "ERROR", status: "OPEN", sourceId: input.sourceId, message: input.message, detailsJson: JSON.stringify(input.details), firstOccurredAt: input.now, lastOccurredAt: input.now });
  return id;
}
