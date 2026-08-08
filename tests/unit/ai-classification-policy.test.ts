import { describe, expect, it } from "vitest";
import { reconcileAiClassification, validateAiClassification, validateGroundedAiClassification } from "../../app/features/candidates/ai-classification-policy";

const slugs = new Set(["ramen-detail", "gukbap-detail"]);

describe("AI category policy", () => {
  it("accepts only known slugs, bounded confidence, and short reasons", () => {
    expect(validateAiClassification({ categorySlug: "ramen-detail", confidence: 0.91, reasons: ["상호에 라멘"] }, slugs)).toEqual({ categorySlug: "ramen-detail", confidence: 0.91, reasons: ["상호에 라멘"] });
    expect(() => validateAiClassification({ categorySlug: "unknown", confidence: 0.91, reasons: [] }, slugs)).toThrow("AI_CATEGORY_UNKNOWN");
    expect(() => validateAiClassification({ categorySlug: "ramen-detail", confidence: 1.2, reasons: [] }, slugs)).toThrow("AI_OUTPUT_INVALID");
  });

  it("allows automatic review only when rule and high-confidence AI agree", () => {
    expect(reconcileAiClassification({ ruleSlug: "ramen-detail", ruleConfidence: "HIGH", ai: { categorySlug: "ramen-detail", confidence: 0.91, reasons: [] } })).toMatchObject({ eligible: true, confidence: "HIGH" });
    expect(reconcileAiClassification({ ruleSlug: "ramen-detail", ruleConfidence: "HIGH", ai: { categorySlug: "gukbap-detail", confidence: 0.99, reasons: [] } })).toMatchObject({ eligible: false, confidence: "CONFLICT" });
    expect(reconcileAiClassification({ ruleSlug: "ramen-detail", ruleConfidence: "HIGH", ai: { categorySlug: "ramen-detail", confidence: 0.7, reasons: [] } })).toMatchObject({ eligible: false, confidence: "MEDIUM" });
    expect(reconcileAiClassification({ ruleSlug: "ramen-detail", ruleConfidence: "HIGH", ai: null })).toMatchObject({ eligible: false, confidence: "MEDIUM" });
    expect(reconcileAiClassification({ ruleSlug: "ramen-detail", ruleConfidence: "MEDIUM", ai: { categorySlug: "ramen-detail", confidence: 0.99, reasons: [] } })).toMatchObject({ eligible: false, confidence: "MEDIUM" });
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
