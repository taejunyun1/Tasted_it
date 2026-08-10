import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  categories,
  placeCategories,
  places,
  recommendationFeedback,
  userTasteBadges,
} from "../../db/schema";
import { listMemberTaste } from "./member.server";
import { inferTasteBadges, type TasteBadgeScore } from "./profile-taste-badges";

export type FeedbackReason = "MENU" | "DISTANCE" | "PRICE" | "ATMOSPHERE" | "ALREADY_VISITED";

export async function recordRecommendationFeedback(db: AppDb, input: {
  userId: string;
  placeId: string;
  value: -1 | 1;
  reason: FeedbackReason | null;
  now: string;
}): Promise<void> {
  await db.insert(recommendationFeedback).values({
    userId: input.userId,
    placeId: input.placeId,
    value: input.value,
    reason: input.reason,
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoUpdate({
    target: [recommendationFeedback.userId, recommendationFeedback.placeId],
    set: {
      value: input.value,
      reason: input.reason,
      updatedAt: input.now,
    },
  });
}

function applyFoodPenalties(inferred: TasteBadgeScore[], foodBadgeIds: string[]) {
  const penaltyCounts = new Map<string, number>();
  for (const badgeId of foodBadgeIds) {
    penaltyCounts.set(badgeId, (penaltyCounts.get(badgeId) ?? 0) + 1);
  }
  return inferred.map((badge) => ({
    ...badge,
    score: Math.max(0, badge.score - (penaltyCounts.get(badge.badgeId) ?? 0) * 0.18),
  }));
}

export async function refreshInferredTasteSignals(
  db: AppDb,
  userId: string,
  now: string,
): Promise<void> {
  const [memberTaste, feedbackRows] = await Promise.all([
    listMemberTaste(db, userId),
    db.select({
      placeId: recommendationFeedback.placeId,
      value: recommendationFeedback.value,
      reason: recommendationFeedback.reason,
      name: places.name,
      categoryName: categories.name,
    }).from(recommendationFeedback)
      .innerJoin(places, eq(places.id, recommendationFeedback.placeId))
      .innerJoin(placeCategories, and(
        eq(placeCategories.placeId, places.id),
        eq(placeCategories.isPrimary, true),
      ))
      .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
      .where(and(
        eq(recommendationFeedback.userId, userId),
        eq(places.status, "PUBLISHED"),
      )),
  ]);

  const ratedPlaceIds = new Set(memberTaste.rated.map((place) => place.id));
  const feedbackRatings = feedbackRows
    .filter((row) => row.value === 1 && !ratedPlaceIds.has(row.placeId))
    .map((row) => ({ name: row.name, categoryName: row.categoryName, value: 1 }));
  const inferred = inferTasteBadges({
    saved: memberTaste.saved,
    rated: [...memberTaste.rated, ...feedbackRatings],
    flavorDimensions: [],
  });
  const negativeFoodBadgeIds = feedbackRows
    .filter((row) => row.value === -1 && (row.reason === null || row.reason === "MENU"))
    .flatMap((row) => inferTasteBadges({
      saved: [],
      rated: [{ name: row.name, categoryName: row.categoryName, value: 1 }],
      flavorDimensions: [],
    }).filter((badge) => badge.badgeId.startsWith("food-")).map((badge) => badge.badgeId));
  const adjusted = applyFoodPenalties(inferred, negativeFoodBadgeIds);

  const deleteInferred = db.delete(userTasteBadges).where(and(
    eq(userTasteBadges.userId, userId),
    eq(userTasteBadges.source, "INFERRED"),
  ));
  const upserts = adjusted.map((badge) => db.insert(userTasteBadges).values({
    userId,
    badgeId: badge.badgeId,
    source: "INFERRED" as const,
    score: badge.score,
    evidenceJson: JSON.stringify({ algorithm: "activity-v1" }),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [userTasteBadges.userId, userTasteBadges.badgeId, userTasteBadges.source],
    set: {
      score: badge.score,
      evidenceJson: JSON.stringify({ algorithm: "activity-v1" }),
      updatedAt: now,
    },
  }));

  const [first, ...rest] = [deleteInferred, ...upserts];
  await db.batch([first, ...rest]);
}
