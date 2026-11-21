import type { AppDb } from "../../db/client.server";
import { NaverLocalSearchError } from "../candidates/naver-local-search.server";
import { ACTIVE_REGION_CODES, getRegionPack, type RegionCode } from "../regions/region-pack";

export type NaverRegionDailyUsage = {
  regionCode: RegionCode;
  displayName: string;
  used: number;
  budget: number;
  enabled: boolean;
};

export function naverRegionBudget(regionCode: RegionCode, override?: number) {
  return Math.min(override ?? getRegionPack(regionCode).naverDailyBudget, getRegionPack(regionCode).naverDailyBudget);
}

export function isNaverRegionSearchEnabled(regionCode: RegionCode) {
  return getRegionPack(regionCode).naverSearchEnabled;
}

export async function getNaverLocalSearchApiCallsToday(db: AppDb, now: string, regionCode?: RegionCode) {
  const field = regionCode === "GWANGJU" ? "gwangju" : regionCode === "JEONNAM" ? "jeonnam" : "total";
  const row = await db.$client.prepare(`SELECT legacy_${field}+reserved_${field} AS total FROM provider_daily_quotas WHERE provider='NAVER_LOCAL_SEARCH' AND utc_day=?`)
    .bind(now.slice(0, 10)).first<{ total: number }>();
  return row?.total ?? 0;
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
