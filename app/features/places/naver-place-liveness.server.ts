import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { naverLocalCategoryRuns, placeLivenessStates, places } from "../../db/schema";
import { matchNaverLocalCategory, type NaverLocalCategoryMatch } from "../candidates/naver-local-category";
import { NaverLocalSearchError, type NaverLocalSearchAdapter } from "../candidates/naver-local-search.server";
import type { RegionCode } from "../candidates/public-data";

const MAX_BATCH_SIZE = 25;

export type NaverPlaceLivenessResult = {
  runId: string;
  scanned: number;
  matched: number;
  manual: number;
  failed: number;
  apiCalls: number;
};

function utcDayStart(value: string) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function regionCodeForAddress(address: string): RegionCode | null {
  if (/광주(?:광역시)?/u.test(address)) return "GWANGJU";
  if (/전라남도|전남/u.test(address)) return "JEONNAM";
  return null;
}

function failureCode(error: unknown) {
  return error instanceof NaverLocalSearchError ? error.code : "NAVER_LOCAL_SEARCH_UNAVAILABLE";
}

function naverStatus(match: NaverLocalCategoryMatch): "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "ERROR" {
  return match.status === "VERIFIED" ? "MATCHED"
    : match.status === "LIKELY" || match.status === "AMBIGUOUS" ? "AMBIGUOUS"
      : "NOT_FOUND";
}

async function todayApiCalls(db: AppDb, now: string) {
  const [result] = await db.select({ total: sql<number>`coalesce(sum(${naverLocalCategoryRuns.apiCallCount}), 0)` })
    .from(naverLocalCategoryRuns)
    .where(and(gte(naverLocalCategoryRuns.startedAt, utcDayStart(now)), lt(naverLocalCategoryRuns.startedAt, now)));
  return Number(result?.total ?? 0);
}

/**
 * Performs a per-place NAVER name+address/coordinate check. Same-name groups
 * merely provide selected ids; no place rows are merged or auto-published.
 */
export async function verifyPlacesLivenessWithNaver(db: AppDb, input: {
  placeIds: string[];
  now: string;
  dailyLimit: number;
  adapter: NaverLocalSearchAdapter;
  actorUserId?: string;
}): Promise<NaverPlaceLivenessResult> {
  const placeIds = [...new Set(input.placeIds.filter(Boolean))];
  if (placeIds.length < 1 || placeIds.length > MAX_BATCH_SIZE) throw new Error("NAVER_PLACE_LIVENESS_LIMIT_INVALID");
  const runId = crypto.randomUUID();
  await db.insert(naverLocalCategoryRuns).values({
    id: runId, mode: "APPLY", scope: "PUBLISHED", status: "RUNNING", requestedLimit: placeIds.length,
    startedAt: input.now, createdBy: input.actorUserId ?? null,
  });

  let scanned = 0;
  let matched = 0;
  let manual = 0;
  let failed = 0;
  let apiCalls = 0;
  try {
    const rows = await db.select({ id: places.id, name: places.name, address: places.address, latitude: places.latitude, longitude: places.longitude })
      .from(places).where(inArray(places.id, placeIds));
    const used = await todayApiCalls(db, input.now);
    for (const row of rows) {
      scanned += 1;
      const regionCode = regionCodeForAddress(row.address);
      let status: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "ERROR" = "ERROR";
      let score: number | null = null;
      let evidenceCodes: string[] = [];
      if (!regionCode) {
        status = "NOT_FOUND";
      } else if (used + apiCalls >= input.dailyLimit) {
        throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_QUOTA");
      } else {
        try {
          const results = await input.adapter.search({ businessName: row.name, address: row.address, regionCode });
          apiCalls += 1;
          const match = matchNaverLocalCategory({ ...row, businessName: row.name, regionCode, results, terminalSlugs: new Set() });
          status = naverStatus(match);
          score = match.matchScore;
          evidenceCodes = match.evidenceCodes;
        } catch (error) {
          apiCalls += 1;
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
