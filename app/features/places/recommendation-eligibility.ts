export type RecommendationEligibilityReason =
  | "UNPUBLISHED"
  | "VENUE_POLICY"
  | "LIVENESS_EXCLUDED"
  | "QUALITY_FLOOR"
  | "CURRENT_DISLIKE";

export type RecommendationEligibility =
  | { decision: "ALLOW" }
  | { decision: "DROP"; reason: RecommendationEligibilityReason };

export function evaluateAppEligibility(input: {
  sampleCount: number;
  visibleScore: number;
  currentlyDisliked: boolean;
}): RecommendationEligibility {
  if (input.currentlyDisliked) return { decision: "DROP", reason: "CURRENT_DISLIKE" };
  if (input.sampleCount < 8) return { decision: "ALLOW" };
  return input.visibleScore >= 55
    ? { decision: "ALLOW" }
    : { decision: "DROP", reason: "QUALITY_FLOOR" };
}
