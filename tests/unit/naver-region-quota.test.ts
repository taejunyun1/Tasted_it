import { describe, expect, it } from "vitest";

import { NaverLocalSearchError } from "../../app/features/candidates/naver-local-search.server";
import { assertNaverRegionQuota, naverRegionBudget, uniqueRunRegion } from "../../app/features/places/naver-region-quota.server";
import { REGION_PACKS } from "../../app/features/regions/region-pack";

describe("NAVER region quota", () => {
  it("reads the budget from the pack unless a test override is set", () => {
    expect(naverRegionBudget("GWANGJU")).toBe(REGION_PACKS.GWANGJU.naverDailyBudget);
    expect(naverRegionBudget("JEONNAM", 7)).toBe(7);
  });

  it("attributes a run to one region only when the batch is homogeneous", () => {
    expect(uniqueRunRegion(["GWANGJU", "GWANGJU"])).toBe("GWANGJU");
    expect(uniqueRunRegion(["GWANGJU", "JEONNAM"])).toBeNull();
    expect(uniqueRunRegion([null, "JEONNAM"])).toBe("JEONNAM");
  });

  it("throws quota only for the exhausted region", () => {
    expect(() => assertNaverRegionQuota({ regionCode: "GWANGJU", used: 200, dailyLimit: 200 }))
      .toThrow(NaverLocalSearchError);
    expect(() => assertNaverRegionQuota({ regionCode: "JEONNAM", used: 0, dailyLimit: 200 }))
      .not.toThrow();
  });
});
