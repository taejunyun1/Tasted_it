type VoteValue = -1 | 1;

export interface ReviewerSimilarityVote {
  reviewerId: string;
  placeId: string;
  value: VoteValue;
}

export interface ReviewerSimilarityEdge {
  leftReviewerId: string;
  rightReviewerId: string;
  overlap: number;
  agreement: number;
}

export interface ReviewerCluster {
  clusterId: string;
  reviewerIds: string[];
  damping: number;
  edges: ReviewerSimilarityEdge[];
}

export function buildReviewerClusters(votes: ReviewerSimilarityVote[]): ReviewerCluster[] {
  const reviewerIds = [...new Set(votes.map((vote) => vote.reviewerId))].sort();
  const byReviewer = new Map<string, Map<string, VoteValue>>();
  for (const reviewerId of reviewerIds) byReviewer.set(reviewerId, new Map());
  for (const vote of votes) byReviewer.get(vote.reviewerId)?.set(vote.placeId, vote.value);

  const parent = new Map(reviewerIds.map((id) => [id, id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parent.set(rightRoot, leftRoot < rightRoot ? leftRoot : rightRoot);
    parent.set(leftRoot, leftRoot < rightRoot ? leftRoot : rightRoot);
  };

  const edges: ReviewerSimilarityEdge[] = [];
  for (let leftIndex = 0; leftIndex < reviewerIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < reviewerIds.length; rightIndex += 1) {
      const left = reviewerIds[leftIndex];
      const right = reviewerIds[rightIndex];
      const leftVotes = byReviewer.get(left)!;
      const rightVotes = byReviewer.get(right)!;
      const shared = [...leftVotes.keys()].filter((placeId) => rightVotes.has(placeId));
      if (shared.length < 10) continue;
      const agreement = shared.filter((placeId) => leftVotes.get(placeId) === rightVotes.get(placeId)).length / shared.length;
      if (agreement < 0.8) continue;
      edges.push({ leftReviewerId: left, rightReviewerId: right, overlap: shared.length, agreement });
      union(left, right);
    }
  }

  const groups = new Map<string, string[]>();
  for (const reviewerId of reviewerIds) {
    const root = find(reviewerId);
    groups.set(root, [...(groups.get(root) ?? []), reviewerId]);
  }
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => {
      const sortedIds = [...ids].sort();
      return {
        clusterId: `cluster:${sortedIds.join("|")}`,
        reviewerIds: sortedIds,
        damping: 1 / Math.sqrt(sortedIds.length),
        edges: edges.filter((edge) => sortedIds.includes(edge.leftReviewerId) && sortedIds.includes(edge.rightReviewerId)),
      };
    })
    .sort((left, right) => left.clusterId.localeCompare(right.clusterId));
}
