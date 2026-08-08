import { describe, expect, it } from "vitest";

import { auditClassifications } from "../../app/features/candidates/classification-audit";

describe("auditClassifications", () => {
  it("returns aggregate counts without retaining business data", () => {
    expect(auditClassifications([
      { categorySlug: "bakery-detail", confidence: "HIGH" },
      { categorySlug: "seafood-dish", confidence: "MEDIUM" },
      { categorySlug: "home-meal", confidence: "LOW" },
    ], new Set(["bakery-detail", "seafood-dish"]))).toEqual({
      total: 3,
      byCategory: { "bakery-detail": 1, "seafood-dish": 1, "home-meal": 1 },
      byConfidence: { HIGH: 1, MEDIUM: 1, LOW: 1, CONFLICT: 0 },
      unknownCategoryCount: 1,
      lowOrConflictCount: 1,
    });
  });
});
