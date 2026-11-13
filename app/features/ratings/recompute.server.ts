import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import {
  currentVotes,
  invalidatedVoteEvents,
  ratingRecomputeJobs,
  ratingSnapshots,
  reviewerReliabilitySnapshots,
  reviewerSimilarityEdges,
  voteEvents,
  places as placeTable,
  reviewerPublicationState,
} from "../../db/schema";
import { calculateRatingV2 } from "./rating-v2";
import { getActiveRatingConfig } from "./rating-config.server";
import {
  eligibleVoteCondition,
  getPublicationEpoch,
  getPlaceVoteRevision,
} from "./reviewer-publication.server";

export async function markRatingStale(db: AppDb, placeId: string, now: string) {
  await db
    .update(ratingSnapshots)
    .set({ isStale: true, updatedAt: now })
    .where(eq(ratingSnapshots.placeId, placeId));
}

export async function enqueueRatingRecompute(
  db: AppDb,
  input: {
    placeId: string;
    reason: string;
    now: string;
    jobId?: string;
  },
) {
  const config = await getActiveRatingConfig(db, input.now);
  if (input.jobId) {
    const existing = await db.query.ratingRecomputeJobs.findFirst({
      where: eq(ratingRecomputeJobs.id, input.jobId),
    });
    if (existing) {
      if (existing.placeId !== input.placeId || existing.configId !== config.id)
        throw new Error("RATING_JOB_SCOPE_MISMATCH");
      return existing;
    }
  }
  const pending = await db.query.ratingRecomputeJobs.findFirst({
    where: and(
      eq(ratingRecomputeJobs.placeId, input.placeId),
      eq(ratingRecomputeJobs.configId, config.id),
      inArray(ratingRecomputeJobs.status, ["PENDING", "RUNNING"]),
    ),
  });
  if (pending) return pending;
  const job = {
    id: input.jobId ?? crypto.randomUUID(),
    placeId: input.placeId,
    configId: config.id,
    scope: "PLACE" as const,
    status: "PENDING" as const,
    reason: input.reason,
    attempts: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
  // The guard and winner read share a D1 transaction. An admin/cron enqueue
  // cannot slip between the initial lookup and insertion or complete before
  // we identify the job which won the race.
  const activeScope = and(
    eq(ratingRecomputeJobs.placeId, input.placeId),
    eq(ratingRecomputeJobs.configId, config.id),
    inArray(ratingRecomputeJobs.status, ["PENDING", "RUNNING"]),
  );
  const [, winners] = await db.batch([
    db.insert(ratingRecomputeJobs).select(sql`SELECT ${job.id}, ${job.placeId}, ${job.configId}, 'PLACE', 'PENDING', ${job.reason}, 0, NULL, NULL, NULL, ${job.createdAt}, ${job.updatedAt}
      WHERE NOT EXISTS(SELECT 1 FROM rating_recompute_jobs WHERE place_id=${input.placeId} AND config_id=${config.id} AND status IN ('PENDING','RUNNING'))`).onConflictDoNothing(),
    db.select().from(ratingRecomputeJobs).where(or(eq(ratingRecomputeJobs.id, job.id), activeScope))
      .orderBy(desc(sql`${ratingRecomputeJobs.id}=${job.id}`)).limit(1),
  ]);
  const existing = winners[0];
  if (!existing || existing.placeId !== input.placeId || existing.configId !== config.id)
    throw new Error("RATING_JOB_SCOPE_MISMATCH");
  return existing;
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function recomputePlaceRating(
  db: AppDb,
  input: { placeId: string; now: string; expectedConfigId?: string },
) {
  // Capture before reading inputs. A concurrent change leaves this snapshot
  // bound to the old revision/epoch and public reads reject it.
  const [config, moderationEpoch, voteRevision] = await Promise.all([
    getActiveRatingConfig(db, input.now),
    getPublicationEpoch(db),
    getPlaceVoteRevision(db, input.placeId),
  ]);
  if (input.expectedConfigId && config.id !== input.expectedConfigId)
    throw new Error("RATING_CONFIG_CHANGED");
  const rows = await db
    .select({
      userId: currentVotes.userId,
      value: currentVotes.value,
      eventId: currentVotes.eventId,
      source: voteEvents.source,
      invalidatedEventId: invalidatedVoteEvents.voteEventId,
    })
    .from(currentVotes)
    .innerJoin(voteEvents, eq(voteEvents.id, currentVotes.eventId))
    .leftJoin(
      invalidatedVoteEvents,
      eq(invalidatedVoteEvents.voteEventId, currentVotes.eventId),
    )
    .where(
      and(eq(currentVotes.placeId, input.placeId), eligibleVoteCondition()),
    )
    .orderBy(asc(currentVotes.userId));
  const active = rows.filter(
    (row) => !row.invalidatedEventId && (row.value === 1 || row.value === -1),
  );
  const reviewerIds = active
    .filter((row) => row.source === "REVIEWER")
    .map((row) => row.userId);
  const reliabilities = reviewerIds.length
    ? await loadInD1Chunks(
        reviewerIds,
        (reviewerChunk) =>
          db
            .select()
            .from(reviewerReliabilitySnapshots)
            .where(
              and(
                eq(reviewerReliabilitySnapshots.configId, config.id),
                eq(
                  reviewerReliabilitySnapshots.moderationEpoch,
                  moderationEpoch,
                ),
                inArray(
                  reviewerReliabilitySnapshots.reviewerUserId,
                  reviewerChunk,
                ),
              ),
            )
            .orderBy(desc(reviewerReliabilitySnapshots.computedAt)),
        { reservedBindings: 2 },
      )
    : [];
  const reliabilityByUser = new Map<string, number>();
  for (const row of reliabilities)
    if (!reliabilityByUser.has(row.reviewerUserId))
      reliabilityByUser.set(row.reviewerUserId, row.reliabilityWeight);
  const edges = reviewerIds.length
    ? await db
        .select()
        .from(reviewerSimilarityEdges)
        .where(
          and(
            eq(reviewerSimilarityEdges.configId, config.id),
            eq(reviewerSimilarityEdges.moderationEpoch, moderationEpoch),
          ),
        )
    : [];
  const dampingByUser = new Map<string, number>();
  for (const edge of edges) {
    dampingByUser.set(edge.leftReviewerUserId, edge.damping);
    dampingByUser.set(edge.rightReviewerUserId, edge.damping);
  }
  const result = calculateRatingV2({
    userVotes: active
      .filter((row) => row.source === "GENERAL")
      .map((row) => row.value as -1 | 1),
    reviewerVotes: active
      .filter((row) => row.source === "REVIEWER")
      .map((row) => ({
        reviewerId: row.userId,
        value: row.value as -1 | 1,
        reliabilityWeight: reliabilityByUser.get(row.userId) ?? 1,
        similarityDamping: dampingByUser.get(row.userId) ?? 1,
      })),
  });
  const hashInput = active.map((row) => ({
    userId: row.userId,
    eventId: row.eventId,
    value: row.value,
    source: row.source,
  }));
  const trustInput = reviewerIds.sort().map((reviewerId) => ({
    reviewerId,
    reliabilityWeight: reliabilityByUser.get(reviewerId) ?? 1,
    similarityDamping: dampingByUser.get(reviewerId) ?? 1,
  }));
  const inputHash = await sha256(
    JSON.stringify({
      config: config.algorithmVersion,
      moderationEpoch,
      voteRevision,
      votes: hashInput,
      reviewerTrust: trustInput,
    }),
  );
  const existing = await db.query.ratingSnapshots.findFirst({
    where: and(
      eq(ratingSnapshots.placeId, input.placeId),
      eq(ratingSnapshots.configId, config.id),
      eq(ratingSnapshots.inputHash, inputHash),
    ),
  });
  if (existing) {
    if (existing.isStale)
      await db
        .update(ratingSnapshots)
        .set({ isStale: false, updatedAt: input.now })
        .where(eq(ratingSnapshots.id, existing.id));
    return { ...existing, isStale: false };
  }
  const snapshot = {
    id: crypto.randomUUID(),
    placeId: input.placeId,
    configId: config.id,
    inputHash,
    moderationEpoch,
    voteRevision,
    overallScore: result.overall.displayScore,
    userScore: result.users.displayScore,
    reviewerScore: result.reviewers.displayScore,
    overallSampleCount: result.overall.sampleCount,
    userSampleCount: result.users.sampleCount,
    reviewerSampleCount: result.reviewers.sampleCount,
    reviewerRawWeight: result.reviewers.rawEffectiveWeight,
    reviewerCombinedWeight: result.reviewers.combinedEffectiveWeight,
    reviewerWeightShare: result.reviewerWeightShare,
    reasonsJson: JSON.stringify({
      algorithmVersion: result.algorithmVersion,
      reasons: result.reasons,
    }),
    isStale: false,
    computedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  };
  await db.batch([
    db
      .update(ratingSnapshots)
      .set({ isStale: true, updatedAt: input.now })
      .where(eq(ratingSnapshots.placeId, input.placeId)),
    db.insert(ratingSnapshots).values(snapshot),
  ]);
  return snapshot;
}

export type RatingRecomputeJob = typeof ratingRecomputeJobs.$inferSelect;

export type RatingJobResult = {
  jobId: string;
  job: RatingRecomputeJob | null;
  status: RatingRecomputeJob["status"] | "UNKNOWN";
  claimed: boolean;
};

export async function getRatingJobResult(
  db: AppDb,
  jobId: string,
): Promise<RatingJobResult> {
  const job = await db.query.ratingRecomputeJobs.findFirst({
    where: eq(ratingRecomputeJobs.id, jobId),
  });
  return { jobId, job: job ?? null, status: job?.status ?? "UNKNOWN", claimed: false };
}

/** Claim only the requested persisted job; the cron uses this same guard. */
export async function processRatingJob(
  db: AppDb,
  input: {
    jobId: string;
    placeId: string | null;
    configId: string;
    now: string;
    retryFailedAtAttempt?: number;
  },
): Promise<RatingJobResult> {
  const existing = await getRatingJobResult(db, input.jobId);
  const job = existing.job;
  if (!job) return existing;
  if (job.placeId !== input.placeId || job.configId !== input.configId)
    throw new Error("RATING_JOB_SCOPE_MISMATCH");
  const retry = job.status === "FAILED" && input.retryFailedAtAttempt === job.attempts;
  if (job.status !== "PENDING" && !retry) return existing;
  const [claimed] = await db.update(ratingRecomputeJobs).set({
    status: "RUNNING", attempts: job.attempts + 1, startedAt: input.now,
    finishedAt: null, errorSummary: null, updatedAt: input.now,
  }).where(and(
    eq(ratingRecomputeJobs.id, job.id),
    eq(ratingRecomputeJobs.status, job.status),
    eq(ratingRecomputeJobs.attempts, job.attempts),
  )).returning();
  if (!claimed) return getRatingJobResult(db, job.id);
  const ownedAttempt = and(
    eq(ratingRecomputeJobs.id, job.id),
    eq(ratingRecomputeJobs.status, "RUNNING"),
    eq(ratingRecomputeJobs.attempts, claimed.attempts),
  );
  try {
    if (!input.placeId || job.scope !== "PLACE") throw new Error("PLACE_JOB_MISSING_PLACE");
    await recomputePlaceRating(db, {
      placeId: input.placeId, now: input.now, expectedConfigId: job.configId,
    });
    await db.update(ratingRecomputeJobs).set({
      status: "COMPLETED", finishedAt: input.now, errorSummary: null, updatedAt: input.now,
    }).where(ownedAttempt);
  } catch (error) {
    await db.update(ratingRecomputeJobs).set({
      status: "FAILED", finishedAt: input.now, updatedAt: input.now,
      errorSummary: error instanceof Error && error.message === "RATING_CONFIG_CHANGED"
        ? "RATING_CONFIG_CHANGED" : "RATING_RECOMPUTE_FAILED",
    }).where(ownedAttempt);
  }
  return { ...await getRatingJobResult(db, job.id), claimed: true };
}

export async function processRatingJobs(
  db: AppDb,
  input: { now: string; limit: number },
) {
  // Global moderation invalidates cross-place trust. Refill only a bounded
  // page of previously computed places through the existing maintenance loop.
  const stalePlaces = await db
    .select({ id: placeTable.id })
    .from(placeTable)
    .where(
      and(
        eq(placeTable.status, "PUBLISHED"),
        sql`exists(select 1 from rating_snapshots prior where prior.place_id=${placeTable.id})`,
        sql`not exists(select 1 from rating_snapshots fresh where fresh.place_id=${placeTable.id} and fresh.is_stale=0 and fresh.vote_revision=${placeTable.voteRevision} and fresh.moderation_epoch=(select epoch from reviewer_publication_state where id='global'))`,
        sql`not exists(select 1 from rating_recompute_jobs pending where pending.place_id=${placeTable.id} and pending.status in ('PENDING','RUNNING'))`,
      ),
    )
    .orderBy(asc(placeTable.id))
    .limit(Math.max(0, Math.min(input.limit, 100)));
  for (const place of stalePlaces)
    await enqueueRatingRecompute(db, {
      placeId: place.id,
      reason: "PUBLICATION_EPOCH_CHANGED",
      now: input.now,
    });
  const jobs = await db
    .select()
    .from(ratingRecomputeJobs)
    .where(eq(ratingRecomputeJobs.status, "PENDING"))
    .orderBy(asc(ratingRecomputeJobs.createdAt))
    .limit(Math.max(0, Math.min(input.limit, 100)));
  let completed = 0;
  let failed = 0;
  let processed = 0;
  for (const job of jobs) {
    const result = await processRatingJob(db, {
      jobId: job.id, placeId: job.placeId, configId: job.configId, now: input.now,
    });
    if (!result.claimed) continue;
    processed += 1;
    if (result.status === "COMPLETED") completed += 1;
    if (result.status === "FAILED") failed += 1;
  }
  return { processed, completed, failed };
}

function currentSnapshotCondition() {
  return and(
    eq(ratingSnapshots.isStale, false),
    eq(
      ratingSnapshots.moderationEpoch,
      sql<number>`(select ${reviewerPublicationState.epoch} from ${reviewerPublicationState} where ${reviewerPublicationState.id} = 'global')`,
    ),
    eq(
      ratingSnapshots.voteRevision,
      sql<number>`(select ${placeTable.voteRevision} from ${placeTable} where ${placeTable.id} = ${ratingSnapshots.placeId})`,
    ),
  );
}

export async function getLatestRatingSnapshot(db: AppDb, placeId: string) {
  const [snapshot] = await db
    .select()
    .from(ratingSnapshots)
    .where(
      and(eq(ratingSnapshots.placeId, placeId), currentSnapshotCondition()),
    )
    .orderBy(desc(ratingSnapshots.computedAt))
    .limit(1);
  return snapshot;
}

export async function attachLatestNonStaleRatingSnapshots<
  T extends { id: string },
>(db: AppDb, places: T[]) {
  if (places.length === 0) return places;
  const snapshots = await loadInD1Chunks(
    places.map((place) => place.id),
    (placeIdChunk) =>
      db
        .select()
        .from(ratingSnapshots)
        .where(
          and(
            inArray(ratingSnapshots.placeId, placeIdChunk),
            currentSnapshotCondition(),
          ),
        )
        .orderBy(desc(ratingSnapshots.computedAt)),
    { reservedBindings: 1 },
  );
  const latestSnapshot = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!latestSnapshot.has(snapshot.placeId))
      latestSnapshot.set(snapshot.placeId, snapshot);
  }
  return places.map((place) => {
    const snapshot = latestSnapshot.get(place.id);
    if (!snapshot) return place;
    return {
      ...place,
      ratingScore: snapshot.overallScore,
      ratingSampleCount: snapshot.overallSampleCount,
      userScore: snapshot.userScore,
      reviewerScore: snapshot.reviewerScore,
      userRatingScore: snapshot.userScore,
      userRatingSampleCount: snapshot.userSampleCount,
      reviewerRatingScore: snapshot.reviewerScore,
      reviewerRatingSampleCount: snapshot.reviewerSampleCount,
    };
  });
}
