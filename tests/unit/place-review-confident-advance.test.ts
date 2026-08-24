import { describe, expect, it } from "vitest";

import { confidentAdvanceAllowed } from "../../app/features/places/place-review-pipeline";

const ready = {
  sourceReady: true,
  naverDecision: "VERIFIED" as const,
  selectedCategoryId: "cat-leaf",
  categoryActive: true,
  openDuplicateCount: 0,
  activeExclusion: false,
  categoryLeaf: true,
  hasManualEvidence: false,
};

describe("confidentAdvanceAllowed", () => {
  it("allows source, verified leaf NAVER, leaf category, and closed duplicates", () => {
    expect(confidentAdvanceAllowed("SOURCE_REVIEW", ready)).toBe(true);
    expect(confidentAdvanceAllowed("NAVER_VERIFICATION", ready)).toBe(true);
    expect(confidentAdvanceAllowed("NAVER_VERIFICATION", { ...ready, naverDecision: "MATCHED" })).toBe(true);
    expect(confidentAdvanceAllowed("CATEGORY_CONFIRMATION", ready)).toBe(true);
    expect(confidentAdvanceAllowed("DUPLICATE_REVIEW", ready)).toBe(true);
  });

  it("rejects a broad mapped category at NAVER and category stages", () => {
    const broad = { ...ready, categoryLeaf: false };
    expect(confidentAdvanceAllowed("NAVER_VERIFICATION", broad)).toBe(false);
    expect(confidentAdvanceAllowed("CATEGORY_CONFIRMATION", broad)).toBe(false);
    expect(confidentAdvanceAllowed("SOURCE_REVIEW", broad)).toBe(true);
  });

  it("rejects no-match, not-found, ambiguous, and failed NAVER decisions", () => {
    expect(confidentAdvanceAllowed("NAVER_VERIFICATION", { ...ready, naverDecision: "NOT_FOUND" })).toBe(false);
    expect(confidentAdvanceAllowed("NAVER_VERIFICATION", { ...ready, naverDecision: "AMBIGUOUS" })).toBe(false);
    expect(confidentAdvanceAllowed("NAVER_VERIFICATION", { ...ready, naverDecision: "FAILED" })).toBe(false);
  });

  it("rejects a manual override unless human evidence is already recorded", () => {
    expect(confidentAdvanceAllowed("NAVER_VERIFICATION", {
      ...ready,
      naverDecision: "MANUAL_OVERRIDE",
      hasManualEvidence: false,
    })).toBe(false);
    expect(confidentAdvanceAllowed("NAVER_VERIFICATION", {
      ...ready,
      naverDecision: "MANUAL_OVERRIDE",
      hasManualEvidence: true,
    })).toBe(true);
  });

  it("rejects open duplicates and active exclusions", () => {
    expect(confidentAdvanceAllowed("DUPLICATE_REVIEW", { ...ready, openDuplicateCount: 1 })).toBe(false);
    expect(confidentAdvanceAllowed("DUPLICATE_REVIEW", { ...ready, activeExclusion: true })).toBe(false);
    expect(confidentAdvanceAllowed("SOURCE_REVIEW", { ...ready, activeExclusion: true })).toBe(false);
  });

  it("never allows final approval", () => {
    expect(confidentAdvanceAllowed("FINAL_APPROVAL", ready)).toBe(false);
  });
});
