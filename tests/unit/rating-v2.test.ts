import { describe, expect, it } from "vitest";

import {
  calculateRatingV2,
  calculateReviewerReliability,
} from "../../app/features/ratings/rating-v2";

describe("rating-v2", () => {
  it("keeps a seven-vote result private and reveals the eighth", () => {
    const seven = calculateRatingV2({
      userVotes: [1, 1, 1, 1, 1, -1, -1],
      reviewerVotes: [],
    });
    const eight = calculateRatingV2({
      userVotes: [1, 1, 1, 1, 1, 1, -1, -1],
      reviewerVotes: [],
    });

    expect(seven.overall).toMatchObject({ sampleCount: 7, sampleStatus: "INSUFFICIENT", displayScore: null });
    expect(eight.overall).toMatchObject({ sampleCount: 8, sampleStatus: "VISIBLE", displayScore: 67 });
  });

  it("reveals each subgroup only after that subgroup has eight votes", () => {
    const result = calculateRatingV2({
      userVotes: Array.from({ length: 8 }, () => 1 as const),
      reviewerVotes: Array.from({ length: 7 }, (_, index) => ({
        reviewerId: `r-${index}`,
        value: -1 as const,
        reliabilityWeight: 1,
        similarityDamping: 1,
      })),
    });

    expect(result.users.sampleStatus).toBe("VISIBLE");
    expect(result.reviewers).toMatchObject({ sampleCount: 7, sampleStatus: "INSUFFICIENT", displayScore: null });
    expect(result.overall.sampleStatus).toBe("VISIBLE");
  });

  it("caps reviewer effective mass at thirty percent when user votes exist", () => {
    const result = calculateRatingV2({
      userVotes: Array.from({ length: 8 }, () => -1 as const),
      reviewerVotes: Array.from({ length: 20 }, (_, index) => ({
        reviewerId: `r-${index}`,
        value: 1 as const,
        reliabilityWeight: 1.4,
        similarityDamping: 1,
      })),
    });

    expect(result.reviewers.rawEffectiveWeight).toBeCloseTo(28, 8);
    expect(result.reviewers.combinedEffectiveWeight).toBeCloseTo(24 / 7, 6);
    expect(result.reviewerWeightShare).toBeCloseTo(0.3, 6);
    expect(result.overall.displayScore).toBe(35);
  });

  it("uses neutral trust while calibrating and bounded posterior trust afterward", () => {
    expect(calculateReviewerReliability({ eligible: 4, correct: 4 })).toEqual({
      status: "CALIBRATING",
      eligible: 4,
      correct: 4,
      posteriorAccuracy: 0.75,
      weight: 1,
    });
    const mature = calculateReviewerReliability({ eligible: 6, correct: 6 });
    expect(mature).toMatchObject({ status: "ACTIVE", posteriorAccuracy: 0.8 });
    expect(mature.weight).toBeCloseTo(1.24, 8);
    expect(calculateReviewerReliability({ eligible: 100, correct: 0 }).weight).toBeGreaterThanOrEqual(0.6);
    expect(calculateReviewerReliability({ eligible: 100, correct: 100 }).weight).toBeLessThanOrEqual(1.4);
  });

  it("rejects invalid vote and weight inputs", () => {
    expect(() => calculateRatingV2({ userVotes: [0 as 1], reviewerVotes: [] })).toThrow("INVALID_VOTE");
    expect(() => calculateRatingV2({
      userVotes: [],
      reviewerVotes: [{ reviewerId: "r", value: 1, reliabilityWeight: Number.NaN, similarityDamping: 1 }],
    })).toThrow("INVALID_WEIGHT");
  });
});
