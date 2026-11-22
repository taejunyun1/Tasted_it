export const RATING_V2_VERSION = "rating-v2.0" as const;

export type RatingV2Policy = Readonly<{
  minimumVisibleSamples: number;
  alphaPrior: number;
  betaPrior: number;
  reviewerMaxShare: number;
}>;

export const RATING_V2_POLICY: RatingV2Policy = Object.freeze({
  minimumVisibleSamples: 8,
  alphaPrior: 2,
  betaPrior: 2,
  reviewerMaxShare: 0.3,
});

type VoteValue = -1 | 1;

export interface ReviewerWeightedVote {
  reviewerId: string;
  value: VoteValue;
  reliabilityWeight: number;
  similarityDamping: number;
}

export interface RatingGroupResult {
  positive: number;
  negative: number;
  positiveWeight: number;
  negativeWeight: number;
  sampleCount: number;
  sampleStatus: "INSUFFICIENT" | "VISIBLE";
  displayScore: number | null;
}

export interface RatingV2Result {
  algorithmVersion: typeof RATING_V2_VERSION;
  overall: RatingGroupResult;
  users: RatingGroupResult;
  reviewers: RatingGroupResult & {
    rawEffectiveWeight: number;
    combinedEffectiveWeight: number;
  };
  reviewerWeightShare: number;
  reasons: string[];
}

function assertVote(value: number): asserts value is VoteValue {
  if (value !== -1 && value !== 1) throw new Error("INVALID_VOTE");
}

function assertWeight(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_WEIGHT");
}

function scoreFromWeights(positiveWeight: number, negativeWeight: number, policy: RatingV2Policy) {
  const total = policy.alphaPrior + policy.betaPrior + positiveWeight + negativeWeight;
  return Math.round((policy.alphaPrior + positiveWeight) / total * 100);
}

function reviewerWeightScale(userWeight: number, rawReviewerWeight: number, policy: RatingV2Policy) {
  if (userWeight <= 0 || rawReviewerWeight <= 0) return 1;
  const cap = (policy.reviewerMaxShare / (1 - policy.reviewerMaxShare)) * userWeight;
  return Math.min(1, cap / rawReviewerWeight);
}

function addReviewerWeights(userCount: number, reviewerCount: number, scale: number) {
  if (scale === 1) return userCount + reviewerCount;
  // Match the snapshot's addition order so rounding cannot flip the quality floor.
  let weight = userCount;
  for (let added = 0; added < reviewerCount; added += 1) weight += scale;
  return weight;
}

/** Internal ranking score from current eligible counts, with neutral reviewer trust and damping. */
export function calculateNeutralRatingV2Score(counts: {
  userPositive: number;
  userNegative: number;
  reviewerPositive: number;
  reviewerNegative: number;
}) {
  const policy = RATING_V2_POLICY;
  const scale = reviewerWeightScale(
    counts.userPositive + counts.userNegative,
    counts.reviewerPositive + counts.reviewerNegative,
    policy,
  );
  return scoreFromWeights(
    addReviewerWeights(counts.userPositive, counts.reviewerPositive, scale),
    addReviewerWeights(counts.userNegative, counts.reviewerNegative, scale),
    policy,
  );
}

function scoreGroup(votes: Array<{ value: VoteValue; weight: number }>, policy: RatingV2Policy): RatingGroupResult {
  const positive = votes.filter((vote) => vote.value === 1).length;
  const negative = votes.length - positive;
  const positiveWeight = votes.reduce((sum, vote) => sum + (vote.value === 1 ? vote.weight : 0), 0);
  const negativeWeight = votes.reduce((sum, vote) => sum + (vote.value === -1 ? vote.weight : 0), 0);
  const visible = votes.length >= policy.minimumVisibleSamples;
  return {
    positive,
    negative,
    positiveWeight,
    negativeWeight,
    sampleCount: votes.length,
    sampleStatus: visible ? "VISIBLE" : "INSUFFICIENT",
    displayScore: visible ? scoreFromWeights(positiveWeight, negativeWeight, policy) : null,
  };
}

export function calculateReviewerReliability(input: { eligible: number; correct: number }) {
  if (!Number.isInteger(input.eligible) || !Number.isInteger(input.correct) || input.eligible < 0 || input.correct < 0 || input.correct > input.eligible) {
    throw new Error("INVALID_RELIABILITY_INPUT");
  }
  const posteriorAccuracy = (2 + input.correct) / (4 + input.eligible);
  const weight = input.eligible < 5
    ? 1
    : Math.min(1.4, Math.max(0.6, 0.6 + 0.8 * posteriorAccuracy));
  return {
    status: input.eligible < 5 ? "CALIBRATING" as const : "ACTIVE" as const,
    eligible: input.eligible,
    correct: input.correct,
    posteriorAccuracy,
    weight,
  };
}

type RatingV2Input = {
  userVotes: VoteValue[];
  reviewerVotes: ReviewerWeightedVote[];
};

export function calculateRatingV2(input: RatingV2Input): RatingV2Result {
  return calculateWithPolicy(input, RATING_V2_POLICY);
}

/** Pure simulation only. Production calculations always use calculateRatingV2. */
export function simulateRatingV2Policy(input: RatingV2Input, policy: RatingV2Policy): RatingV2Result {
  return calculateWithPolicy(input, policy);
}

function calculateWithPolicy(input: RatingV2Input, policy: RatingV2Policy): RatingV2Result {
  input.userVotes.forEach(assertVote);
  input.reviewerVotes.forEach((vote) => {
    assertVote(vote.value);
    assertWeight(vote.reliabilityWeight);
    assertWeight(vote.similarityDamping);
  });

  const userWeighted = input.userVotes.map((value) => ({ value, weight: 1 }));
  const reviewerRaw = input.reviewerVotes.map((vote) => ({
    value: vote.value,
    weight: vote.reliabilityWeight * vote.similarityDamping,
  }));
  const rawReviewerWeight = reviewerRaw.reduce((sum, vote) => sum + vote.weight, 0);
  const userWeight = userWeighted.length;
  const reviewerScale = reviewerWeightScale(userWeight, rawReviewerWeight, policy);
  const reviewerCombined = reviewerRaw.map((vote) => ({ ...vote, weight: vote.weight * reviewerScale }));
  const combinedReviewerWeight = reviewerCombined.reduce((sum, vote) => sum + vote.weight, 0);
  const combinedWeight = userWeight + combinedReviewerWeight;

  return {
    algorithmVersion: RATING_V2_VERSION,
    overall: scoreGroup([...userWeighted, ...reviewerCombined], policy),
    users: scoreGroup(userWeighted, policy),
    reviewers: {
      ...scoreGroup(reviewerRaw, policy),
      rawEffectiveWeight: rawReviewerWeight,
      combinedEffectiveWeight: combinedReviewerWeight,
    },
    reviewerWeightShare: combinedWeight > 0 ? combinedReviewerWeight / combinedWeight : 0,
    reasons: reviewerScale < 1
      ? [policy.reviewerMaxShare === RATING_V2_POLICY.reviewerMaxShare
        ? "REVIEWER_WEIGHT_CAPPED_30_PERCENT"
        : "REVIEWER_WEIGHT_CAPPED_SIMULATION"]
      : [],
  };
}
