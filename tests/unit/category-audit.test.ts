import { describe, expect, it } from "vitest";

import { auditCategoryClassifications } from "../../app/features/candidates/category-audit";

describe("auditCategoryClassifications", () => {
  it("aggregates categories and confidence without retaining business names", () => {
    const result = auditCategoryClassifications([
      { sourceType: "GENERAL_RESTAURANT", businessSubtype: "한식", businessName: "풍천장어구이" },
      { sourceType: "ENTERTAINMENT_BAR", businessSubtype: "유흥주점영업", businessName: "별밤 라이브카페" },
      { sourceType: "GENERAL_RESTAURANT", businessSubtype: null, businessName: "사과농장" },
    ]);

    expect(result).toEqual({
      total: 3,
      categoryCounts: { "home-meal": 1, pub: 1, "seafood-dish": 1 },
      confidenceCounts: { CONFLICT: 0, HIGH: 2, LOW: 1, MEDIUM: 0 },
      manualReviewCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("풍천장어구이");
  });
});
