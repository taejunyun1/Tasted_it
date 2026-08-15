import { describe, expect, it } from "vitest";
import { classifyPlaceCategoryV5 } from "../../app/features/candidates/category-v5";
import { reconcileCategoryV5Verification } from "../../app/features/candidates/category-v5-verification";

const input = (businessName: string, businessSubtype: string | null = null) => ({
  sourceType: "GENERAL_RESTAURANT" as const,
  businessName,
  businessSubtype,
});

describe("place-category-v5", () => {
  it("keeps a concrete source subtype above a broad Korean fallback", () => {
    expect(classifyPlaceCategoryV5(input("신 돼지세끼", "식육(숯불구이)"))).toMatchObject({
      primarySlug: "grill",
      state: "GREEN",
      foodPlaceScore: expect.any(Number),
    });
  });

  it("maps a source venue form for jeongjong, daepojip and sojubang to a bar", () => {
    expect(classifyPlaceCategoryV5(input("인생역전", "정종/대포집/소주방"))).toMatchObject({
      primarySlug: "pocha",
      state: "YELLOW",
    });
  });

  it.each([
    ["동명식당", "한식", "korean-general"],
    ["동명식당", "일식", "japanese-general"],
    ["동명식당", "중식", "chinese-general"],
    ["동명식당", "경양식", "western-general"],
    ["동명식당", "기타 외국식", "world-general"],
  ])("does not manufacture detail from a broad subtype %s", (businessName, businessSubtype, primarySlug) => {
    expect(classifyPlaceCategoryV5(input(businessName, businessSubtype)).primarySlug).toBe(primarySlug);
  });

  it.each([
    ["추억의 라이브카페", "일반음식점", "EXCLUDE"],
    ["동네 PC방", "일반음식점", "EXCLUDE"],
    ["CU 충장로점", "일반음식점", "EXCLUDE"],
    ["칼퇴근 김대리", "일반음식점", "MANUAL"],
  ])("does not treat non-food or ambiguous names as an automatic place: %s", (businessName, businessSubtype, decision) => {
    expect(classifyPlaceCategoryV5(input(businessName, businessSubtype)).decision).toBe(decision);
  });

  it("keeps at most four distinct secondary categories and separates traits", () => {
    const result = classifyPlaceCategoryV5(input("숯불 포차 해장국", "한식"));
    expect(result.secondarySlugs.length).toBeLessThanOrEqual(4);
    expect(new Set(result.secondarySlugs).size).toBe(result.secondarySlugs.length);
    expect(result.traits).toContain("alcoholFriendly");
  });

  it("keeps external verification bounded to already-derived categories", () => {
    const profile = classifyPlaceCategoryV5(input("신 돼지세끼", "식육(숯불구이)"));
    expect(reconcileCategoryV5Verification(profile, {
      naver: { status: "VERIFIED", categorySlug: "grill", categoryVerification: "SPECIFIC", placeType: "FOOD", matchKind: "NAME_ADDRESS", distanceMeters: 0, evidenceCodes: ["NAVER_EXACT_ADDRESS"] },
      ai: null,
    }).reasonCodes).toContain("NAVER_V2_SPECIFIC_MATCH");
  });

  it("lets AI block automatic treatment but never manufacture another category", () => {
    const profile = classifyPlaceCategoryV5(input("신 돼지세끼", "식육(숯불구이)"));
    const reconciled = reconcileCategoryV5Verification(profile, {
      naver: null,
      ai: { verdict: "CONFLICT", candidateSlug: null, evidenceCodes: [] },
    });
    expect(reconciled).toMatchObject({ primarySlug: "grill", decision: "MANUAL" });
  });
});
