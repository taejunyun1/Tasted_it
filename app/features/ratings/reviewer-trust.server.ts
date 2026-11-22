import { and, asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  currentVotes,
  invalidatedVoteEvents,
  reviewerSimilarityEdges,
  voteEvents,
} from "../../db/schema";
import { enqueueRatingRecompute, getCurrentReviewerReliability, markRatingStale } from "./recompute.server";
import { getActiveRatingConfig } from "./rating-config.server";
import { calculateReviewerReliability } from "./rating-v2";
import { buildReviewerClusters } from "./reviewer-similarity";
import {
  eligibleVoteCondition,
  getPublicationEpoch,
} from "./reviewer-publication.server";

type VoteValue = -1 | 1;

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function refreshReviewerTrust(db: AppDb, input: { now: string }) {
  const [config, moderationEpoch] = await Promise.all([
    getActiveRatingConfig(db, input.now),
    getPublicationEpoch(db),
  ]);
  const rows = await db
    .select({
      placeId: currentVotes.placeId,
      userId: currentVotes.userId,
      eventId: currentVotes.eventId,
      value: currentVotes.value,
      source: voteEvents.source,
      invalidatedEventId: invalidatedVoteEvents.voteEventId,
    })
    .from(currentVotes)
    .innerJoin(voteEvents, eq(voteEvents.id, currentVotes.eventId))
    .leftJoin(
      invalidatedVoteEvents,
      eq(invalidatedVoteEvents.voteEventId, currentVotes.eventId),
    )
    .where(eligibleVoteCondition())
    .orderBy(asc(currentVotes.placeId), asc(currentVotes.userId))
    .limit(50_000);
  const active = rows.filter(
    (row) => !row.invalidatedEventId && (row.value === 1 || row.value === -1),
  );

  const userVotesByPlace = new Map<string, VoteValue[]>();
  const reviewerVotes = active
    .filter((row) => row.source === "REVIEWER")
    .map((row) => ({
      reviewerId: row.userId,
      placeId: row.placeId,
      value: row.value as VoteValue,
    }));
  for (const row of active.filter(
    (candidate) => candidate.source === "GENERAL",
  )) {
    userVotesByPlace.set(row.placeId, [
      ...(userVotesByPlace.get(row.placeId) ?? []),
      row.value as VoteValue,
    ]);
  }
  const consensus = new Map<string, VoteValue>();
  for (const [placeId, votes] of userVotesByPlace) {
    if (votes.length < config.minimumVisibleSamples) continue;
    const total = votes.reduce<number>((sum, vote) => sum + vote, 0);
    if (total !== 0) consensus.set(placeId, total > 0 ? 1 : -1);
  }

  const reviewerIds = [
    ...new Set(reviewerVotes.map((vote) => vote.reviewerId)),
  ].sort();
  const previous = await getCurrentReviewerReliability(db, { reviewerIds, configId: config.id, moderationEpoch });
  const changedReviewers = new Set<string>();
  for (const reviewerId of reviewerIds) {
    const comparable = reviewerVotes.filter(
      (vote) => vote.reviewerId === reviewerId && consensus.has(vote.placeId),
    );
    const correct = comparable.filter(
      (vote) => vote.value === consensus.get(vote.placeId),
    ).length;
    const inputHash = await sha256(
      JSON.stringify({
        algorithmVersion: config.algorithmVersion,
        moderationEpoch,
        votes: comparable.map((vote) => ({
          placeId: vote.placeId,
          value: vote.value,
          consensus: consensus.get(vote.placeId),
        })),
      }),
    );
    const current = previous.get(reviewerId);
    if (current?.inputHash === inputHash || (current && current.computedAt > input.now)) continue;
    const reliability = calculateReviewerReliability({
      eligible: comparable.length,
      correct,
    });
    const [activation] = await db.$client.batch([
      // Keep one row per exact input. Advancing its internal row order resolves
      // equal computed_at values without changing other rows or inventing time.
      db.$client.prepare(`INSERT INTO reviewer_reliability_snapshots
        (id, reviewer_user_id, config_id, input_hash, moderation_epoch, eligible_count,
         correct_count, posterior_accuracy, reliability_weight, calibration_status, computed_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT epoch FROM reviewer_publication_state WHERE id = 'global') = ?
          AND (SELECT rowid FROM reviewer_reliability_snapshots
            WHERE reviewer_user_id = ? AND config_id = ? AND moderation_epoch = ?
            ORDER BY computed_at DESC, rowid DESC LIMIT 1) IS ?
        ON CONFLICT(reviewer_user_id, config_id, input_hash) DO UPDATE SET
          computed_at = excluded.computed_at,
          rowid = (SELECT COALESCE(MAX(rowid), 0) + 1 FROM reviewer_reliability_snapshots)
        WHERE reviewer_reliability_snapshots.moderation_epoch = excluded.moderation_epoch`).bind(
        crypto.randomUUID(), reviewerId, config.id, inputHash, moderationEpoch, reliability.eligible,
        reliability.correct, reliability.posteriorAccuracy, reliability.weight, reliability.status, input.now,
        moderationEpoch, reviewerId, config.id, moderationEpoch, current?.rowOrder ?? null,
      ),
      // Readers can never observe the newly active trust alongside a still-fresh
      // score that used the prior weight. The existing maintenance can retry a job.
      db.$client.prepare(`UPDATE rating_snapshots SET is_stale = 1, updated_at = ?
        WHERE changes() = 1 AND is_stale = 0 AND config_id = ? AND moderation_epoch = ?
          AND place_id IN (SELECT cv.place_id FROM current_votes cv JOIN vote_events v ON v.id = cv.event_id
            WHERE cv.user_id = ? AND v.source = 'REVIEWER')`).bind(input.now, config.id, moderationEpoch, reviewerId),
    ]);
    if (activation?.meta.changes === 1) changedReviewers.add(reviewerId);
  }

  const clusters = buildReviewerClusters(reviewerVotes);
  const nextEdges = clusters.flatMap((cluster) =>
    cluster.edges.map((edge) => ({
      leftReviewerUserId: edge.leftReviewerId,
      rightReviewerUserId: edge.rightReviewerId,
      overlapCount: edge.overlap,
      agreementRate: edge.agreement,
      clusterId: cluster.clusterId,
      damping: cluster.damping,
    })),
  );
  const previousEdges = await db
    .select()
    .from(reviewerSimilarityEdges)
    .where(
      and(
        eq(reviewerSimilarityEdges.configId, config.id),
        eq(reviewerSimilarityEdges.moderationEpoch, moderationEpoch),
      ),
    )
    .orderBy(
      asc(reviewerSimilarityEdges.leftReviewerUserId),
      asc(reviewerSimilarityEdges.rightReviewerUserId),
    );
  const edgeShape = (edge: (typeof nextEdges)[number]) => ({
    leftReviewerUserId: edge.leftReviewerUserId,
    rightReviewerUserId: edge.rightReviewerUserId,
    overlapCount: edge.overlapCount,
    agreementRate: edge.agreementRate,
    clusterId: edge.clusterId,
    damping: edge.damping,
  });
  const edgesChanged =
    JSON.stringify(previousEdges.map(edgeShape)) !==
    JSON.stringify(nextEdges.map(edgeShape));
  if (edgesChanged) {
    await db
      .delete(reviewerSimilarityEdges)
      .where(eq(reviewerSimilarityEdges.configId, config.id));
    if (nextEdges.length)
      await db.insert(reviewerSimilarityEdges).values(
        nextEdges.map((edge) => ({
          id: crypto.randomUUID(),
          configId: config.id,
          ...edge,
          moderationEpoch,
          computedAt: input.now,
        })),
      );
  }

  const changedPlaces = [...new Set(reviewerVotes
    .filter(vote => edgesChanged || changedReviewers.has(vote.reviewerId))
    .map(vote => vote.placeId))].sort();
  for (const placeId of changedPlaces) {
    if (edgesChanged) await markRatingStale(db, placeId, input.now);
    await enqueueRatingRecompute(db, {
      placeId,
      reason: "REVIEWER_TRUST_REFRESH",
      now: input.now,
    });
  }
  return {
    reviewers: reviewerIds.length,
    similarityClusters: clusters.length,
    similarityEdges: nextEdges.length,
    changedPlaces: changedPlaces.length,
  };
}
