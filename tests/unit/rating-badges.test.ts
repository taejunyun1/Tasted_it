import { describe, expect, it } from "vitest";

import { evaluateHiddenGem, evaluateHotTake } from "../../app/features/ratings/rating-badges";

describe("rating badges", () => {
  it("requires score, samples, low exposure, and no open integrity case for Hidden Gem", () => {
    expect(evaluateHiddenGem({
      totalVotes: 12,
      overallScore: 82,
      reviewerVotes: 3,
      reviewerScore: 85,
      detailViews90d: 20,
      categoryRegionMedianViews90d: 25,
      hasOpenIntegrityCase: false,
    })).toEqual({ eligible: true, reasons: [] });

    expect(evaluateHiddenGem({
      totalVotes: 12,
      overallScore: 82,
      reviewerVotes: 3,
      reviewerScore: 85,
      detailViews90d: null,
      categoryRegionMedianViews90d: null,
      hasOpenIntegrityCase: false,
    })).toEqual({ eligible: false, reasons: ["EXPOSURE_DATA_MISSING"] });
  });

  it("marks a reviewer vote as Hot Take only against five peers with seventy percent agreement", () => {
    expect(evaluateHotTake({ reviewerValue: -1, peerPositive: 5, peerNegative: 1 })).toEqual({
      eligible: true,
      peerCount: 6,
      peerMajorityValue: 1,
      peerAgreement: 5 / 6,
    });
    expect(evaluateHotTake({ reviewerValue: -1, peerPositive: 4, peerNegative: 0 }).eligible).toBe(false);
    expect(evaluateHotTake({ reviewerValue: 1, peerPositive: 4, peerNegative: 2 }).eligible).toBe(false);
  });
});
