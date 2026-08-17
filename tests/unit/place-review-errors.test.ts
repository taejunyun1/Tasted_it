import { describe, expect, it } from "vitest";
import { reviewErrorCatalog, reviewErrorMessage } from "../../app/features/places/place-review-errors";

const requiredCodes = [
  "SOURCE_NOT_READY",
  "NAVER_REVIEW_REQUIRED",
  "NAVER_RETRY_REQUIRED",
  "NAVER_LOCAL_SEARCH_QUOTA",
  "CATEGORY_REQUIRED",
  "CATEGORY_INACTIVE",
  "DUPLICATE_REVIEW_REQUIRED",
  "ACTIVE_EXCLUSION",
  "ALREADY_FINAL",
  "STALE_WORK_ITEM",
  "NOT_ACTIVE",
  "PLACE_REVIEW_BATCH_LIMIT_EXCEEDED",
  "INVALID_INTENT",
  "REVIEW_SUBJECT_MISSING",
  "PLACE_NOT_FOUND",
  "PUBLISH_FAILED",
  "REVIEW_REASON_REQUIRED",
] as const;

describe("place review error catalog", () => {
  it("maps required codes to Korean copy and a known disposition", () => {
    for (const code of requiredCodes) {
      const mapped = reviewErrorMessage(code);
      expect(mapped.code).toBe(code);
      expect(mapped.message.length).toBeGreaterThan(0);
      expect(mapped.message).not.toBe(code);
      expect(["RETRY", "HOLD", "EXCLUDE", "STAY", "AUTH"]).toContain(mapped.disposition);
    }
  });

  it("keeps NAVER quota and hold/exclude copy stable for the current UI", () => {
    expect(reviewErrorMessage("NAVER_LOCAL_SEARCH_QUOTA")).toMatchObject({
      message: "NAVER 일일 확인 한도에 도달했습니다.",
      disposition: "HOLD",
    });
    expect(reviewErrorMessage("REVIEW_REASON_REQUIRED")).toMatchObject({
      message: "보류 또는 제외 사유를 입력해 주세요.",
      disposition: "STAY",
    });
    expect(reviewErrorCatalog.PUBLISH_CONFIRM_REQUIRED.message).toContain("공개");
  });

  it("does not throw on unknown domain codes", () => {
    expect(reviewErrorMessage("SOME_NEW_SERVER_CODE")).toEqual({
      code: "UNKNOWN",
      message: "검수 요청을 완료하지 못했습니다.",
      disposition: "STAY",
    });
  });
});
