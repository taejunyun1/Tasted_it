import { and, eq, sql } from "drizzle-orm";

import type { FeedbackReason } from "../members/taste-learning.server";
import type { AppDb } from "../../db/client.server";
import {
  currentVotes,
  voteEvents,
  recommendationFeedback,
  tasteLearningStates,
} from "../../db/schema";
import { eligibleVoteCondition } from "./reviewer-publication.server";
import { enqueueRatingRecompute, markRatingStale } from "./recompute.server";
import { recordOperationalAlert } from "../operations/alerts.server";

function invalidateVoteTaste(
  db: AppDb,
  input: { userId: string; eventId: string; now: string },
) {
  const versionToken = crypto.randomUUID();
  return db
    .insert(tasteLearningStates)
    .select(
      db
        .select({
          userId: sql<string>`${input.userId}`.as("user_id"),
          versionToken: sql<string>`${versionToken}`.as("version_token"),
          createdAt: sql<string>`${input.now}`.as("created_at"),
          updatedAt: sql<string>`${input.now}`.as("updated_at"),
        })
        .from(voteEvents)
        .where(eq(voteEvents.id, input.eventId)),
    )
    .onConflictDoUpdate({
      target: tasteLearningStates.userId,
      set: { versionToken, updatedAt: input.now },
    });
}

export interface CastVoteInput {
  placeId: string;
  userId: string;
  value: -1 | 1;
  now: string;
  eventId: string;
  feedback?: { reason: FeedbackReason | null };
}

export async function getCurrentVoteState(
  db: AppDb,
  input: Pick<CastVoteInput, "placeId" | "userId">,
): Promise<{ value: -1 | 1; eventId: string } | null> {
  const vote = await db.query.currentVotes.findFirst({
    where: and(
      eq(currentVotes.placeId, input.placeId),
      eq(currentVotes.userId, input.userId),
      eligibleVoteCondition(),
    ),
  });
  return vote?.value === -1 || vote?.value === 1
    ? { value: vote.value, eventId: vote.eventId }
    : null;
}

export async function getCurrentVote(
  db: AppDb,
  input: Pick<CastVoteInput, "placeId" | "userId">,
) {
  return (await getCurrentVoteState(db, input))?.value ?? null;
}

export async function castVote(db: AppDb, input: CastVoteInput): Promise<void> {
  if (input.value !== 1 && input.value !== -1) {
    throw new Error("INVALID_VOTE_VALUE");
  }

  if (
    input.feedback &&
    input.feedback.reason !== null &&
    !["MENU", "DISTANCE", "PRICE", "ATMOSPHERE", "ALREADY_VISITED"].includes(
      input.feedback.reason,
    )
  )
    throw new Error("INVALID_FEEDBACK_REASON");
  const previous = await db.query.currentVotes.findFirst({
    where: and(
      eq(currentVotes.placeId, input.placeId),
      eq(currentVotes.userId, input.userId),
    ),
  });

  const previousEvent = previous
    ? await db.query.voteEvents.findFirst({
        where: eq(voteEvents.id, previous.eventId),
      })
    : null;
  if (
    previous?.value === input.value &&
    previousEvent?.source === "GENERAL" &&
    !input.feedback
  ) {
    return;
  }

  await db.batch([
    db.insert(voteEvents).values({
      id: input.eventId,
      placeId: input.placeId,
      userId: input.userId,
      value: input.value,
      source: "GENERAL",
      eventType: previous ? "CHANGE" : "CREATE",
      previousEventId: previous?.eventId ?? null,
      createdAt: input.now,
    }),
    db
      .insert(currentVotes)
      .values({
        placeId: input.placeId,
        userId: input.userId,
        eventId: input.eventId,
        value: input.value,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [currentVotes.placeId, currentVotes.userId],
        set: {
          eventId: input.eventId,
          value: input.value,
          updatedAt: input.now,
        },
      }),
    ...(input.feedback
      ? [
          db
            .insert(recommendationFeedback)
            .values({
              userId: input.userId,
              placeId: input.placeId,
              value: input.value,
              reason: input.feedback.reason,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoUpdate({
              target: [
                recommendationFeedback.userId,
                recommendationFeedback.placeId,
              ],
              set: {
                value: input.value,
                reason: input.feedback.reason,
                updatedAt: input.now,
              },
            }),
        ]
      : []),
    invalidateVoteTaste(db, input),
  ]);
  await markRatingStale(db, input.placeId, input.now);
  await enqueueRatingRecompute(db, {
    placeId: input.placeId,
    reason: "VOTE_CHANGED",
    now: input.now,
  });
}

export async function withdrawVote(
  db: AppDb,
  input: Pick<CastVoteInput, "placeId" | "userId" | "now" | "eventId"> & {
    clearFeedback?: boolean;
    expectedEventId?: string;
  },
): Promise<boolean> {
  const previous = await db.query.currentVotes.findFirst({
    where: and(
      eq(currentVotes.placeId, input.placeId),
      eq(currentVotes.userId, input.userId),
    ),
  });
  if (!previous) {
    if (input.expectedEventId) throw new Error("VOTE_VERSION_CONFLICT");
    return false;
  }
  if (input.expectedEventId && input.expectedEventId !== previous.eventId)
    throw new Error("VOTE_VERSION_CONFLICT");

  await db.batch([
    db.insert(voteEvents).select(
      db
        .select({
          id: sql<string>`${input.eventId}`.as("id"),
          placeId: currentVotes.placeId,
          userId: currentVotes.userId,
          value: currentVotes.value,
          source: sql<"GENERAL">`'GENERAL'`.as("source"),
          reviewId: sql<null>`null`.as("review_id"),
          reviewVersion: sql<null>`null`.as("review_version"),
          eventType: sql<"WITHDRAW">`'WITHDRAW'`.as("event_type"),
          previousEventId: currentVotes.eventId,
          createdAt: sql<string>`${input.now}`.as("created_at"),
        })
        .from(currentVotes)
        .where(
          and(
            eq(currentVotes.placeId, input.placeId),
            eq(currentVotes.userId, input.userId),
            eq(currentVotes.eventId, previous.eventId),
          ),
        ),
    ),
    ...(input.clearFeedback
      ? [
          db
            .delete(recommendationFeedback)
            .where(
              and(
                eq(recommendationFeedback.userId, input.userId),
                eq(recommendationFeedback.placeId, input.placeId),
                sql`exists(select 1 from vote_events where id=${input.eventId})`,
              ),
            ),
        ]
      : []),
    db
      .delete(currentVotes)
      .where(
        and(
          eq(currentVotes.placeId, input.placeId),
          eq(currentVotes.userId, input.userId),
          eq(currentVotes.eventId, previous.eventId),
          sql`exists(select 1 from vote_events where id=${input.eventId})`,
        ),
      ),
    invalidateVoteTaste(db, input),
  ]);
  if (
    !(await db.query.voteEvents.findFirst({
      where: eq(voteEvents.id, input.eventId),
    }))
  )
    throw new Error("VOTE_VERSION_CONFLICT");
  await markRatingStale(db, input.placeId, input.now);
  try {
    await enqueueRatingRecompute(db, {
      placeId: input.placeId,
      reason: "VOTE_WITHDRAWN",
      now: input.now,
    });
  } catch (error) {
    if (!(error instanceof Error) || (error.message !== "ACTIVE_RATING_CONFIG_NOT_FOUND" && error.message !== "RATING_CONFIG_CHANGED")) throw error;
    await recordOperationalAlert(db, {
      alertType: "RATING_RECOMPUTE",
      sourceId: "ACTIVE_RATING_CONFIG_NOT_FOUND",
      message: "반응 철회는 저장했지만 활성 평가 설정을 확인할 수 없어 재계산을 접수하지 못했습니다.",
      details: { code: error.message },
      now: input.now,
    });
  }
  return true;
}
