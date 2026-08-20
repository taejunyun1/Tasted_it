import { describe, expect, it } from "vitest";
import { checkReviewRequest, checkReviewResponse, reviewIntentsByStage } from "../../app/features/places/place-review-io";

const ids = (count: number) => Array.from({ length: count }, (_, index) => `item-${index + 1}`);

describe("place review request contract", () => {
  it("allows the current UI intents on each stage", () => {
    expect(reviewIntentsByStage.SOURCE_REVIEW).toEqual(expect.arrayContaining([
      "auto-exclude-non-food-review-items",
      "verify-review-items-with-naver",
      "auto-verify-review-item-with-naver",
      "advance-review-items",
      "hold-review-items",
      "exclude-review-items",
    ]));
    expect(reviewIntentsByStage.NAVER_VERIFICATION).toEqual([
      "verify-review-items-with-naver",
      "auto-verify-review-item-with-naver",
      "advance-review-items",
      "approve-manual-review-evidence",
      "update-review-item-addresses",
      "hold-review-items",
      "exclude-review-items",
    ]);
    expect(reviewIntentsByStage.CATEGORY_CONFIRMATION).toEqual([
      "confirm-review-categories",
      "hold-review-items",
      "exclude-review-items",
    ]);
    expect(reviewIntentsByStage.DUPLICATE_REVIEW).toEqual([
      "resolve-review-duplicates",
      "advance-review-items",
      "hold-review-items",
      "exclude-review-items",
    ]);
    expect(reviewIntentsByStage.FINAL_APPROVAL).toEqual([
      "publish-review-items",
      "hold-review-items",
      "exclude-review-items",
    ]);
  });

  it("rejects unknown or stage-mismatched intents", () => {
    expect(checkReviewRequest({
      intent: "approve-candidate",
      expectedStage: "SOURCE_REVIEW",
      workItemIds: ["item-1"],
    })).toEqual({ ok: false, code: "INVALID_INTENT" });
    expect(checkReviewRequest({
      intent: "publish-review-items",
      expectedStage: "SOURCE_REVIEW",
      workItemIds: ["item-1"],
      confirmPublish: "on",
    })).toEqual({ ok: false, code: "INVALID_INTENT" });
    expect(checkReviewRequest({
      intent: "advance-review-items",
      expectedStage: "NOT_A_STAGE",
      workItemIds: ["item-1"],
    })).toEqual({ ok: false, code: "INVALID_INTENT" });
  });

  it("enforces batch size 1-50 and auto-verify exactly one", () => {
    expect(checkReviewRequest({
      intent: "advance-review-items",
      expectedStage: "SOURCE_REVIEW",
      workItemIds: [],
    })).toEqual({ ok: false, code: "REVIEW_SELECTION_REQUIRED" });
    expect(checkReviewRequest({
      intent: "advance-review-items",
      expectedStage: "SOURCE_REVIEW",
      workItemIds: ids(51),
    })).toEqual({ ok: false, code: "PLACE_REVIEW_BATCH_LIMIT_EXCEEDED" });
    expect(checkReviewRequest({
      intent: "auto-verify-review-item-with-naver",
      expectedStage: "NAVER_VERIFICATION",
      workItemIds: ["item-1", "item-2"],
    })).toEqual({ ok: false, code: "AUTO_VERIFY_SINGLE_REQUIRED" });
    expect(checkReviewRequest({
      intent: "auto-verify-review-item-with-naver",
      expectedStage: "SOURCE_REVIEW",
      workItemIds: ["item-1"],
    })).toMatchObject({ ok: true, workItemIds: ["item-1"] });
    expect(checkReviewRequest({
      intent: "advance-review-items",
      expectedStage: "SOURCE_REVIEW",
      workItemIds: ids(50),
    }).ok).toBe(true);
    expect(checkReviewRequest({
      intent: "advance-review-items",
      expectedStage: "NAVER_VERIFICATION",
      workItemIds: ["item-1"],
    }).ok).toBe(true);
  });

  it("requires hold/exclude reason, publish confirmation, and category selections", () => {
    expect(checkReviewRequest({
      intent: "hold-review-items",
      expectedStage: "FINAL_APPROVAL",
      workItemIds: ["item-1"],
      reason: "   ",
    })).toEqual({ ok: false, code: "REVIEW_REASON_REQUIRED" });
    expect(checkReviewRequest({
      intent: "exclude-review-items",
      expectedStage: "SOURCE_REVIEW",
      workItemIds: ["item-1"],
      reason: "비음식점",
    }).ok).toBe(true);
    expect(checkReviewRequest({
      intent: "publish-review-items",
      expectedStage: "FINAL_APPROVAL",
      workItemIds: ["item-1"],
    })).toEqual({ ok: false, code: "PUBLISH_CONFIRM_REQUIRED" });
    expect(checkReviewRequest({
      intent: "publish-review-items",
      expectedStage: "FINAL_APPROVAL",
      workItemIds: ["item-1"],
      confirmPublish: "on",
    }).ok).toBe(true);
    expect(checkReviewRequest({
      intent: "confirm-review-categories",
      expectedStage: "CATEGORY_CONFIRMATION",
      workItemIds: ["item-1"],
      categoryByWorkItem: { "item-1": "" },
    })).toEqual({ ok: false, code: "CATEGORY_REQUIRED" });
    expect(checkReviewRequest({
      intent: "confirm-review-categories",
      expectedStage: "CATEGORY_CONFIRMATION",
      workItemIds: ["item-1"],
      categoryByWorkItem: { "item-1": "cat-local" },
    }).ok).toBe(true);
    expect(checkReviewRequest({
      intent: "approve-manual-review-evidence",
      expectedStage: "NAVER_VERIFICATION",
      workItemIds: ["item-1"],
      reason: "짧음",
    })).toEqual({ ok: false, code: "MANUAL_EVIDENCE_REASON_REQUIRED" });
    expect(checkReviewRequest({
      intent: "approve-manual-review-evidence",
      expectedStage: "NAVER_VERIFICATION",
      workItemIds: ["item-1"],
      reason: "공공데이터 원천과 현장 상호가 같아 수동으로 넘긴다",
    }).ok).toBe(true);
    expect(checkReviewRequest({
      intent: "update-review-item-addresses",
      expectedStage: "NAVER_VERIFICATION",
      workItemIds: ["item-1"],
      addressByWorkItem: { "item-1": "" },
    })).toEqual({ ok: false, code: "REVIEW_ADDRESS_REQUIRED" });
    expect(checkReviewRequest({
      intent: "update-review-item-addresses",
      expectedStage: "NAVER_VERIFICATION",
      workItemIds: ["item-1"],
      addressByWorkItem: { "item-1": "광주광역시 북구 검수로 12" },
    }).ok).toBe(true);
  });

  it("uses automatic work items only for non-food auto-exclude", () => {
    expect(checkReviewRequest({
      intent: "auto-exclude-non-food-review-items",
      expectedStage: "SOURCE_REVIEW",
      workItemIds: [],
      automaticWorkItemIds: ids(2),
    })).toMatchObject({ ok: true, workItemIds: ["item-1", "item-2"] });
    expect(checkReviewRequest({
      intent: "auto-exclude-non-food-review-items",
      expectedStage: "NAVER_VERIFICATION",
      workItemIds: [],
      automaticWorkItemIds: ["item-1"],
    })).toEqual({ ok: false, code: "INVALID_INTENT" });
  });
});

describe("place review response contract", () => {
  it("accepts success and failure action payloads", () => {
    expect(checkReviewResponse({ ok: true, message: "선택 공개 1곳 완료 · 건너뜀 0곳" })).toEqual({
      ok: true,
      message: "선택 공개 1곳 완료 · 건너뜀 0곳",
    });
    expect(checkReviewResponse({ ok: false, error: "보류 또는 제외 사유를 입력해 주세요.", code: "REVIEW_REASON_REQUIRED" }))
      .toEqual({ ok: false, error: "보류 또는 제외 사유를 입력해 주세요.", code: "REVIEW_REASON_REQUIRED" });
    expect(checkReviewResponse({ ok: true })).toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
  });
});
