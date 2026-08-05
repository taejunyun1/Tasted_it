import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  currentVotes,
  invalidatedVoteEvents,
  ratingRecomputeJobs,
  ratingSnapshots,
  reviewerReliabilitySnapshots,
  reviewerSimilarityEdges,
  users,
} from "../../db/schema";
import { calculateRatingV2 } from "./rating-v2";
import { getActiveRatingConfig } from "./rating-config.server";

export async function markRatingStale(db: AppDb, placeId: string, now: string) {
  await db.update(ratingSnapshots).set({ isStale: true, updatedAt: now }).where(eq(ratingSnapshots.placeId, placeId));
}

export async function enqueueRatingRecompute(db: AppDb, input: {
  placeId: string;
  reason: string;
  now: string;
  jobId?: string;
}) {
  const config = await getActiveRatingConfig(db, input.now);
  const pending = await db.query.ratingRecomputeJobs.findFirst({
    where: and(
      eq(ratingRecomputeJobs.placeId, input.placeId),
      eq(ratingRecomputeJobs.configId, config.id),
      eq(ratingRecomputeJobs.status, "PENDING"),
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
  await db.insert(ratingRecomputeJobs).values(job);
  return job;
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function recomputePlaceRating(db: AppDb, input: { placeId: string; now: string }) {
  const config = await getActiveRatingConfig(db, input.now);
  const rows = await db
    .select({
      userId: currentVotes.userId,
      value: currentVotes.value,
      eventId: currentVotes.eventId,
      role: users.role,
      invalidatedEventId: invalidatedVoteEvents.voteEventId,
    })
    .from(currentVotes)
    .innerJoin(users, eq(users.id, currentVotes.userId))
    .leftJoin(invalidatedVoteEvents, eq(invalidatedVoteEvents.voteEventId, currentVotes.eventId))
    .where(eq(currentVotes.placeId, input.placeId))
    .orderBy(asc(currentVotes.userId));
  const active = rows.filter((row) => !row.invalidatedEventId && (row.value === 1 || row.value === -1));
  const reviewerIds = active.filter((row) => row.role === "REVIEWER").map((row) => row.userId);
  const reliabilities = reviewerIds.length
    ? await db.select().from(reviewerReliabilitySnapshots)
      .where(and(eq(reviewerReliabilitySnapshots.configId, config.id), inArray(reviewerReliabilitySnapshots.reviewerUserId, reviewerIds)))
      .orderBy(desc(reviewerReliabilitySnapshots.computedAt))
    : [];
  const reliabilityByUser = new Map<string, number>();
  for (const row of reliabilities) if (!reliabilityByUser.has(row.reviewerUserId)) reliabilityByUser.set(row.reviewerUserId, row.reliabilityWeight);
  const edges = reviewerIds.length
    ? await db.select().from(reviewerSimilarityEdges).where(eq(reviewerSimilarityEdges.configId, config.id))
    : [];
  const dampingByUser = new Map<string, number>();
  for (const edge of edges) {
    dampingByUser.set(edge.leftReviewerUserId, edge.damping);
    dampingByUser.set(edge.rightReviewerUserId, edge.damping);
  }
  const result = calculateRatingV2({
    userVotes: active.filter((row) => row.role !== "REVIEWER").map((row) => row.value as -1 | 1),
    reviewerVotes: active.filter((row) => row.role === "REVIEWER").map((row) => ({
      reviewerId: row.userId,
      value: row.value as -1 | 1,
      reliabilityWeight: reliabilityByUser.get(row.userId) ?? 1,
      similarityDamping: dampingByUser.get(row.userId) ?? 1,
    })),
  });
  const hashInput = active.map((row) => ({ userId: row.userId, eventId: row.eventId, value: row.value, role: row.role }));
  const inputHash = await sha256(JSON.stringify({ config: config.algorithmVersion, votes: hashInput }));
  const existing = await db.query.ratingSnapshots.findFirst({
    where: and(eq(ratingSnapshots.placeId, input.placeId), eq(ratingSnapshots.configId, config.id), eq(ratingSnapshots.inputHash, inputHash)),
  });
  if (existing) {
    if (existing.isStale) await db.update(ratingSnapshots).set({ isStale: false, updatedAt: input.now }).where(eq(ratingSnapshots.id, existing.id));
    return { ...existing, isStale: false };
  }
  const snapshot = {
    id: crypto.randomUUID(), placeId: input.placeId, configId: config.id, inputHash,
    overallScore: result.overall.displayScore, userScore: result.users.displayScore, reviewerScore: result.reviewers.displayScore,
    overallSampleCount: result.overall.sampleCount, userSampleCount: result.users.sampleCount, reviewerSampleCount: result.reviewers.sampleCount,
    reviewerRawWeight: result.reviewers.rawEffectiveWeight, reviewerCombinedWeight: result.reviewers.combinedEffectiveWeight,
    reviewerWeightShare: result.reviewerWeightShare,
    reasonsJson: JSON.stringify({ algorithmVersion: result.algorithmVersion, reasons: result.reasons }),
    isStale: false, computedAt: input.now, createdAt: input.now, updatedAt: input.now,
  };
  await db.batch([
    db.update(ratingSnapshots).set({ isStale: true, updatedAt: input.now }).where(eq(ratingSnapshots.placeId, input.placeId)),
    db.insert(ratingSnapshots).values(snapshot),
  ]);
  return snapshot;
}

export async function processRatingJobs(db: AppDb, input: { now: string; limit: number }) {
  const jobs = await db.select().from(ratingRecomputeJobs)
    .where(eq(ratingRecomputeJobs.status, "PENDING"))
    .orderBy(asc(ratingRecomputeJobs.createdAt))
    .limit(Math.max(0, Math.min(input.limit, 100)));
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    await db.update(ratingRecomputeJobs).set({ status: "RUNNING", attempts: job.attempts + 1, startedAt: input.now, updatedAt: input.now }).where(eq(ratingRecomputeJobs.id, job.id));
    try {
      if (!job.placeId) throw new Error("PLACE_JOB_MISSING_PLACE");
      await recomputePlaceRating(db, { placeId: job.placeId, now: input.now });
      await db.update(ratingRecomputeJobs).set({ status: "COMPLETED", finishedAt: input.now, errorSummary: null, updatedAt: input.now }).where(eq(ratingRecomputeJobs.id, job.id));
      completed += 1;
    } catch (error) {
      await db.update(ratingRecomputeJobs).set({ status: "FAILED", finishedAt: input.now, errorSummary: error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN_ERROR", updatedAt: input.now }).where(eq(ratingRecomputeJobs.id, job.id));
      failed += 1;
    }
  }
  return { processed: jobs.length, completed, failed };
}

export async function getLatestRatingSnapshot(db: AppDb, placeId: string) {
  return db.query.ratingSnapshots.findFirst({
    where: eq(ratingSnapshots.placeId, placeId),
    orderBy: [desc(ratingSnapshots.computedAt)],
  });
}
