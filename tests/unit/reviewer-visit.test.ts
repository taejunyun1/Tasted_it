import { describe, expect, it } from "vitest";

import {
  REVIEWER_BADGE_CATALOG,
  parseReviewerVisitSubmission,
  reviewerEvaluationToVoteValue,
} from "../../app/features/ratings/reviewer-visit";

function submission(overrides: Record<string, string | string[]> = {}) {
  const form = new FormData();
  const values: Record<string, string | string[]> = {
    intent: "publish-review",
    placeId: "place-1",
    categoryId: "cat-ramen",
    categoryName: "라멘",
    evaluation: "RECOMMEND",
    badges: ["육수 농도 선명", "면 익힘 알맞음"],
    golden: "0",
    goldenReason: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  }
  return form;
}

describe("reviewer visit badge catalog", () => {
  it("defines the 42 production categories with exactly three unique badges", () => {
    expect(Object.keys(REVIEWER_BADGE_CATALOG)).toHaveLength(42);
    for (const badges of Object.values(REVIEWER_BADGE_CATALOG)) {
      expect(badges).toHaveLength(3);
      expect(new Set(badges).size).toBe(3);
    }
    expect(REVIEWER_BADGE_CATALOG["국밥·해장국"]).toEqual([
      "국물 맛이 깊음",
      "건더기가 넉넉",
      "잡내 없이 깔끔",
    ]);
    expect(REVIEWER_BADGE_CATALOG["라멘"]).toEqual([
      "육수 농도 선명",
      "면 익힘 알맞음",
      "토핑 상태 좋음",
    ]);
  });
});

describe("reviewer visit submission contract", () => {
  it("accepts a normal review without badges, photos, or prose", () => {
    const result = parseReviewerVisitSubmission(submission({ badges: [] }));
    expect(result).toMatchObject({
      placeId: "place-1",
      categoryId: "cat-ramen",
      categoryName: "라멘",
      evaluation: "RECOMMEND",
      badges: [],
      golden: false,
    });
    expect(result).not.toHaveProperty("body");
    expect(result).not.toHaveProperty("note");
  });

  it.each(["RECOMMEND", "HOLD", "NOT_RECOMMEND"])(
    "accepts the exact evaluation choice %s",
    (evaluation) => {
      expect(parseReviewerVisitSubmission(submission({ evaluation })).evaluation).toBe(evaluation);
    },
  );

  it("rejects a third badge and badges outside the selected category", () => {
    expect(() => parseReviewerVisitSubmission(submission({
      badges: ["육수 농도 선명", "면 익힘 알맞음", "토핑 상태 좋음"],
    }))).toThrow("REVIEW_BADGE_LIMIT");
    expect(() => parseReviewerVisitSubmission(submission({
      badges: ["국물 맛이 깊음"],
    }))).toThrow("REVIEW_BADGE_INVALID");
  });

  it("requires exactly two badges and a 15–100 character reason for Golden Pick", () => {
    expect(() => parseReviewerVisitSubmission(submission({
      golden: "1",
      badges: ["육수 농도 선명"],
      goldenReason: "이 집의 육수와 면 익힘을 꾸준히 추천할 수 있습니다.",
    }))).toThrow("GOLDEN_PICK_BADGES_REQUIRED");
    expect(() => parseReviewerVisitSubmission(submission({
      golden: "1",
      goldenReason: "짧은 이유",
    }))).toThrow("GOLDEN_PICK_REASON_LENGTH");
    expect(parseReviewerVisitSubmission(submission({
      golden: "1",
      goldenReason: "육수의 밀도와 면 익힘이 안정적이라 다시 추천하고 싶은 곳입니다.",
    })).golden).toBe(true);
  });

  it("rejects narrative fields instead of silently storing them", () => {
    const form = submission();
    form.set("body", "긴 서술형 후기는 제품 계약에 없습니다.");
    expect(() => parseReviewerVisitSubmission(form)).toThrow("REVIEW_FIELD_UNKNOWN");
  });
});

describe("reviewer evaluation signal mapping", () => {
  it("maps recommend and not-recommend to votes while HOLD removes the current vote", () => {
    expect(reviewerEvaluationToVoteValue("RECOMMEND")).toBe(1);
    expect(reviewerEvaluationToVoteValue("NOT_RECOMMEND")).toBe(-1);
    expect(reviewerEvaluationToVoteValue("HOLD")).toBeNull();
  });
});
