import { describe, expect, it } from "vitest";
import { reconcileAiCategoryVerifierV2, validateAiCategoryVerifierV2 } from "../../app/features/candidates/ai-category-verifier-v2";
import { verifyAiCategoryV2 } from "../../app/features/candidates/ai-category-verifier-v2.server";

describe("AI category verifier v2", () => {
  it("accepts only candidate-bounded, grounded evidence", () => {
    expect(validateAiCategoryVerifierV2({ verdict: "SUPPORTED", candidateSlug: "grill", evidenceCodes: ["SUBTYPE_GRILL"] }, ["grill"], new Set(["SUBTYPE_GRILL"]))).toMatchObject({ verdict: "SUPPORTED" });
    expect(() => validateAiCategoryVerifierV2({ verdict: "SUPPORTED", candidateSlug: "pub", evidenceCodes: ["SUBTYPE_GRILL"] }, ["grill"], new Set(["SUBTYPE_GRILL"]))).toThrow("AI_V2_CANDIDATE_OUTSIDE_SET");
  });

  it("can force manual review but cannot create an automatic public change", () => {
    expect(reconcileAiCategoryVerifierV2({ ruleDecision: "AUTO", verifier: { verdict: "CONFLICT", candidateSlug: null, evidenceCodes: [] } })).toBe("MANUAL");
    expect(reconcileAiCategoryVerifierV2({ ruleDecision: "MANUAL", verifier: { verdict: "SUPPORTED", candidateSlug: "grill", evidenceCodes: [] } })).toBe("MANUAL");
  });

  it("passes only bounded metadata to AI and fails closed on invalid responses", async () => {
    const verifier = await verifyAiCategoryV2({
      ai: { run: async (_model, input) => {
        expect(JSON.stringify(input)).not.toContain("광주광역시 서구");
        return { response: { verdict: "SUPPORTED", candidateSlug: "grill", evidenceCodes: ["SUBTYPE_GRILL"] } };
      } } as unknown as Ai,
      businessName: "신 돼지세끼",
      businessSubtype: "식육(숯불구이)",
      candidateSlugs: ["grill", "korean-general"],
      evidenceCodes: ["SUBTYPE_GRILL"],
    });
    expect(verifier).toMatchObject({ verdict: "SUPPORTED", candidateSlug: "grill" });
    await expect(verifyAiCategoryV2({
      ai: { run: async () => ({ response: { verdict: "SUPPORTED", candidateSlug: "other", evidenceCodes: [] } }) } as unknown as Ai,
      businessName: "신 돼지세끼", businessSubtype: null, candidateSlugs: ["grill"], evidenceCodes: [],
    })).resolves.toBeNull();
  });
});
