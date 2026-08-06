import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, aiClassificationRuns, businessLicenses, operationalAlerts, publicDataSyncRuns, ratingRecomputeJobs } from "../../db/schema";

export async function getOperationalDashboard(db: AppDb, input: { now: string }) {
  const ranges = [{ label: "24시간", ms: 86_400_000 }, { label: "7일", ms: 7 * 86_400_000 }, { label: "30일", ms: 30 * 86_400_000 }] as const;
  const windows = await Promise.all(ranges.map(async (range) => {
    const cutoff = new Date(new Date(input.now).getTime() - range.ms).toISOString();
    const [candidates, approvals, rejections, aiSuccess, aiFailed, aiCached, syncFailed, recomputeFailed] = await Promise.all([
      db.select({ value: sql<number>`count(*)` }).from(businessLicenses).where(gte(businessLicenses.createdAt, cutoff)),
      db.select({ value: sql<number>`count(*)` }).from(adminAuditLogs).where(and(eq(adminAuditLogs.action, "APPROVE_CANDIDATE"), gte(adminAuditLogs.createdAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(adminAuditLogs).where(and(eq(adminAuditLogs.action, "REJECT_CANDIDATE"), gte(adminAuditLogs.createdAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(aiClassificationRuns).where(and(eq(aiClassificationRuns.status, "SUCCESS"), gte(aiClassificationRuns.createdAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(aiClassificationRuns).where(and(eq(aiClassificationRuns.status, "FAILED"), gte(aiClassificationRuns.createdAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(aiClassificationRuns).where(and(gte(aiClassificationRuns.createdAt, cutoff), sql`${aiClassificationRuns.cachedFromId} is not null`)),
      db.select({ value: sql<number>`count(*)` }).from(publicDataSyncRuns).where(and(eq(publicDataSyncRuns.status, "FAILED"), gte(publicDataSyncRuns.startedAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(ratingRecomputeJobs).where(and(eq(ratingRecomputeJobs.status, "FAILED"), gte(ratingRecomputeJobs.createdAt, cutoff))),
    ]);
    return { label: range.label, candidates: Number(candidates[0]?.value ?? 0), approvals: Number(approvals[0]?.value ?? 0), rejections: Number(rejections[0]?.value ?? 0), aiSuccess: Number(aiSuccess[0]?.value ?? 0), aiFailed: Number(aiFailed[0]?.value ?? 0), aiCached: Number(aiCached[0]?.value ?? 0), syncFailed: Number(syncFailed[0]?.value ?? 0), recomputeFailed: Number(recomputeFailed[0]?.value ?? 0) };
  }));
  const [missingCoordinates, alerts] = await Promise.all([
    db.select({ value: sql<number>`count(*)` }).from(businessLicenses).where(and(eq(businessLicenses.normalizedStatus, "OPEN"), eq(businessLicenses.reviewStatus, "PENDING"), isNull(businessLicenses.latitude))),
    db.select().from(operationalAlerts).where(eq(operationalAlerts.status, "OPEN")).orderBy(desc(operationalAlerts.lastOccurredAt)).limit(100),
  ]);
  return { windows, missingCoordinates: Number(missingCoordinates[0]?.value ?? 0), alerts };
}
