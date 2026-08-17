import { reviewStages, type ReviewStage } from "./place-review-pipeline";
import { reviewErrorMessage, type ReviewErrorCode } from "./place-review-errors";

export const REVIEW_BATCH_MIN = 1;
export const REVIEW_BATCH_MAX = 25;

export const reviewIntents = [
  "auto-exclude-non-food-review-items",
  "verify-review-items-with-naver",
  "auto-verify-review-item-with-naver",
  "advance-review-items",
  "confirm-review-categories",
  "resolve-review-duplicates",
  "publish-review-items",
  "hold-review-items",
  "exclude-review-items",
] as const;

export type ReviewIntent = (typeof reviewIntents)[number];

export const reviewIntentsByStage: Record<ReviewStage, readonly ReviewIntent[]> = {
  SOURCE_REVIEW: [
    "auto-exclude-non-food-review-items",
    "verify-review-items-with-naver",
    "auto-verify-review-item-with-naver",
    "advance-review-items",
    "hold-review-items",
    "exclude-review-items",
  ],
  NAVER_VERIFICATION: [
    "verify-review-items-with-naver",
    "auto-verify-review-item-with-naver",
    "hold-review-items",
    "exclude-review-items",
  ],
  CATEGORY_CONFIRMATION: ["confirm-review-categories", "hold-review-items", "exclude-review-items"],
  DUPLICATE_REVIEW: ["resolve-review-duplicates", "advance-review-items", "hold-review-items", "exclude-review-items"],
  FINAL_APPROVAL: ["publish-review-items", "hold-review-items", "exclude-review-items"],
};

export type ReviewRequestInput = {
  intent: string;
  expectedStage: string;
  workItemIds: string[];
  automaticWorkItemIds?: string[];
  reason?: string;
  confirmPublish?: string;
  categoryByWorkItem?: Record<string, string>;
};

export type ReviewRequestCheck =
  | { ok: true; intent: ReviewIntent; expectedStage: ReviewStage; workItemIds: string[] }
  | { ok: false; code: ReviewErrorCode };

function uniqueIds(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function isReviewIntent(value: string): value is ReviewIntent {
  return (reviewIntents as readonly string[]).includes(value);
}

function isReviewStage(value: string): value is ReviewStage {
  return (reviewStages as readonly string[]).includes(value);
}

export function checkReviewRequest(input: ReviewRequestInput): ReviewRequestCheck {
  if (!isReviewIntent(input.intent) || !isReviewStage(input.expectedStage)) {
    return { ok: false, code: "INVALID_INTENT" };
  }
  if (!reviewIntentsByStage[input.expectedStage].includes(input.intent)) {
    return { ok: false, code: "INVALID_INTENT" };
  }

  const workItemIds = input.intent === "auto-exclude-non-food-review-items"
    ? uniqueIds(input.automaticWorkItemIds)
    : uniqueIds(input.workItemIds);

  if (input.intent === "auto-verify-review-item-with-naver") {
    if (workItemIds.length !== 1) return { ok: false, code: "AUTO_VERIFY_SINGLE_REQUIRED" };
  } else if (workItemIds.length < REVIEW_BATCH_MIN) {
    return { ok: false, code: "REVIEW_SELECTION_REQUIRED" };
  } else if (workItemIds.length > REVIEW_BATCH_MAX) {
    return { ok: false, code: "PLACE_REVIEW_BATCH_LIMIT_EXCEEDED" };
  }

  if ((input.intent === "hold-review-items" || input.intent === "exclude-review-items") && !input.reason?.trim()) {
    return { ok: false, code: "REVIEW_REASON_REQUIRED" };
  }
  if (input.intent === "publish-review-items" && input.confirmPublish !== "on") {
    return { ok: false, code: "PUBLISH_CONFIRM_REQUIRED" };
  }
  if (input.intent === "confirm-review-categories") {
    const missingCategory = workItemIds.some((workItemId) => !input.categoryByWorkItem?.[workItemId]?.trim());
    if (missingCategory) return { ok: false, code: "CATEGORY_REQUIRED" };
  }

  return { ok: true, intent: input.intent, expectedStage: input.expectedStage, workItemIds };
}

export function checkReviewResponse(value: unknown):
  | { ok: true; message: string }
  | { ok: false; code: string; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, code: "INVALID_RESPONSE", error: reviewErrorMessage("INVALID_RESPONSE").message };
  }
  const record = value as Record<string, unknown>;
  if (record.ok === true && typeof record.message === "string" && record.message.length > 0) {
    return { ok: true, message: record.message };
  }
  if (record.ok === false && typeof record.error === "string" && record.error.length > 0) {
    const code = typeof record.code === "string" && record.code ? record.code : "UNKNOWN";
    return { ok: false, code, error: record.error };
  }
  return { ok: false, code: "INVALID_RESPONSE", error: reviewErrorMessage("INVALID_RESPONSE").message };
}
