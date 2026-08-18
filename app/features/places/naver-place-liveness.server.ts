import { eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { naverLocalCategoryRuns, placeLivenessStates, places } from "../../db/schema";
import { matchNaverLocalCategory, type NaverLocalCategoryMatch } from "../candidates/naver-local-category";
import { NaverLocalSearchError, type NaverLocalSearchAdapter } from "../candidates/naver-local-search.server";
import { ACTIVE_REGION_CODES, regionFromAddress, type RegionCode } from "../regions/region-pack";
import { assertNaverRegionQuota, getNaverLocalSearchApiCallsToday, isNaverRegionSearchEnabled, uniqueRunRegion } from "./naver-region-quota.server";

const MAX_BATCH_SIZE = 25;

export type NaverPlaceLivenessResult = {
  runId: string;
  scanned: number;
  matched: number;
  manual: number;
  failed: number;
  apiCalls: number;
};

function regionCodeForAddress(address: string): RegionCode | null {
  return regionFromAddress(address);
}

function failureCode(error: unknown) {
  return error instanceof NaverLocalSearchError ? error.code : "NAVER_LOCAL_SEARCH_UNAVAILABLE";
}

function naverStatus(match: NaverLocalCategoryMatch): "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "ERROR" {
  return match.status === "VERIFIED" ? "MATCHED"
    : match.status === "LIKELY" || match.status === "AMBIGUOUS" ? "AMBIGUOUS"
      : "NOT_FOUND";
}

export { getNaverLocalSearchApiCallsToday } from "./naver-region-quota.server";

/**
 * Performs a per-place NAVER name+address/coordinate check. Same-name groups
 * merely provide selected ids; no place rows are merged or auto-published.
 */
export async function verifyPlacesLivenessWithNaver(db: AppDb, input: {
  placeIds: string[];
  now: string;
  dailyLimit?: number;
  adapter: NaverLocalSearchAdapter;
  actorUserId?: string;
}): Promise<NaverPlaceLivenessResult> {
  const placeIds = [...new Set(input.placeIds.filter(Boolean))];
  if (placeIds.length < 1 || placeIds.length > MAX_BATCH_SIZE) throw new Error("NAVER_PLACE_LIVENESS_LIMIT_INVALID");
  const rows = await db.select({ id: places.id, name: places.name, address: places.address, latitude: places.latitude, longitude: places.longitude })
    .from(places).where(inArray(places.id, placeIds));
  const runId = crypto.randomUUID();
  await db.insert(naverLocalCategoryRuns).values({
    id: runId, mode: "APPLY", scope: "PUBLISHED", status: "RUNNING", requestedLimit: placeIds.length,
    regionCode: uniqueRunRegion(rows.map((row) => regionCodeForAddress(row.address))),
    startedAt: input.now, createdBy: input.actorUserId ?? null,
  });

  let scanned = 0;
  let matched = 0;
  let manual = 0;
  let failed = 0;
  let apiCalls = 0;
  const extraCalls: Record<RegionCode, number> = { GWANGJU: 0, JEONNAM: 0 };
  try {
    const usedByRegion = Object.fromEntries(await Promise.all(ACTIVE_REGION_CODES.map(async (code) =>
      [code, await getNaverLocalSearchApiCallsToday(db, input.now, code)] as const))) as Record<RegionCode, number>;
    for (const row of rows) {
      scanned += 1;
      const regionCode = regionCodeForAddress(row.address);
      let status: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "ERROR" = "ERROR";
      let score: number | null = null;
      let evidenceCodes: string[] = [];
      if (!regionCode) {
        status = "NOT_FOUND";
      } else if (!isNaverRegionSearchEnabled(regionCode)) {
        status = "ERROR";
      } else {
        assertNaverRegionQuota({
          regionCode,
          used: usedByRegion[regionCode],
          extraCalls: extraCalls[regionCode],
          dailyLimit: input.dailyLimit,
        });
        try {
          const results = await input.adapter.search({ businessName: row.name, address: row.address, regionCode });
          apiCalls += 1;
          extraCalls[regionCode] += 1;
          const match = matchNaverLocalCategory({ ...row, businessName: row.name, regionCode, results, terminalSlugs: new Set() });
          status = naverStatus(match);
          score = match.matchScore;
          evidenceCodes = match.evidenceCodes;
        } catch (error) {
          apiCalls += 1;
          extraCalls[regionCode] += 1;
          if (failureCode(error) === "NAVER_LOCAL_SEARCH_QUOTA" || failureCode(error) === "NAVER_LOCAL_SEARCH_DISABLED") throw error;
          failed += 1;
        }
      }
      if (status === "MATCHED") matched += 1;
      else if (status !== "ERROR") manual += 1;
      await db.insert(placeLivenessStates).values({
        placeId: row.id, naverStatus: status, naverMatchScore: score, naverEvidenceCodesJson: JSON.stringify(evidenceCodes), naverLastCheckedAt: input.now, updatedAt: input.now,
      }).onConflictDoUpdate({ target: placeLivenessStates.placeId, set: {
        naverStatus: status, naverMatchScore: score, naverEvidenceCodesJson: JSON.stringify(evidenceCodes), naverLastCheckedAt: input.now, updatedAt: input.now,
      } });
    }
    const result = { runId, scanned, matched, manual, failed, apiCalls };
    await db.update(naverLocalCategoryRuns).set({ status: "COMPLETED", scannedCount: scanned, verifiedCount: matched, conflictCount: manual, failedCount: failed, apiCallCount: apiCalls, finishedAt: input.now })
      .where(eq(naverLocalCategoryRuns.id, runId));
    return result;
  } catch (error) {
    await db.update(naverLocalCategoryRuns).set({ status: "FAILED", scannedCount: scanned, verifiedCount: matched, conflictCount: manual, failedCount: failed, apiCallCount: apiCalls, finishedAt: input.now, errorCode: failureCode(error) })
      .where(eq(naverLocalCategoryRuns.id, runId));
    throw error;
  }
}
