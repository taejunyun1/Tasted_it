import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, businessLicenses, naverLocalCategoryVerifications, operationalAlerts, placeReviewWorkItems, places, publicDataSyncRuns, ratingRecomputeJobs } from "../../db/schema";

export const REVIEW_QUEUE_STAGES = [
  "SOURCE_REVIEW",
  "NAVER_VERIFICATION",
  "CATEGORY_CONFIRMATION",
  "DUPLICATE_REVIEW",
  "FINAL_APPROVAL",
] as const;

export type ReviewQueueStage = (typeof REVIEW_QUEUE_STAGES)[number];

export type ReviewQueueCounts = Record<ReviewQueueStage, number> & {
  activeTotal: number;
  onHoldTotal: number;
};

export type PlaceCatalogCounts = {
  published: number;
  hidden: number;
  draft: number;
};

export function dailyPublishRate(publishedInWindow: number, days = 7) {
  return Math.round((publishedInWindow / days) * 100) / 100;
}

function emptyReviewQueue(): ReviewQueueCounts {
  return {
    SOURCE_REVIEW: 0,
    NAVER_VERIFICATION: 0,
    CATEGORY_CONFIRMATION: 0,
    DUPLICATE_REVIEW: 0,
    FINAL_APPROVAL: 0,
    activeTotal: 0,
    onHoldTotal: 0,
  };
}

function emptyCatalog(): PlaceCatalogCounts {
  return { published: 0, hidden: 0, draft: 0 };
}

export async function getOperationalDashboard(db: AppDb, input: { now: string }) {
  const ranges = [{ label: "24시간", ms: 86_400_000 }, { label: "7일", ms: 7 * 86_400_000 }, { label: "30일", ms: 30 * 86_400_000 }] as const;
  const windows = await Promise.all(ranges.map(async (range) => {
    const cutoff = new Date(new Date(input.now).getTime() - range.ms).toISOString();
    const [candidates, approvals, rejections, reviewPublished, reviewHeld, reviewExcluded, naverVerified, naverFailed, syncFailed, recomputeFailed] = await Promise.all([
      db.select({ value: sql<number>`count(*)` }).from(businessLicenses).where(gte(businessLicenses.createdAt, cutoff)),
      db.select({ value: sql<number>`count(*)` }).from(adminAuditLogs).where(and(eq(adminAuditLogs.action, "APPROVE_CANDIDATE"), gte(adminAuditLogs.createdAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(adminAuditLogs).where(and(eq(adminAuditLogs.action, "REJECT_CANDIDATE"), gte(adminAuditLogs.createdAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(adminAuditLogs).where(and(eq(adminAuditLogs.action, "PLACE_REVIEW_PUBLISH"), gte(adminAuditLogs.createdAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(adminAuditLogs).where(and(eq(adminAuditLogs.action, "PLACE_REVIEW_HOLD"), gte(adminAuditLogs.createdAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(adminAuditLogs).where(and(eq(adminAuditLogs.action, "PLACE_REVIEW_EXCLUDE"), gte(adminAuditLogs.createdAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(naverLocalCategoryVerifications).where(and(eq(naverLocalCategoryVerifications.status, "VERIFIED"), gte(naverLocalCategoryVerifications.queriedAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(naverLocalCategoryVerifications).where(and(eq(naverLocalCategoryVerifications.status, "FAILED"), gte(naverLocalCategoryVerifications.queriedAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(publicDataSyncRuns).where(and(eq(publicDataSyncRuns.status, "FAILED"), gte(publicDataSyncRuns.startedAt, cutoff))),
      db.select({ value: sql<number>`count(*)` }).from(ratingRecomputeJobs).where(and(eq(ratingRecomputeJobs.status, "FAILED"), gte(ratingRecomputeJobs.createdAt, cutoff))),
    ]);
    return {
      label: range.label,
      candidates: Number(candidates[0]?.value ?? 0),
      approvals: Number(approvals[0]?.value ?? 0),
      rejections: Number(rejections[0]?.value ?? 0),
      reviewPublished: Number(reviewPublished[0]?.value ?? 0),
      reviewHeld: Number(reviewHeld[0]?.value ?? 0),
      reviewExcluded: Number(reviewExcluded[0]?.value ?? 0),
      naverVerified: Number(naverVerified[0]?.value ?? 0),
      naverFailed: Number(naverFailed[0]?.value ?? 0),
      syncFailed: Number(syncFailed[0]?.value ?? 0),
      recomputeFailed: Number(recomputeFailed[0]?.value ?? 0),
    };
  }));
  const [missingCoordinates, alerts, queueRows, catalogRows] = await Promise.all([
    db.select({ value: sql<number>`count(*)` }).from(businessLicenses).where(and(eq(businessLicenses.normalizedStatus, "OPEN"), eq(businessLicenses.reviewStatus, "PENDING"), isNull(businessLicenses.latitude))),
    db.select().from(operationalAlerts).where(eq(operationalAlerts.status, "OPEN")).orderBy(desc(operationalAlerts.lastOccurredAt)).limit(100),
    db.select({
      stage: placeReviewWorkItems.stage,
      status: placeReviewWorkItems.status,
      value: sql<number>`count(*)`,
    }).from(placeReviewWorkItems).where(inArray(placeReviewWorkItems.status, ["ACTIVE", "ON_HOLD"])).groupBy(placeReviewWorkItems.stage, placeReviewWorkItems.status),
    db.select({
      status: places.status,
      value: sql<number>`count(*)`,
    }).from(places).groupBy(places.status),
  ]);
  const reviewQueue = emptyReviewQueue();
  for (const row of queueRows) {
    const count = Number(row.value ?? 0);
    if (row.status === "ON_HOLD") {
      reviewQueue.onHoldTotal += count;
      continue;
    }
    reviewQueue[row.stage] += count;
    reviewQueue.activeTotal += count;
  }
  const catalog = emptyCatalog();
  for (const row of catalogRows) {
    const count = Number(row.value ?? 0);
    if (row.status === "PUBLISHED") catalog.published = count;
    if (row.status === "HIDDEN") catalog.hidden = count;
    if (row.status === "DRAFT") catalog.draft = count;
  }
  const published7d = windows.find((window) => window.label === "7일")?.reviewPublished ?? 0;
  return {
    windows,
    missingCoordinates: Number(missingCoordinates[0]?.value ?? 0),
    alerts,
    reviewQueue,
    publishedPerDay7d: dailyPublishRate(published7d),
    catalog,
  };
}
