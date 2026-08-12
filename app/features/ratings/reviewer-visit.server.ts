import { and, desc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  categories,
  currentVotes,
  goldenPickEvents,
  places,
  reviewerProfiles,
  reviewerVisitReviews,
  voteEvents,
} from "../../db/schema";
import { prepareGoldenPickGrant } from "./golden-pick.server";
import { enqueueRatingRecompute, markRatingStale } from "./recompute.server";
import {
  REVIEWER_BADGE_CATALOG,
  reviewerEvaluationToVoteValue,
  type ReviewerCategoryName,
  type ReviewerEvaluation,
} from "./reviewer-visit";

export type PublishReviewerVisitInput = {
  id: string;
  reviewerUserId: string;
  placeId: string;
  categoryId: string;
  categoryName: ReviewerCategoryName;
  evaluation: ReviewerEvaluation;
  badges: string[];
  golden: boolean;
  goldenReason: string | null;
  publishedPhotoCount: number;
  now: string;
};

function assertBadgeContract(input: PublishReviewerVisitInput) {
  const allowed = REVIEWER_BADGE_CATALOG[input.categoryName];
  if (!allowed) throw new Error("REVIEW_CATEGORY_INVALID");
  if (input.badges.length > 2 || new Set(input.badges).size !== input.badges.length) {
    throw new Error("REVIEW_BADGE_LIMIT");
  }
  if (input.badges.some((badge) => !allowed.includes(badge as never))) {
    throw new Error("REVIEW_BADGE_INVALID");
  }
}

export async function publishReviewerVisit(db: AppDb, input: PublishReviewerVisitInput) {
  assertBadgeContract(input);
  if (!Number.isInteger(input.publishedPhotoCount) || input.publishedPhotoCount < 0 || input.publishedPhotoCount > 5) {
    throw new Error("REVIEW_PHOTO_COUNT_INVALID");
  }
  if (input.golden && input.publishedPhotoCount < 1) {
    throw new Error("GOLDEN_PICK_PUBLISHED_PHOTO_REQUIRED");
  }
  if (input.golden && input.badges.length !== 2) throw new Error("GOLDEN_PICK_BADGES_REQUIRED");
  if (input.golden && (!input.goldenReason || input.goldenReason.trim().length < 15 || input.goldenReason.trim().length > 100)) {
    throw new Error("GOLDEN_PICK_REASON_LENGTH");
  }

  const [reviewer, place, category] = await Promise.all([
    db.query.reviewerProfiles.findFirst({ where: eq(reviewerProfiles.userId, input.reviewerUserId) }),
    db.query.places.findFirst({ where: eq(places.id, input.placeId) }),
    db.query.categories.findFirst({ where: and(eq(categories.id, input.categoryId), eq(categories.isActive, true)) }),
  ]);
  if (!reviewer || reviewer.status !== "ACTIVE") throw new Error("ACTIVE_REVIEWER_REQUIRED");
  if (!place || place.status !== "PUBLISHED") throw new Error("PUBLISHED_PLACE_REQUIRED");
  if (!category || category.name !== input.categoryName) throw new Error("REVIEW_CATEGORY_MISMATCH");

  const signal = reviewerEvaluationToVoteValue(input.evaluation);
  const previousVote = await db.query.currentVotes.findFirst({
    where: and(
      eq(currentVotes.placeId, input.placeId),
      eq(currentVotes.userId, input.reviewerUserId),
    ),
  });
  const voteEventId = crypto.randomUUID();
  const goldenEvent = input.golden
    ? await prepareGoldenPickGrant(db, {
      id: crypto.randomUUID(),
      reviewerUserId: input.reviewerUserId,
      placeId: input.placeId,
      reason: input.goldenReason!,
      now: input.now,
    })
    : null;
  const review = {
    id: input.id,
    placeId: input.placeId,
    reviewerUserId: input.reviewerUserId,
    categoryId: input.categoryId,
    evaluation: input.evaluation,
    badgesJson: JSON.stringify(input.badges),
    photoCount: input.publishedPhotoCount,
    goldenPickEventId: goldenEvent?.id ?? null,
    version: 1,
    publishedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const voteStatements = signal == null
    ? previousVote
      ? [
        db.insert(voteEvents).values({
          id: voteEventId,
          placeId: input.placeId,
          userId: input.reviewerUserId,
          value: previousVote.value,
          eventType: "WITHDRAW",
          previousEventId: previousVote.eventId,
          createdAt: input.now,
        }),
        db.delete(currentVotes).where(and(
          eq(currentVotes.placeId, input.placeId),
          eq(currentVotes.userId, input.reviewerUserId),
        )),
      ]
      : []
    : [
      db.insert(voteEvents).values({
        id: voteEventId,
        placeId: input.placeId,
        userId: input.reviewerUserId,
        value: signal,
        eventType: previousVote ? "CHANGE" : "CREATE",
        previousEventId: previousVote?.eventId ?? null,
        createdAt: input.now,
      }),
      db.insert(currentVotes).values({
        placeId: input.placeId,
        userId: input.reviewerUserId,
        eventId: voteEventId,
        value: signal,
        updatedAt: input.now,
      }).onConflictDoUpdate({
        target: [currentVotes.placeId, currentVotes.userId],
        set: { eventId: voteEventId, value: signal, updatedAt: input.now },
      }),
    ];
  const reviewInsert = db.insert(reviewerVisitReviews).values(review);
  const reviewerUpdate = db.update(reviewerProfiles)
    .set({ lastActivityAt: input.now, updatedAt: input.now })
    .where(eq(reviewerProfiles.userId, input.reviewerUserId));
  if (goldenEvent) {
    await db.batch([
      db.insert(goldenPickEvents).values(goldenEvent),
      reviewInsert,
      ...voteStatements,
      reviewerUpdate,
    ]);
  } else {
    await db.batch([reviewInsert, ...voteStatements, reviewerUpdate]);
  }
  if (signal != null || previousVote) {
    try {
      await markRatingStale(db, input.placeId, input.now);
      await enqueueRatingRecompute(db, {
        placeId: input.placeId,
        reason: signal == null ? "VOTE_WITHDRAWN" : "VOTE_CHANGED",
        now: input.now,
      });
    } catch {
      console.error("REVIEW_RATING_REFRESH_FAILED");
    }
  }
  return review;
}

export async function listReviewerVisitHistory(db: AppDb, reviewerUserId: string, limit = 8) {
  return db.select({
    id: reviewerVisitReviews.id,
    placeId: reviewerVisitReviews.placeId,
    placeName: places.name,
    categoryId: reviewerVisitReviews.categoryId,
    categoryName: categories.name,
    evaluation: reviewerVisitReviews.evaluation,
    badgesJson: reviewerVisitReviews.badgesJson,
    photoCount: reviewerVisitReviews.photoCount,
    goldenPickEventId: reviewerVisitReviews.goldenPickEventId,
    version: reviewerVisitReviews.version,
    publishedAt: reviewerVisitReviews.publishedAt,
  }).from(reviewerVisitReviews)
    .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
    .innerJoin(categories, eq(categories.id, reviewerVisitReviews.categoryId))
    .where(eq(reviewerVisitReviews.reviewerUserId, reviewerUserId))
    .orderBy(desc(reviewerVisitReviews.publishedAt), desc(reviewerVisitReviews.id))
    .limit(Math.max(1, Math.min(limit, 50)));
}
