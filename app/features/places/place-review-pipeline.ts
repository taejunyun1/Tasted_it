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

export type ConfidentAdvanceEvidence = ReviewGateEvidence & {
  categoryLeaf: boolean;
  hasManualEvidence: boolean;
};

const confidentNaverDecisions = new Set<NaverReviewDecision>([
  "VERIFIED",
  "MATCHED",
]);

export const MANUAL_EVIDENCE_REASON_MIN = 20;

const naverConfirmationStatuses = new Set([
  "NO_MATCH",
  "NOT_FOUND",
  "AMBIGUOUS",
  "LIKELY",
  "FAILED",
  "ERROR",
  "OUT_OF_SCOPE",
]);

export function hasManualReviewEvidence(reason?: string | null) {
  return (reason?.trim().length ?? 0) >= MANUAL_EVIDENCE_REASON_MIN;
}

export function naverNeedsConfirmation(status?: string | null) {
  return Boolean(status && naverConfirmationStatuses.has(status));
}

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

export function isConfidentAdvanceEnabled(value?: string | null) {
  return value === "true";
}

/**
 * Stamp-only gate for 1→4. Never returns true at FINAL_APPROVAL.
 * Does not publish, call NAVER, or invent manual evidence text.
 */
export function confidentAdvanceAllowed(
  stage: ReviewStage,
  evidence: ConfidentAdvanceEvidence,
): boolean {
  if (stage === "FINAL_APPROVAL") return false;
  if (evidence.activeExclusion) return false;

  if (stage === "NAVER_VERIFICATION") {
    if (evidence.naverDecision === "MANUAL_OVERRIDE") {
      if (!evidence.hasManualEvidence || !evidence.categoryLeaf) return false;
    } else if (!confidentNaverDecisions.has(evidence.naverDecision) || !evidence.categoryLeaf) {
      return false;
    }
  }

  if (stage === "CATEGORY_CONFIRMATION" && !evidence.categoryLeaf) return false;

  return evaluateReviewAdvance(stage, evidence).ok;
}

/**
 * Skip code for a stage that `confidentAdvanceAllowed` refused.
 * Extra confident-gate reasons (exclusion, missing leaf, missing manual evidence)
 * are not collapsed into CATEGORY_REQUIRED when evaluateReviewAdvance is still ok.
 */
export function confidentAdvanceSkipCode(
  stage: ReviewStage,
  evidence: ConfidentAdvanceEvidence,
): ReviewBlockCode {
  if (stage === "FINAL_APPROVAL") return "ALREADY_FINAL";
  if (evidence.activeExclusion) return "ACTIVE_EXCLUSION";

  if (stage === "NAVER_VERIFICATION") {
    if (evidence.naverDecision === "MANUAL_OVERRIDE") {
      if (!evidence.hasManualEvidence) return "NAVER_REVIEW_REQUIRED";
      if (!evidence.categoryLeaf) return "CATEGORY_REQUIRED";
    } else if (!confidentNaverDecisions.has(evidence.naverDecision)) {
      return evidence.naverDecision === "FAILED" ? "NAVER_RETRY_REQUIRED" : "NAVER_REVIEW_REQUIRED";
    } else if (!evidence.categoryLeaf) {
      return "CATEGORY_REQUIRED";
    }
  }

  if (stage === "CATEGORY_CONFIRMATION" && !evidence.categoryLeaf) return "CATEGORY_REQUIRED";

  const evaluation = evaluateReviewAdvance(stage, evidence);
  return evaluation.ok ? "CATEGORY_REQUIRED" : evaluation.code;
}
