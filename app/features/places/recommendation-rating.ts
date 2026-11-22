import { calculateNeutralRatingV2Score } from "../ratings/rating-v2";
import type { PlaceSummary } from "./place.types";

type RecommendationRatingInput = Pick<PlaceSummary,
  "ratingScore" | "ratingIsStale" | "positive" | "negative" |
  "userPositive" | "userNegative" | "reviewerPositive" | "reviewerNegative"
>;

export function recommendationRatingScore(place: RecommendationRatingInput) {
  if (place.ratingIsStale !== true && place.ratingScore != null) return place.ratingScore;
  const reviewerPositive = place.reviewerPositive ?? 0;
  const reviewerNegative = place.reviewerNegative ?? 0;
  return calculateNeutralRatingV2Score({
    userPositive: place.userPositive ?? place.positive - reviewerPositive,
    userNegative: place.userNegative ?? place.negative - reviewerNegative,
    reviewerPositive,
    reviewerNegative,
  });
}
