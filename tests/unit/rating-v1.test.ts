import { describe, expect, it } from "vitest";

import { calculateRating } from "../../app/features/ratings/rating-v1";

describe("rating v1", () => {
  it("starts at 50 percent with no votes", () => {
    expect(calculateRating({ positive: 0, negative: 0 })).toEqual({
      algorithmVersion: "rating-v1",
      positive: 0,
      negative: 0,
      displayScore: 50,
      sampleStatus: "INSUFFICIENT",
    });
  });

  it("uses Beta(2,2) and exposes scores after eight votes", () => {
    expect(calculateRating({ positive: 6, negative: 2 }).displayScore).toBe(67);
    expect(calculateRating({ positive: 6, negative: 2 }).sampleStatus).toBe(
      "VISIBLE",
    );
  });
});
