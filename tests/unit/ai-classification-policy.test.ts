import { describe, expect, it } from "vitest";
import { reconcileAiClassification, validateAiClassification, validateGroundedAiClassification } from "../../app/features/candidates/ai-classification-policy";

const slugs = new Set(["ramen-detail", "gukbap-detail"]);

describe("AI category policy", () => {
  it("accepts only known slugs, bounded confidence, and short reasons", () => {
    expect(validateAiClassification({ categorySlug: "ramen-detail", confidence: 0.91, reasons: ["상호에 라멘"] }, slugs)).toEqual({ categorySlug: "ramen-detail", confidence: 0.91, reasons: ["상호에 라멘"] });
    expect(() => validateAiClassification({ categorySlug: "unknown", confidence: 0.91, reasons: [] }, slugs)).toThrow("AI_CATEGORY_UNKNOWN");
    expect(() => validateAiClassification({ categorySlug: "ramen-detail", confidence: 1.2, reasons: [] }, slugs)).toThrow("AI_OUTPUT_INVALID");
  });

  it("keeps the rule score and grade when AI is absent", () => {
    expect(reconcileAiClassification({ ruleSlug: "ramen-detail", ruleConfidence: "HIGH", ruleScore: 82, ai: null }))
      .toMatchObject({ categorySlug: "ramen-detail", confidence: "HIGH", confidenceScore: 82, eligible: false });
  });

  it("adds an AI agreement bonus and approves only a verified high result", () => {
    expect(reconcileAiClassification({
      ruleSlug: "ramen-detail",
      ruleConfidence: "MEDIUM",
      ruleScore: 70,
      ai: { categorySlug: "ramen-detail", confidence: 0.9, reasons: [] },
    })).toMatchObject({ categorySlug: "ramen-detail", confidence: "HIGH", confidenceScore: 79, eligible: true });

    expect(reconcileAiClassification({
      ruleSlug: "ramen-detail",
      ruleConfidence: "MEDIUM",
      ruleScore: 55,
      ai: { categorySlug: "ramen-detail", confidence: 0.99, reasons: [] },
    })).toMatchObject({ categorySlug: "ramen-detail", confidence: "MEDIUM", confidenceScore: 65, eligible: false });
  });

  it("keeps the rule slug and lowers the score for a weak AI disagreement", () => {
    expect(reconcileAiClassification({
      ruleSlug: "ramen-detail",
      ruleConfidence: "HIGH",
      ruleScore: 82,
      ai: { categorySlug: "gukbap-detail", confidence: 0.7, reasons: [] },
    })).toMatchObject({ categorySlug: "ramen-detail", confidence: "MEDIUM", confidenceScore: 72, eligible: false });
  });

  it("keeps the rule slug and marks a strong AI disagreement as conflict", () => {
    expect(reconcileAiClassification({
      ruleSlug: "ramen-detail",
      ruleConfidence: "HIGH",
      ruleScore: 82,
      ai: { categorySlug: "gukbap-detail", confidence: 0.95, reasons: [] },
    })).toMatchObject({ categorySlug: "ramen-detail", confidence: "CONFLICT", confidenceScore: 82, eligible: false });
  });

  it("does not let AI agreement resolve an existing rule conflict", () => {
    expect(reconcileAiClassification({
      ruleSlug: "ramen-detail",
      ruleConfidence: "CONFLICT",
      ruleScore: 82,
      ai: { categorySlug: "ramen-detail", confidence: 0.99, reasons: [] },
    })).toMatchObject({ categorySlug: "ramen-detail", confidence: "CONFLICT", confidenceScore: 82, eligible: false });
  });

  it("rejects AI evidence that is absent from the supplied business data", () => {
    expect(() => validateGroundedAiClassification(
      { categorySlug: "gimbap", confidence: 0.8, evidence: ["gimbap"], reasons: ["김밥"] },
      new Set(["gimbap"]),
      "콩물동부육계장 기타",
    )).toThrow("AI_EVIDENCE_UNGROUNDED");
  });

  it("keeps grounded evidence and drops invented evidence", () => {
    expect(validateGroundedAiClassification({
      categorySlug: "bakery-detail",
      confidence: 0.94,
      evidence: ["꽈배기", "베이커리"],
      reasons: ["꽈배기 전문점"],
    }, new Set(["bakery-detail"]), "다시마 꽈배기 제과점영업")).toMatchObject({
      categorySlug: "bakery-detail",
      evidence: ["꽈배기"],
    });
  });

  it("rejects when every evidence token is invented", () => {
    expect(() => validateGroundedAiClassification({
      categorySlug: "bakery-detail",
      confidence: 0.9,
      evidence: ["도넛"],
      reasons: [],
    }, new Set(["bakery-detail"]), "다시마 꽈배기 제과점영업"))
      .toThrow("AI_EVIDENCE_UNGROUNDED");
  });
});
