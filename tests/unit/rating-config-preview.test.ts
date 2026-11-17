import { describe, expect, it } from "vitest";

import { previewRatingConfig } from "../../app/features/ratings/rating-config-preview";
import { calculateRatingV2, RATING_V2_POLICY } from "../../app/features/ratings/rating-v2";

const defaults = {
  minimumVisibleSamples: 8,
  alphaPrior: 2,
  betaPrior: 2,
  reviewerMaxShare: 0.3,
  userPositive: 6,
  userNegative: 2,
  reviewerPositive: 8,
  reviewerNegative: 0,
};

describe("rating configuration synthetic preview", () => {
  it("keeps the operational policy frozen and default previews identical to the actual calculator", () => {
    expect(Object.isFrozen(RATING_V2_POLICY)).toBe(true);
    expect(RATING_V2_POLICY).toEqual({ minimumVisibleSamples: 8, alphaPrior: 2, betaPrior: 2, reviewerMaxShare: 0.3 });
    const result = previewRatingConfig(defaults);
    const expected = calculateRatingV2({
      userVotes: [1, 1, 1, 1, 1, 1, -1, -1],
      reviewerVotes: Array.from({ length: 8 }, (_, index) => ({ reviewerId: `synthetic-reviewer-${index}`, value: 1 as const, reliabilityWeight: 1, similarityDamping: 1 })),
    });
    expect(result.baseline).toEqual(expected);
    expect(result.candidate).toEqual(expected);
    expect(result).toMatchObject({ input: defaults, candidateScope: "SIMULATION", scoreDelta: 0, visibilityChanged: false });
  });

  it("compares seven versus eight votes without inventing a numeric delta for an unpublished score", () => {
    const result = previewRatingConfig({ ...defaults, userPositive: 7, userNegative: 0, reviewerPositive: 0, minimumVisibleSamples: 7 });
    expect(result.baseline.overall).toMatchObject({ sampleCount: 7, displayScore: null, sampleStatus: "INSUFFICIENT" });
    expect(result.candidate.overall).toMatchObject({ sampleCount: 7, displayScore: 82, sampleStatus: "VISIBLE" });
    expect(result).toMatchObject({ scoreDelta: null, visibilityChanged: true });
    const eighth = previewRatingConfig({ ...defaults, userPositive: 8, userNegative: 0, reviewerPositive: 0 });
    expect(eighth.baseline.overall.displayScore).toBe(83);
    expect(eighth.candidate.overall.displayScore).toBe(83);
  });

  it("changes only the candidate reviewer cap and computes an independently pinned score delta", () => {
    const result = previewRatingConfig({ ...defaults, userPositive: 0, userNegative: 8, reviewerPositive: 20, reviewerMaxShare: 0.5 });
    expect(result.baseline.reviewerWeightShare).toBeCloseTo(0.3, 10);
    expect(result.baseline.overall.displayScore).toBe(35);
    expect(result.candidate.reviewerWeightShare).toBeCloseTo(0.5, 10);
    expect(result.candidate.overall.displayScore).toBe(50);
    expect(result.scoreDelta).toBe(15);
    expect(result.visibilityChanged).toBe(false);
    expect(previewRatingConfig(defaults).candidate).toEqual(previewRatingConfig(defaults).baseline);
  });

  it("uses proposed priors and retains full reviewer mass when no general votes exist", () => {
    const result = previewRatingConfig({ ...defaults, userPositive: 0, userNegative: 0, reviewerPositive: 8, alphaPrior: 1, betaPrior: 3, reviewerMaxShare: 0 });
    expect(result.baseline.overall.displayScore).toBe(83);
    expect(result.candidate.overall.displayScore).toBe(75);
    expect(result.candidate.reviewerWeightShare).toBe(1);
    expect(result.candidate.reviewers.combinedEffectiveWeight).toBe(8);
  });

  it("accepts numeric form strings and the maximum bounded synthetic population", () => {
    const strings = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, String(value)]));
    expect(previewRatingConfig(strings).input).toEqual(defaults);
    const result = previewRatingConfig({ ...defaults, userPositive: 200, userNegative: 0, reviewerPositive: 200 });
    expect(result.baseline.overall.sampleCount).toBe(400);
  });

  it.each([
    { userPositive: -1 }, { userNegative: 0.5 }, { reviewerPositive: 201 }, { userPositive: Number.NaN },
    { reviewerNegative: Infinity }, { userPositive: true }, { userPositive: null }, { userPositive: "" },
    { userPositive: " " }, { userPositive: "NaN" }, { userPositive: [] },
    { minimumVisibleSamples: 0 }, { minimumVisibleSamples: 101 }, { minimumVisibleSamples: 7.5 },
    { alphaPrior: 0 }, { alphaPrior: 100.1 }, { betaPrior: Infinity }, { reviewerMaxShare: 0.96 },
    { reviewerMaxShare: -0.01 }, { userPositive: 200, userNegative: 200, reviewerPositive: 1 },
    { algorithmVersion: "rating-v3" }, { intent: "activate" },
  ])("rejects malformed or unbounded input %j", (override) => {
    expect(() => previewRatingConfig({ ...defaults, ...override })).toThrow();
  });

  it("requires every numeric field and does not mutate the submitted object", () => {
    const original = Object.freeze({ ...defaults });
    expect(previewRatingConfig(original).input).toEqual(defaults);
    const { userPositive: _removed, ...missing } = defaults;
    expect(() => previewRatingConfig(missing)).toThrow();
  });
});
