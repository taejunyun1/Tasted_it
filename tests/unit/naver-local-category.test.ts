import { describe, expect, it } from "vitest";

import { classifyCandidate, getAuthoritativeSubtypeCategorySlug, getStrongestNameFoodCategorySlug } from "../../app/features/candidates/category-suggestion";
import { decideCategoryAuthority, matchNaverLocalCategory } from "../../app/features/candidates/naver-local-category";

const terminalSlugs = new Set([
  "bakery-detail",
  "grill",
  "gukbap-detail",
  "home-meal",
  "pocha",
  "ramen-detail",
  "seafood-dish",
]);

function rule(input: { businessName: string; businessSubtype?: string | null }) {
  return classifyCandidate({
    sourceType: "GENERAL_RESTAURANT",
    businessName: input.businessName,
    businessSubtype: input.businessSubtype,
    address: "광주광역시 서구 군분로159번길 15-25",
  });
}

describe("NAVER local category authority", () => {
  it("uses an exact name/address match and specific meat category when the source agrees", () => {
    const candidate = rule({ businessName: "신 돼지세끼", businessSubtype: "식육(숯불구이)" });
    const naver = matchNaverLocalCategory({
      businessName: "신 돼지세끼",
      address: "광주광역시 서구 군분로159번길 15-25",
      latitude: 35.14484,
      longitude: 126.88617,
      regionCode: "GWANGJU",
      terminalSlugs,
      results: [{
        name: "신돼지세끼 본점",
        category: "음식점>한식>육류,고기요리",
        address: "광주광역시 서구 군분로159번길 15-25",
        latitude: 35.14484,
        longitude: 126.88617,
      }],
    });

    expect(naver).toMatchObject({
      status: "VERIFIED",
      mappedCategorySlug: "grill",
      matchScore: 40,
      specificityScore: 20,
      evidenceCodes: expect.arrayContaining(["NAVER_BRANCH_NORMALIZED_NAME", "NAVER_EXACT_ADDRESS", "NAVER_SPECIFIC_CATEGORY"]),
    });
    expect(decideCategoryAuthority({
      rule: candidate,
      subtypeSlug: getAuthoritativeSubtypeCategorySlug({ sourceType: "GENERAL_RESTAURANT", businessName: "신 돼지세끼", businessSubtype: "식육(숯불구이)" }, candidate),
      nameSlug: getStrongestNameFoodCategorySlug({ sourceType: "GENERAL_RESTAURANT", businessName: "신 돼지세끼", businessSubtype: "식육(숯불구이)" }),
      naver,
    })).toMatchObject({ categorySlug: "grill", confidence: "HIGH", confidenceScore: 80, automatic: true });
  });

  it("keeps a concrete 정종·대포집·소주방 subtype when NAVER only returns a broad restaurant category", () => {
    const candidate = rule({ businessName: "인생역전", businessSubtype: "정종/대포집/소주방" });
    const naver = matchNaverLocalCategory({
      businessName: "인생역전",
      address: "광주광역시 광산구 임방울대로 825",
      latitude: 35.22091,
      longitude: 126.84989,
      regionCode: "GWANGJU",
      terminalSlugs,
      results: [{
        name: "인생역전",
        category: "음식점>한식",
        address: "광주광역시 광산구 임방울대로 825",
        latitude: 35.22091,
        longitude: 126.84989,
      }],
    });

    expect(naver).toMatchObject({ status: "VERIFIED", mappedCategorySlug: null, specificityScore: 0 });
    expect(decideCategoryAuthority({
      rule: candidate,
      subtypeSlug: "pocha",
      nameSlug: null,
      naver,
    })).toMatchObject({ categorySlug: "pocha", automatic: false });
  });

  it("keeps a concrete seafood name over a broad NAVER category", () => {
    const candidate = rule({ businessName: "풍천장어구이", businessSubtype: "한식" });
    const naver = matchNaverLocalCategory({
      businessName: "풍천장어구이",
      address: "광주광역시 서구 군분로159번길 15-25",
      latitude: null,
      longitude: null,
      regionCode: "GWANGJU",
      terminalSlugs,
      results: [{
        name: "풍천 장어구이",
        category: "음식점>한식",
        address: "광주광역시 서구 군분로159번길 15-25",
        latitude: 35.14484,
        longitude: 126.88617,
      }],
    });

    expect(getStrongestNameFoodCategorySlug({ sourceType: "GENERAL_RESTAURANT", businessName: "풍천장어구이", businessSubtype: "한식" })).toBe("seafood-dish");
    expect(decideCategoryAuthority({
      rule: candidate,
      subtypeSlug: null,
      nameSlug: "seafood-dish",
      naver,
    })).toMatchObject({ categorySlug: "seafood-dish", automatic: false });
  });

  it("does not automatically apply when a verified specific NAVER category conflicts with a concrete source subtype", () => {
    const candidate = rule({ businessName: "동명식당", businessSubtype: "식육(숯불구이)" });
    const naver = matchNaverLocalCategory({
      businessName: "동명식당",
      address: "광주광역시 동구 예술길 1",
      latitude: null,
      longitude: null,
      regionCode: "GWANGJU",
      terminalSlugs,
      results: [{
        name: "동명식당",
        category: "음식점>카페/디저트>베이커리",
        address: "광주광역시 동구 예술길 1",
        latitude: 35.15,
        longitude: 126.92,
      }],
    });

    expect(decideCategoryAuthority({
      rule: candidate,
      subtypeSlug: "grill",
      nameSlug: null,
      naver,
    })).toMatchObject({ categorySlug: "grill", confidence: "CONFLICT", automatic: false });
  });

  it("keeps collisions and out-of-region results out of automatic updates", () => {
    const ambiguous = matchNaverLocalCategory({
      businessName: "동명식당",
      address: "광주광역시 동구 예술길 1",
      latitude: null,
      longitude: null,
      regionCode: "GWANGJU",
      terminalSlugs,
      results: [
        { name: "동명식당", category: "음식점>한식>백반,가정식", address: "광주광역시 동구 예술길 1", latitude: 35.15, longitude: 126.92 },
        { name: "동명식당", category: "음식점>한식>육류,고기요리", address: "광주광역시 동구 예술길 1", latitude: 35.15, longitude: 126.92 },
      ],
    });
    const outOfScope = matchNaverLocalCategory({
      businessName: "목포식당",
      address: "전라남도 목포시 영산로 1",
      latitude: null,
      longitude: null,
      regionCode: "JEONNAM",
      terminalSlugs,
      results: [{ name: "목포식당", category: "음식점>한식>백반,가정식", address: "광주광역시 동구 예술길 1", latitude: 35.15, longitude: 126.92 }],
    });

    expect(ambiguous).toMatchObject({ status: "AMBIGUOUS", mappedCategorySlug: null });
    expect(outOfScope).toMatchObject({ status: "OUT_OF_SCOPE", mappedCategorySlug: null });
  });

  it("accepts a coordinate match within 100m when road-address formatting differs", () => {
    const match = matchNaverLocalCategory({
      businessName: "광주국밥",
      address: "광주광역시 서구 군분로 15",
      latitude: 35.14484,
      longitude: 126.88617,
      regionCode: "GWANGJU",
      terminalSlugs,
      results: [{
        name: "광주 국밥",
        category: "음식점>한식>국밥",
        address: "광주광역시 서구 화정동 15",
        latitude: 35.1452,
        longitude: 126.88617,
      }],
    });

    expect(match).toMatchObject({
      status: "VERIFIED",
      mappedCategorySlug: "gukbap-detail",
      evidenceCodes: expect.arrayContaining(["NAVER_COORDINATES_WITHIN_100M"]),
    });
  });
});
