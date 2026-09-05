import { describe, expect, it } from "vitest";
import { evaluateReviewAdvance, hasManualReviewEvidence, naverNeedsConfirmation } from "../../app/features/places/place-review-pipeline";

const ready = {
  sourceReady: true,
  naverDecision: "VERIFIED" as const,
  selectedCategoryId: "cat-local",
  categoryActive: true,
  openDuplicateCount: 0,
  activeExclusion: false,
  localDiningDecision: "ELIGIBLE" as const,
};

describe("place review stage gates", () => {
  it("never interprets missing local/dine-in evidence as eligibility", () => {
    expect(evaluateReviewAdvance("CATEGORY_CONFIRMATION", { ...ready, localDiningDecision: "REVIEW" })).toEqual({ ok: false, code: "LOCAL_DINING_REVIEW_REQUIRED" });
    expect(evaluateReviewAdvance("DUPLICATE_REVIEW", { ...ready, localDiningDecision: "REVIEW" })).toEqual({ ok: false, code: "LOCAL_DINING_REVIEW_REQUIRED" });
    expect(evaluateReviewAdvance("SOURCE_REVIEW", { ...ready, localDiningDecision: "EXCLUDE" })).toEqual({ ok: false, code: "ACTIVE_EXCLUSION" });
  });
  it("moves exactly one stage", () => {
    expect(evaluateReviewAdvance("SOURCE_REVIEW", ready)).toEqual({ ok: true, nextStage: "NAVER_VERIFICATION" });
    expect(evaluateReviewAdvance("NAVER_VERIFICATION", ready)).toEqual({ ok: true, nextStage: "CATEGORY_CONFIRMATION" });
  });

  it("blocks NAVER failures and permits a recorded manual evidence approval", () => {
    expect(evaluateReviewAdvance("NAVER_VERIFICATION", { ...ready, naverDecision: "FAILED" }))
      .toEqual({ ok: false, code: "NAVER_RETRY_REQUIRED" });
    expect(evaluateReviewAdvance("NAVER_VERIFICATION", { ...ready, naverDecision: "NOT_FOUND" }))
      .toEqual({ ok: false, code: "NAVER_REVIEW_REQUIRED" });
    expect(evaluateReviewAdvance("NAVER_VERIFICATION", { ...ready, naverDecision: "AMBIGUOUS" }))
      .toEqual({ ok: false, code: "NAVER_REVIEW_REQUIRED" });
    expect(evaluateReviewAdvance("NAVER_VERIFICATION", { ...ready, naverDecision: "MANUAL_OVERRIDE" }))
      .toEqual({ ok: true, nextStage: "CATEGORY_CONFIRMATION" });
  });

  it("treats NO_MATCH-like NAVER statuses as confirmation-needed and requires 20 characters of manual evidence", () => {
    expect(naverNeedsConfirmation("NO_MATCH")).toBe(true);
    expect(naverNeedsConfirmation("NOT_FOUND")).toBe(true);
    expect(naverNeedsConfirmation("VERIFIED")).toBe(false);
    expect(hasManualReviewEvidence("주소 확인 후 수동 이동")).toBe(false);
    expect(hasManualReviewEvidence("공공데이터 원천과 현장 상호가 같아 수동으로 넘긴다")).toBe(true);
  });

  it("blocks unresolved duplicates and exclusions", () => {
    expect(evaluateReviewAdvance("DUPLICATE_REVIEW", { ...ready, openDuplicateCount: 1 }))
      .toEqual({ ok: false, code: "DUPLICATE_REVIEW_REQUIRED" });
    expect(evaluateReviewAdvance("DUPLICATE_REVIEW", { ...ready, activeExclusion: true }))
      .toEqual({ ok: false, code: "ACTIVE_EXCLUSION" });
  });

  it("requires source and category evidence before their respective next stages", () => {
    expect(evaluateReviewAdvance("SOURCE_REVIEW", { ...ready, sourceReady: false }))
      .toEqual({ ok: false, code: "SOURCE_NOT_READY" });
    expect(evaluateReviewAdvance("CATEGORY_CONFIRMATION", { ...ready, selectedCategoryId: null }))
      .toEqual({ ok: false, code: "CATEGORY_REQUIRED" });
    expect(evaluateReviewAdvance("CATEGORY_CONFIRMATION", { ...ready, categoryActive: false }))
      .toEqual({ ok: false, code: "CATEGORY_INACTIVE" });
  });

  it("does not advance beyond final approval", () => {
    expect(evaluateReviewAdvance("FINAL_APPROVAL", ready)).toEqual({ ok: false, code: "ALREADY_FINAL" });
  });
});
