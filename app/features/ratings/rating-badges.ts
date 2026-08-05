export function evaluateHiddenGem(input: {
  totalVotes: number;
  overallScore: number | null;
  reviewerVotes: number;
  reviewerScore: number | null;
  detailViews90d: number | null;
  categoryRegionMedianViews90d: number | null;
  hasOpenIntegrityCase: boolean;
}) {
  const reasons: string[] = [];
  if (input.totalVotes < 8) reasons.push("INSUFFICIENT_TOTAL_VOTES");
  if (input.overallScore === null || input.overallScore < 75) reasons.push("OVERALL_SCORE_BELOW_75");
  if (input.reviewerVotes < 3) reasons.push("INSUFFICIENT_REVIEWER_VOTES");
  if (input.reviewerScore === null || input.reviewerScore < 80) reasons.push("REVIEWER_SCORE_BELOW_80");
  if (input.detailViews90d === null || input.categoryRegionMedianViews90d === null) {
    reasons.push("EXPOSURE_DATA_MISSING");
  } else if (input.detailViews90d > input.categoryRegionMedianViews90d) {
    reasons.push("EXPOSURE_ABOVE_MEDIAN");
  }
  if (input.hasOpenIntegrityCase) reasons.push("OPEN_INTEGRITY_CASE");
  return { eligible: reasons.length === 0, reasons };
}

export function evaluateHotTake(input: {
  reviewerValue: -1 | 1;
  peerPositive: number;
  peerNegative: number;
}) {
  const peerCount = input.peerPositive + input.peerNegative;
  const peerMajorityValue: -1 | 1 | null = input.peerPositive === input.peerNegative
    ? null
    : input.peerPositive > input.peerNegative ? 1 : -1;
  const peerAgreement = peerCount > 0 ? Math.max(input.peerPositive, input.peerNegative) / peerCount : 0;
  return {
    eligible: peerCount >= 5 && peerMajorityValue !== null && peerAgreement >= 0.7 && peerMajorityValue !== input.reviewerValue,
    peerCount,
    peerMajorityValue,
    peerAgreement,
  };
}
