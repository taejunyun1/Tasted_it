import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { naverLocalCategoryRuns } from "../../db/schema";
import { NaverLocalSearchError } from "../candidates/naver-local-search.server";
import { ACTIVE_REGION_CODES, getRegionPack, type RegionCode } from "../regions/region-pack";

export type NaverRegionDailyUsage = {
  regionCode: RegionCode;
  displayName: string;
  used: number;
  budget: number;
  enabled: boolean;
};

function utcDayStart(value: string) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

export function naverRegionBudget(regionCode: RegionCode, override?: number) {
  return override ?? getRegionPack(regionCode).naverDailyBudget;
}

export function isNaverRegionSearchEnabled(regionCode: RegionCode) {
  return getRegionPack(regionCode).naverSearchEnabled;
}

export async function getNaverLocalSearchApiCallsToday(db: AppDb, now: string, regionCode?: RegionCode) {
  const window = and(gte(naverLocalCategoryRuns.startedAt, utcDayStart(now)), lt(naverLocalCategoryRuns.startedAt, now));
  const [result] = await db.select({ total: sql<number>`coalesce(sum(${naverLocalCategoryRuns.apiCallCount}), 0)` })
    .from(naverLocalCategoryRuns)
    .where(regionCode
      ? and(window, or(eq(naverLocalCategoryRuns.regionCode, regionCode), isNull(naverLocalCategoryRuns.regionCode)))
      : window);
  return Number(result?.total ?? 0);
}

export async function listNaverRegionDailyUsage(db: AppDb, now: string): Promise<NaverRegionDailyUsage[]> {
  return Promise.all(ACTIVE_REGION_CODES.map(async (regionCode) => {
    const pack = getRegionPack(regionCode);
    return {
      regionCode,
      displayName: pack.displayName,
      used: await getNaverLocalSearchApiCallsToday(db, now, regionCode),
      budget: pack.naverDailyBudget,
      enabled: pack.naverSearchEnabled,
    };
  }));
}

export function assertNaverRegionQuota(input: {
  regionCode: RegionCode;
  used: number;
  extraCalls?: number;
  dailyLimit?: number;
}) {
  if (!isNaverRegionSearchEnabled(input.regionCode)) {
    throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_DISABLED");
  }
  if (input.used + (input.extraCalls ?? 0) >= naverRegionBudget(input.regionCode, input.dailyLimit)) {
    throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_QUOTA");
  }
}

export function uniqueRunRegion(regionCodes: Array<RegionCode | null | undefined>): RegionCode | null {
  const unique = [...new Set(regionCodes.filter((code): code is RegionCode => code === "GWANGJU" || code === "JEONNAM"))];
  return unique.length === 1 ? unique[0] : null;
}
