import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { businessLicenseExclusions, businessLicenses, placeCategories, placeCategoryV5Runs, places, placeSourceLinks } from "../../db/schema";
import { savePlaceCategoryV5Profile } from "./category-v5-profile.server";

const MAX_SHADOW_BATCH = 100;

export async function runCategoryV5Shadow(db: AppDb, input: { afterPlaceId?: string | null; placeIds?: string[]; limit?: number; now: string; createdBy?: string | null }) {
  const limit = Math.min(Math.max(input.limit ?? MAX_SHADOW_BATCH, 1), MAX_SHADOW_BATCH);
  const runId = crypto.randomUUID();
  await db.insert(placeCategoryV5Runs).values({
    id: runId, mode: "SHADOW", status: "RUNNING", requestedLimit: limit,
    scannedCount: 0, storedCount: 0, verifiedApplyCount: 0, manualCount: 0, excludedCount: 0,
    errorCode: null, startedAt: input.now, finishedAt: null, createdBy: input.createdBy ?? null,
  });
  try {
    const conditions = [eq(places.status, "PUBLISHED"), eq(placeSourceLinks.isPrimary, true), eq(placeCategories.isPrimary, true)];
    if (input.placeIds?.length) conditions.push(inArray(places.id, [...new Set(input.placeIds)].slice(0, limit)));
    if (input.afterPlaceId) conditions.push(gt(places.id, input.afterPlaceId));
    const rows = await db.select({
      placeId: places.id,
      sourceType: businessLicenses.sourceType,
      businessName: businessLicenses.businessName,
      businessSubtype: businessLicenses.businessSubtype,
      exclusionStatus: businessLicenseExclusions.status,
    }).from(places)
      .innerJoin(placeSourceLinks, eq(placeSourceLinks.placeId, places.id))
      .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
      .innerJoin(businessLicenses, eq(businessLicenses.id, placeSourceLinks.businessLicenseId))
      .leftJoin(businessLicenseExclusions, eq(businessLicenseExclusions.businessLicenseId, businessLicenses.id))
      .where(and(...conditions)).orderBy(asc(places.id)).limit(limit + 1);
    const page = rows.slice(0, limit);
    let manualCount = 0;
    let excludedCount = 0;
    for (const row of page) {
      const profile = await savePlaceCategoryV5Profile(db, {
        placeId: row.placeId,
        businessName: row.businessName,
        businessSubtype: row.businessSubtype,
        sourceType: row.sourceType,
        overridden: row.exclusionStatus === "OVERRIDDEN",
        now: input.now,
        mode: "SHADOW",
      });
      if (profile.decision === "MANUAL") manualCount += 1;
      if (profile.decision === "EXCLUDE") excludedCount += 1;
    }
    const nextAfterPlaceId = input.placeIds?.length ? null : rows.length > limit ? page.at(-1)?.placeId ?? null : null;
    await db.update(placeCategoryV5Runs).set({
      status: "COMPLETED", scannedCount: page.length, storedCount: page.length,
      manualCount, excludedCount, finishedAt: input.now,
    }).where(eq(placeCategoryV5Runs.id, runId));
    return { runId, scannedCount: page.length, storedCount: page.length, manualCount, excludedCount, nextAfterPlaceId };
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message : "CATEGORY_V5_SHADOW_FAILED";
    await db.update(placeCategoryV5Runs).set({ status: "FAILED", errorCode: code, finishedAt: input.now }).where(eq(placeCategoryV5Runs.id, runId));
    throw error;
  }
}
