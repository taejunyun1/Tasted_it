export interface RatingV1 {
  algorithmVersion: "rating-v1";
  positive: number;
  negative: number;
  displayScore: number;
  sampleStatus: "INSUFFICIENT" | "VISIBLE";
}

export function calculateRating(input: {
  positive: number;
  negative: number;
}): RatingV1 {
  const alpha = 2 + input.positive;
  const beta = 2 + input.negative;

  return {
    algorithmVersion: "rating-v1",
    positive: input.positive,
    negative: input.negative,
    displayScore: Math.round((alpha / (alpha + beta)) * 100),
    sampleStatus:
      input.positive + input.negative >= 8 ? "VISIBLE" : "INSUFFICIENT",
  };
}
