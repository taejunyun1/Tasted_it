export const reviewStages = [
  "SOURCE_REVIEW",
  "NAVER_VERIFICATION",
  "CATEGORY_CONFIRMATION",
  "DUPLICATE_REVIEW",
  "FINAL_APPROVAL",
] as const;

export type ReviewStage = (typeof reviewStages)[number];
export type ReviewStatus = "ACTIVE" | "ON_HOLD" | "COMPLETED" | "EXCLUDED";
export type NaverReviewDecision = "VERIFIED" | "MATCHED" | "MANUAL_OVERRIDE" | "AMBIGUOUS" | "NOT_FOUND" | "FAILED";
export type ReviewBlockCode =
  | "SOURCE_NOT_READY"
  | "NAVER_REVIEW_REQUIRED"
  | "NAVER_RETRY_REQUIRED"
  | "CATEGORY_REQUIRED"
  | "CATEGORY_INACTIVE"
  | "DUPLICATE_REVIEW_REQUIRED"
  | "ACTIVE_EXCLUSION"
  | "ALREADY_FINAL";

export type ReviewGateEvidence = {
  sourceReady: boolean;
  naverDecision: NaverReviewDecision;
  selectedCategoryId: string | null;
  categoryActive: boolean;
  openDuplicateCount: number;
  activeExclusion: boolean;
};

export type ReviewAdvanceResult =
  | { ok: true; nextStage: ReviewStage }
  | { ok: false; code: ReviewBlockCode };

export function evaluateReviewAdvance(stage: ReviewStage, evidence: ReviewGateEvidence): ReviewAdvanceResult {
  if (stage === "SOURCE_REVIEW") {
    return evidence.sourceReady
      ? { ok: true, nextStage: "NAVER_VERIFICATION" }
      : { ok: false, code: "SOURCE_NOT_READY" };
  }

  if (stage === "NAVER_VERIFICATION") {
    if (evidence.naverDecision === "FAILED") {
      return { ok: false, code: "NAVER_RETRY_REQUIRED" };
    }
    return ["VERIFIED", "MATCHED", "MANUAL_OVERRIDE"].includes(evidence.naverDecision)
      ? { ok: true, nextStage: "CATEGORY_CONFIRMATION" }
      : { ok: false, code: "NAVER_REVIEW_REQUIRED" };
  }

  if (stage === "CATEGORY_CONFIRMATION") {
    if (!evidence.selectedCategoryId) {
      return { ok: false, code: "CATEGORY_REQUIRED" };
    }
    return evidence.categoryActive
      ? { ok: true, nextStage: "DUPLICATE_REVIEW" }
      : { ok: false, code: "CATEGORY_INACTIVE" };
  }

  if (stage === "DUPLICATE_REVIEW") {
    if (evidence.activeExclusion) {
      return { ok: false, code: "ACTIVE_EXCLUSION" };
    }
    return evidence.openDuplicateCount === 0
      ? { ok: true, nextStage: "FINAL_APPROVAL" }
      : { ok: false, code: "DUPLICATE_REVIEW_REQUIRED" };
  }

  return { ok: false, code: "ALREADY_FINAL" };
}
