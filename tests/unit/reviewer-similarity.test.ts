import { describe, expect, it } from "vitest";

import { buildReviewerClusters } from "../../app/features/ratings/reviewer-similarity";

describe("reviewer similarity", () => {
  it("clusters reviewers with ten overlaps and at least eighty percent agreement", () => {
    const votes = Array.from({ length: 10 }, (_, index) => [
      { reviewerId: "reviewer-b", placeId: `p-${index}`, value: index === 9 ? -1 as const : 1 as const },
      { reviewerId: "reviewer-a", placeId: `p-${index}`, value: 1 as const },
    ]).flat();

    expect(buildReviewerClusters(votes)).toEqual([
      {
        clusterId: "cluster:reviewer-a|reviewer-b",
        reviewerIds: ["reviewer-a", "reviewer-b"],
        damping: 1 / Math.sqrt(2),
        edges: [{ leftReviewerId: "reviewer-a", rightReviewerId: "reviewer-b", overlap: 10, agreement: 0.9 }],
      },
    ]);
  });

  it("does not cluster fewer than ten overlaps or less than eighty percent agreement", () => {
    const tooFew = Array.from({ length: 9 }, (_, index) => [
      { reviewerId: "a", placeId: `p-${index}`, value: 1 as const },
      { reviewerId: "b", placeId: `p-${index}`, value: 1 as const },
    ]).flat();
    const lowAgreement = Array.from({ length: 10 }, (_, index) => [
      { reviewerId: "a", placeId: `q-${index}`, value: 1 as const },
      { reviewerId: "c", placeId: `q-${index}`, value: index < 7 ? 1 as const : -1 as const },
    ]).flat();

    expect(buildReviewerClusters([...tooFew, ...lowAgreement])).toEqual([]);
  });

  it("builds deterministic transitive clusters regardless of input order", () => {
    const votes = ["a", "b", "c"].flatMap((reviewerId) =>
      Array.from({ length: 10 }, (_, index) => ({ reviewerId, placeId: `p-${index}`, value: 1 as const })),
    );

    expect(buildReviewerClusters([...votes].reverse())).toEqual(buildReviewerClusters(votes));
    expect(buildReviewerClusters(votes)[0]).toMatchObject({
      clusterId: "cluster:a|b|c",
      reviewerIds: ["a", "b", "c"],
      damping: 1 / Math.sqrt(3),
    });
  });
});
