import { describe, expect, it } from "vitest";

import { classifyReviewState } from "../../app/features/candidates/review-classification";

const validInput = {
  confidence: "HIGH" as const,
  categoryAvailable: true,
  address: "광주광역시 동구 동명동",
  neighborhood: "동명동",
  latitude: 35.1,
  longitude: 126.9,
  duplicate: false,
};

describe("candidate review state", () => {
  it("marks a complete high-confidence candidate as automatic", () => {
    expect(classifyReviewState(validInput)).toEqual({ state: "AUTO", blockers: [], reviewReasons: [] });
  });

  it("marks a conflicting candidate for manual category review", () => {
    expect(classifyReviewState({ ...validInput, confidence: "CONFLICT" })).toMatchObject({
      state: "MANUAL", blockers: [], reviewReasons: ["자동 분류 CONFLICT"],
    });
  });

  it("keeps a candidate with no automatic category available for manual selection", () => {
    expect(classifyReviewState({ ...validInput, categoryAvailable: false })).toMatchObject({
      state: "MANUAL", blockers: [], reviewReasons: ["활성 세부 카테고리 없음"],
    });
  });

  it("blocks a candidate missing address-derived neighborhood and coordinates", () => {
    expect(classifyReviewState({ ...validInput, address: "광주", neighborhood: null, latitude: null, longitude: null })).toMatchObject({
      state: "BLOCKED", blockers: ["동네 추출 실패", "좌표 확인 필요"],
    });
  });
});
