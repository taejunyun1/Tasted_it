import { describe, expect, it } from "vitest";

import { evaluateAppEligibility } from "../../app/features/places/recommendation-eligibility";

describe("recommendation eligibility", () => {
  it("표본 8 미만은 점수가 낮아도 노출한다", () => {
    expect(evaluateAppEligibility({ sampleCount: 3, visibleScore: 40, currentlyDisliked: false }))
      .toEqual({ decision: "ALLOW" });
  });

  it("표본 8 이상이고 55점 미만이면 품질 하한으로 제외한다", () => {
    expect(evaluateAppEligibility({ sampleCount: 8, visibleScore: 54, currentlyDisliked: false }))
      .toEqual({ decision: "DROP", reason: "QUALITY_FLOOR" });
  });

  it("현재 비추천 장소는 점수와 무관하게 제외한다", () => {
    expect(evaluateAppEligibility({ sampleCount: 0, visibleScore: 90, currentlyDisliked: true }))
      .toEqual({ decision: "DROP", reason: "CURRENT_DISLIKE" });
  });

  it("성숙 후보의 비정상 공개 점수는 기존 품질 하한처럼 제외한다", () => {
    expect(evaluateAppEligibility({ sampleCount: 8, visibleScore: Number.NaN, currentlyDisliked: false }))
      .toEqual({ decision: "DROP", reason: "QUALITY_FLOOR" });
  });
});
