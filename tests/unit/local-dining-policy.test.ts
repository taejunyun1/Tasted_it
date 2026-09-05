import { describe, expect, it } from "vitest";
import { classifyLocalDining, LOCAL_DINING_POLICY_VERSION } from "../../app/features/places/local-dining-policy";

describe("local dine-in eligibility", () => {
  it.each([
    ["동네식당", "유흥주점영업", "ADULT_ENTERTAINMENT"],
    ["동네식당", "단란주점영업", "ADULT_ENTERTAINMENT"],
    ["한끼", "배달전문", "DELIVERY_ONLY"],
    ["한끼 배달전문점", "한식", "DELIVERY_ONLY"],
    ["동네마트", "슈퍼마켓", "RETAIL_MARKET"],
    ["남도식품", "식품유통전문판매업", "DISTRIBUTION_WHOLESALE"],
    ["바다수산", "수산물도매업", "DISTRIBUTION_WHOLESALE"],
    ["식품공급", "식품등수입판매업", "DISTRIBUTION_WHOLESALE"],
    ["동네판매점", "일반판매업", "RETAIL_MARKET"],
    ["GS25 동명점", "휴게음식점", "RETAIL_MARKET"],
    ["스타벅스 광주봉선DT점", "카페", "CHAIN_STORE"],
    ["광주로컬허용점", "한식", "CHAIN_STORE"],
  ])("excludes %s / %s even with a prior dine-in confirmation", (businessName, businessSubtype, reason) => {
    const decision = classifyLocalDining({ businessName, businessSubtype, localDineInConfirmed: true });
    expect(decision.decision).toBe("EXCLUDE");
    expect(decision.reasons).toContain(reason);
    expect(decision.policyVersion).toBe(LOCAL_DINING_POLICY_VERSION);
  });

  it.each(["동명 호프", "수산상회", "식품식당", "가족식당", "김선생의 밥상", "클럽샌드위치", "Curry house"])("does not exclude a name substring: %s", (businessName) => {
    expect(classifyLocalDining({ businessName, sourceType: "PLACE" }).decision).toBe("REVIEW");
  });

  it("does not infer dine-in or independence from absence of blacklist matches", () => {
    expect(classifyLocalDining({ businessName: "남도식당", sourceType: "PLACE" }))
      .toMatchObject({ decision: "REVIEW", reasons: ["LOCAL_DINE_IN_UNCONFIRMED"] });
  });

  it("accepts a confirmed local restaurant with dine-in and delivery", () => {
    expect(classifyLocalDining({ businessName: "남도식당", businessSubtype: "한식", naverCategory: "음식점>한식>국밥", localDineInConfirmed: true }))
      .toMatchObject({ decision: "ELIGIBLE", reasons: [] });
  });

  it("uses NAVER business domain before menu keywords", () => {
    expect(classifyLocalDining({ businessName: "바다상회", naverCategory: "쇼핑,유통>수산물도매" }))
      .toMatchObject({ decision: "EXCLUDE", reasons: ["DISTRIBUTION_WHOLESALE"] });
  });

  it("does not treat delivery availability as delivery-only", () => {
    expect(classifyLocalDining({ businessName: "배달도 하는 국밥", businessSubtype: "배달가능", localDineInConfirmed: true }).decision).toBe("ELIGIBLE");
  });

  it("does not infer a chain from a branch suffix or merge equal names", () => {
    expect(classifyLocalDining({ businessName: "남도밥상 2호점" }).decision).toBe("REVIEW");
  });

  it("separates a non-meal retail/bakery category from unknown data", () => {
    expect(classifyLocalDining({ businessName: "빵공장", naverCategory: "제조업>제과제빵기계" }).decision).toBe("REVIEW");
    expect(classifyLocalDining({ businessName: "식사카페", naverCategory: "카페,디저트>브런치", localDineInConfirmed: true }).decision).toBe("ELIGIBLE");
  });
});
