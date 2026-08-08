import { describe, expect, it } from "vitest";

import { classifyAutomaticExclusion } from "../../app/features/candidates/exclusion-policy";

describe("classifyAutomaticExclusion", () => {
  it.each([
    { businessName: "황제 룸싸롱", businessSubtype: "유흥주점영업" },
    { businessName: "로얄룸살롱", businessSubtype: "일반음식점" },
    { businessName: "상호 없는 유흥업소", businessSubtype: "유흥주점영업" },
  ])("excludes adult entertainment candidate $businessName", (candidate) => {
    expect(classifyAutomaticExclusion(candidate)).toMatchObject({
      reason: "ADULT_ENTERTAINMENT",
      exclusionCategory: "ADULT_ENTERTAINMENT",
      confidence: 1,
    });
  });

  it("does not automatically exclude a karaoke bar subtype", () => {
    expect(classifyAutomaticExclusion({
      businessName: "동네 단란주점",
      businessSubtype: "단란주점영업",
    })).toBeNull();
  });

  it("returns chain matching evidence for a high-confidence franchise", () => {
    expect(classifyAutomaticExclusion({
      businessName: "스타벅스 광주봉선DT점",
      businessSubtype: "휴게음식점",
    })).toMatchObject({
      reason: "CHAIN_STORE",
      matchedRule: "STARBUCKS",
      matchedBrand: "스타벅스",
      matchMethod: "BRAND_PREFIX",
      confidence: 0.95,
    });
  });
});
