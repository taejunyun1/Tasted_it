import { describe, expect, it } from "vitest";

import { nextUniqueSlug, prefixedSlugRedirect, slugifyPlaceName } from "../../app/features/places/place-slug";
import {
  ACTIVE_REGION_CODES,
  LAUNCH_DEFAULT_BBOX,
  LAUNCH_DEFAULT_CENTER,
  LAUNCH_NAVER_DAILY_BUDGET_TOTAL,
  LAUNCH_PUBLIC_DATA_ADDRESS_PREFIX,
  REGION_PACKS,
  activeMarketBbox,
  addressLikePatterns,
  extractDistrictRef,
  isCoordinateInActiveMarket,
  isSupportedRegionAddress,
  normalizeSupportedRegionAddress,
  regionFromAddress,
} from "../../app/features/regions/region-pack";
import { DEFAULT_BBOX } from "../../app/features/maps/map-state";

describe("region pack", () => {
  it("keeps the launch market as Gwangju and Jeonnam only", () => {
    expect(ACTIVE_REGION_CODES).toEqual(["GWANGJU", "JEONNAM"]);
    expect(Object.keys(REGION_PACKS)).toEqual(["GWANGJU", "JEONNAM"]);
    expect(LAUNCH_PUBLIC_DATA_ADDRESS_PREFIX).toBe("전남광주통합특별시");
  });

  it("uses one public-map bbox and center as the default source", () => {
    expect(DEFAULT_BBOX).toEqual(LAUNCH_DEFAULT_BBOX);
    expect(REGION_PACKS.GWANGJU.defaultBbox).toEqual(LAUNCH_DEFAULT_BBOX);
    expect(REGION_PACKS.JEONNAM.defaultBbox).toEqual(LAUNCH_DEFAULT_BBOX);
    expect(REGION_PACKS.GWANGJU.defaultCenter).toEqual(LAUNCH_DEFAULT_CENTER);
    expect(REGION_PACKS.JEONNAM.defaultCenter).toEqual(LAUNCH_DEFAULT_CENTER);
    expect(LAUNCH_DEFAULT_BBOX).toEqual([126.72, 35.03, 127.02, 35.25]);
  });

  it("classifies addresses into GWANGJU or JEONNAM", () => {
    expect(regionFromAddress("광주광역시 동구 서석로 1")).toBe("GWANGJU");
    expect(regionFromAddress("광주 북구 용봉동 1")).toBe("GWANGJU");
    expect(regionFromAddress("전라남도 무안군 삼향읍 남악로 12")).toBe("JEONNAM");
    expect(regionFromAddress("전남 목포시 영산로 1")).toBe("JEONNAM");
    expect(regionFromAddress("전남광주통합특별시 광산구 풍영로 1")).toBe("GWANGJU");
    expect(regionFromAddress("전남광주통합특별시 목포시 영산로 1")).toBe("JEONNAM");
    expect(regionFromAddress("서울특별시 종로구 세종대로 1")).toBeNull();
  });

  it("does not treat 전주 or 전북 as JEONNAM", () => {
    expect(regionFromAddress("전주시 완산구 전주객사3길 22")).toBeNull();
    expect(regionFromAddress("전라북도 전주시 완산구 중앙동 1")).toBeNull();
    expect(regionFromAddress("전북 군산시 해망로 1")).toBeNull();
    expect(isSupportedRegionAddress("전주시 완산구 전주객사3길 22")).toBe(false);
    expect(addressLikePatterns("JEONNAM")).toEqual(["전라남도%", "전남%"]);
    expect(addressLikePatterns("JEONNAM").some((pattern) => pattern === "전%")).toBe(false);
  });

  it("normalizes the unified Gwangju prefix in one function", () => {
    expect(normalizeSupportedRegionAddress("전남광주통합특별시 동구 서석로 1"))
      .toBe("광주광역시 동구 서석로 1");
    expect(normalizeSupportedRegionAddress("전남광주 북구 용봉동 1403-1"))
      .toBe("광주광역시 북구 용봉동 1403-1");
    expect(normalizeSupportedRegionAddress("전라남도 무안군 삼향읍 남악로 12"))
      .toBe("전라남도 무안군 삼향읍 남악로 12");
  });

  it("accepts only supported-region addresses", () => {
    expect(isSupportedRegionAddress("광주광역시 동구 서석로 1")).toBe(true);
    expect(isSupportedRegionAddress("전라남도 여수시 중앙로 1")).toBe(true);
    expect(isSupportedRegionAddress("부산광역시 중구 중앙대로 1")).toBe(false);
  });

  it("extracts districts with a city prefix and leaves the short name for labels", () => {
    expect(extractDistrictRef("광주광역시 동구 서석로 1")).toEqual({ regionCode: "GWANGJU", name: "동구" });
    expect(extractDistrictRef("전라남도 담양군 담양읍 중앙로 1")).toEqual({ regionCode: "JEONNAM", name: "담양군" });
    expect(extractDistrictRef("부산광역시 동구 중앙대로 1")).toBeNull();
  });

  it("uses the service-area union for coordinate checks, not a third bbox", () => {
    expect(activeMarketBbox()).toEqual([125, 33.85, 127.85, 35.55]);
    expect(isCoordinateInActiveMarket(35.1595, 126.8526)).toBe(true);
    expect(isCoordinateInActiveMarket(34.7604, 127.6622)).toBe(true);
    expect(isCoordinateInActiveMarket(35.8242, 127.148)).toBe(false);
    expect(isCoordinateInActiveMarket(33.4996, 126.5312)).toBe(false);
  });

  it("splits the NAVER daily budget per pack so one region cannot starve the other", () => {
    expect(REGION_PACKS.GWANGJU.naverDailyBudget + REGION_PACKS.JEONNAM.naverDailyBudget).toBe(LAUNCH_NAVER_DAILY_BUDGET_TOTAL);
    expect(REGION_PACKS.GWANGJU.naverDailyBudget).toBe(REGION_PACKS.JEONNAM.naverDailyBudget);
    expect(REGION_PACKS.GWANGJU.naverSearchEnabled).toBe(true);
    expect(REGION_PACKS.JEONNAM.naverSearchEnabled).toBe(true);
  });

  it("applies slugPrefix only when a pack supplies one", () => {
    expect(REGION_PACKS.GWANGJU.slugPrefix).toBe("");
    expect(REGION_PACKS.JEONNAM.slugPrefix).toBe("");
    expect(slugifyPlaceName("김밥천국")).toBe("김밥천국");
    expect(slugifyPlaceName("김밥천국", "jeju")).toBe("jeju-김밥천국");
  });

  it("proves a test-only non-empty slugPrefix pack does not loop redirects or change live prefixes", () => {
    const fakePack = { ...REGION_PACKS.GWANGJU, slugPrefix: "lab" } as const;
    expect(REGION_PACKS.GWANGJU.slugPrefix).toBe("");
    expect(REGION_PACKS.JEONNAM.slugPrefix).toBe("");
    const redirect = prefixedSlugRedirect("김밥천국", fakePack.slugPrefix);
    expect(redirect.current).toBe("lab-김밥천국");
    expect(redirect.unprefixed).toBe("김밥천국");
    expect(redirect.needsRedirect).toBe(true);
    expect(redirect.loops).toBe(false);
    expect(nextUniqueSlug(redirect.current, new Set([redirect.current]))).toBe("lab-김밥천국-2");
    expect(nextUniqueSlug(redirect.unprefixed, new Set([redirect.current]))).toBe("김밥천국");
  });
});
