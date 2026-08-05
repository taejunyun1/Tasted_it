import { and, asc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  currentVotes,
  invalidatedVoteEvents,
  reviewerReliabilitySnapshots,
  reviewerSimilarityEdges,
  users,
} from "../../db/schema";
import { enqueueRatingRecompute, markRatingStale } from "./recompute.server";
import { getActiveRatingConfig } from "./rating-config.server";
import { calculateReviewerReliability } from "./rating-v2";
import { buildReviewerClusters } from "./reviewer-similarity";

type VoteValue = -1 | 1;

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function refreshReviewerTrust(db: AppDb, input: { now: string }) {
  const config = await getActiveRatingConfig(db, input.now);
  const rows = await db
    .select({
      placeId: currentVotes.placeId,
      userId: currentVotes.userId,
      eventId: currentVotes.eventId,
      value: currentVotes.value,
      role: users.role,
      invalidatedEventId: invalidatedVoteEvents.voteEventId,
    })
    .from(currentVotes)
    .innerJoin(users, eq(users.id, currentVotes.userId))
    .leftJoin(invalidatedVoteEvents, eq(invalidatedVoteEvents.voteEventId, currentVotes.eventId))
    .orderBy(asc(currentVotes.placeId), asc(currentVotes.userId))
    .limit(50_000);
  const active = rows.filter((row) => !row.invalidatedEventId && (row.value === 1 || row.value === -1));

  const userVotesByPlace = new Map<string, VoteValue[]>();
  const reviewerVotes = active
    .filter((row) => row.role === "REVIEWER")
    .map((row) => ({ reviewerId: row.userId, placeId: row.placeId, value: row.value as VoteValue }));
  for (const row of active.filter((candidate) => candidate.role === "USER")) {
    userVotesByPlace.set(row.placeId, [...(userVotesByPlace.get(row.placeId) ?? []), row.value as VoteValue]);
  }
  const consensus = new Map<string, VoteValue>();
  for (const [placeId, votes] of userVotesByPlace) {
    if (votes.length < config.minimumVisibleSamples) continue;
    const total = votes.reduce<number>((sum, vote) => sum + vote, 0);
    if (total !== 0) consensus.set(placeId, total > 0 ? 1 : -1);
  }

  const reviewerIds = [...new Set(reviewerVotes.map((vote) => vote.reviewerId))].sort();
  const previous = reviewerIds.length
    ? await db.select().from(reviewerReliabilitySnapshots).where(and(
      eq(reviewerReliabilitySnapshots.configId, config.id),
      inArray(reviewerReliabilitySnapshots.reviewerUserId, reviewerIds),
    ))
    : [];
  let reliabilityChanged = false;
  for (const reviewerId of reviewerIds) {
    const comparable = reviewerVotes.filter((vote) => vote.reviewerId === reviewerId && consensus.has(vote.placeId));
    const correct = comparable.filter((vote) => vote.value === consensus.get(vote.placeId)).length;
    const inputHash = await sha256(JSON.stringify({
      algorithmVersion: config.algorithmVersion,
      votes: comparable.map((vote) => ({ placeId: vote.placeId, value: vote.value, consensus: consensus.get(vote.placeId) })),
    }));
    if (previous.some((row) => row.reviewerUserId === reviewerId && row.inputHash === inputHash)) continue;
    const reliability = calculateReviewerReliability({ eligible: comparable.length, correct });
    await db.insert(reviewerReliabilitySnapshots).values({
      id: crypto.randomUUID(), reviewerUserId: reviewerId, configId: config.id, inputHash,
      eligibleCount: reliability.eligible, correctCount: reliability.correct,
      posteriorAccuracy: reliability.posteriorAccuracy, reliabilityWeight: reliability.weight,
      calibrationStatus: reliability.status, computedAt: input.now,
    });
    reliabilityChanged = true;
  }

  const clusters = buildReviewerClusters(reviewerVotes);
  const nextEdges = clusters.flatMap((cluster) => cluster.edges.map((edge) => ({
    leftReviewerUserId: edge.leftReviewerId,
    rightReviewerUserId: edge.rightReviewerId,
    overlapCount: edge.overlap,
    agreementRate: edge.agreement,
    clusterId: cluster.clusterId,
    damping: cluster.damping,
  })));
  const previousEdges = await db.select().from(reviewerSimilarityEdges)
    .where(eq(reviewerSimilarityEdges.configId, config.id))
    .orderBy(asc(reviewerSimilarityEdges.leftReviewerUserId), asc(reviewerSimilarityEdges.rightReviewerUserId));
  const edgeShape = (edge: typeof nextEdges[number]) => ({
    leftReviewerUserId: edge.leftReviewerUserId, rightReviewerUserId: edge.rightReviewerUserId,
    overlapCount: edge.overlapCount, agreementRate: edge.agreementRate,
    clusterId: edge.clusterId, damping: edge.damping,
  });
  const edgesChanged = JSON.stringify(previousEdges.map(edgeShape)) !== JSON.stringify(nextEdges.map(edgeShape));
  if (edgesChanged) {
    await db.delete(reviewerSimilarityEdges).where(eq(reviewerSimilarityEdges.configId, config.id));
    if (nextEdges.length) await db.insert(reviewerSimilarityEdges).values(nextEdges.map((edge) => ({
      id: crypto.randomUUID(), configId: config.id, ...edge, computedAt: input.now,
    })));
  }

  const changedPlaces = reliabilityChanged || edgesChanged
    ? [...new Set(reviewerVotes.map((vote) => vote.placeId))].sort()
    : [];
  for (const placeId of changedPlaces) {
    await markRatingStale(db, placeId, input.now);
    await enqueueRatingRecompute(db, { placeId, reason: "REVIEWER_TRUST_REFRESH", now: input.now });
  }
  return {
    reviewers: reviewerIds.length,
    similarityClusters: clusters.length,
    similarityEdges: nextEdges.length,
    changedPlaces: changedPlaces.length,
  };
}
