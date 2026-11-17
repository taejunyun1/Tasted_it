import { z } from "zod";

import { calculateRatingV2, simulateRatingV2Policy } from "./rating-v2";

function numericInput(schema: z.ZodNumber) {
  return z.preprocess((value) => typeof value === "string" && value.trim() !== "" ? Number(value) : value, schema);
}

const count = numericInput(z.number().finite().int().min(0).max(200));

// These are bounded simulation inputs, not approved operating policy ranges.
export const ratingConfigPreviewSchema = z.object({
  minimumVisibleSamples: numericInput(z.number().finite().int().min(1).max(100)),
  alphaPrior: numericInput(z.number().finite().min(0.01).max(100)),
  betaPrior: numericInput(z.number().finite().min(0.01).max(100)),
  reviewerMaxShare: numericInput(z.number().finite().min(0).max(0.95)),
  userPositive: count,
  userNegative: count,
  reviewerPositive: count,
  reviewerNegative: count,
}).strict().superRefine((input, context) => {
  if (input.userPositive + input.userNegative + input.reviewerPositive + input.reviewerNegative > 400) {
    context.addIssue({ code: "custom", message: "합성 표본은 총 400표 이하여야 합니다." });
  }
});

export type RatingConfigPreviewInput = z.infer<typeof ratingConfigPreviewSchema>;

/** No database or provider access. Every synthetic reviewer has trust and damping 1. */
export function previewRatingConfig(value: unknown) {
  const input = ratingConfigPreviewSchema.parse(value);
  const userVotes = [
    ...Array.from({ length: input.userPositive }, () => 1 as const),
    ...Array.from({ length: input.userNegative }, () => -1 as const),
  ];
  const reviewerVotes = [
    ...Array.from({ length: input.reviewerPositive }, () => 1 as const),
    ...Array.from({ length: input.reviewerNegative }, () => -1 as const),
  ].map((vote, index) => ({ reviewerId: `synthetic-reviewer-${index}`, value: vote, reliabilityWeight: 1, similarityDamping: 1 }));
  const votes = { userVotes, reviewerVotes };
  const baseline = calculateRatingV2(votes);
  const candidate = simulateRatingV2Policy(votes, input);
  const baselineScore = baseline.overall.displayScore;
  const candidateScore = candidate.overall.displayScore;
  return {
    input,
    baseline,
    candidate,
    candidateScope: "SIMULATION" as const,
    scoreDelta: baselineScore !== null && candidateScore !== null ? candidateScore - baselineScore : null,
    visibilityChanged: baseline.overall.sampleStatus !== candidate.overall.sampleStatus,
  };
}
