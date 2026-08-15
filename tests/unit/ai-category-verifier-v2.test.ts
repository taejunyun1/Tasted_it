import { describe, expect, it } from "vitest";
import { reconcileAiCategoryVerifierV2, validateAiCategoryVerifierV2 } from "../../app/features/candidates/ai-category-verifier-v2";

describe("AI category verifier v2", () => {
  it("accepts only candidate-bounded, grounded evidence", () => {
    expect(validateAiCategoryVerifierV2({ verdict: "SUPPORTED", candidateSlug: "grill", evidenceCodes: ["SUBTYPE_GRILL"] }, ["grill"], new Set(["SUBTYPE_GRILL"]))).toMatchObject({ verdict: "SUPPORTED" });
    expect(() => validateAiCategoryVerifierV2({ verdict: "SUPPORTED", candidateSlug: "pub", evidenceCodes: ["SUBTYPE_GRILL"] }, ["grill"], new Set(["SUBTYPE_GRILL"]))).toThrow("AI_V2_CANDIDATE_OUTSIDE_SET");
  });

  it("can force manual review but cannot create an automatic public change", () => {
    expect(reconcileAiCategoryVerifierV2({ ruleDecision: "AUTO", verifier: { verdict: "CONFLICT", candidateSlug: null, evidenceCodes: [] } })).toBe("MANUAL");
    expect(reconcileAiCategoryVerifierV2({ ruleDecision: "MANUAL", verifier: { verdict: "SUPPORTED", candidateSlug: "grill", evidenceCodes: [] } })).toBe("MANUAL");
  });
});
