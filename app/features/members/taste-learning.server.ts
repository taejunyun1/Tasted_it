import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, notInArray, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  categories,
  placeCategories,
  places,
  recommendationFeedback,
  tasteLearningStates,
  userTasteBadges,
} from "../../db/schema";
import { listMemberTaste } from "./member.server";
import { inferTasteBadges, type TasteBadgeScore } from "./profile-taste-badges";

export type FeedbackReason = "MENU" | "DISTANCE" | "PRICE" | "ATMOSPHERE" | "ALREADY_VISITED";

export async function advanceTasteLearningVersion(
  db: AppDb,
  userId: string,
  now: string,
): Promise<string> {
  const versionToken = crypto.randomUUID();
  await db.insert(tasteLearningStates).values({
    userId,
    versionToken,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: tasteLearningStates.userId,
    set: {
      versionToken,
      updatedAt: now,
    },
  });
  return versionToken;
}

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
  options: {
    afterSnapshot?: () => Promise<void>;
    observedVersion?: string;
  } = {},
): Promise<void> {
  const observedVersion = options.observedVersion
    ?? await advanceTasteLearningVersion(db, userId, now);

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

  await options.afterSnapshot?.();

  const leaseToken = crypto.randomUUID();
  const leaseIsCurrent = sql`exists (
    select 1 from ${tasteLearningStates}
    where ${tasteLearningStates.userId} = ${userId}
      and ${tasteLearningStates.versionToken} = ${leaseToken}
  )`;
  const badgeIds = adjusted.map((badge) => badge.badgeId);
  const claimVersion = db.update(tasteLearningStates).set({
    versionToken: leaseToken,
    updatedAt: now,
  }).where(and(
    eq(tasteLearningStates.userId, userId),
    eq(tasteLearningStates.versionToken, observedVersion),
  ));
  const deleteStaleInferred = db.delete(userTasteBadges).where(and(
    eq(userTasteBadges.userId, userId),
    eq(userTasteBadges.source, "INFERRED"),
    badgeIds.length > 0 ? notInArray(userTasteBadges.badgeId, badgeIds) : undefined,
    leaseIsCurrent,
  ));
  const evidenceJson = JSON.stringify({ algorithm: "activity-v1" });
  const upserts = adjusted.map((badge) => db.insert(userTasteBadges).select(
    db.select({
      userId: sql<string>`${userId}`.as("user_id"),
      badgeId: sql<string>`${badge.badgeId}`.as("badge_id"),
      source: sql<"INFERRED">`'INFERRED'`.as("source"),
      score: sql<number>`${badge.score}`.as("score"),
      evidenceJson: sql<string>`${evidenceJson}`.as("evidence_json"),
      createdAt: sql<string>`${now}`.as("created_at"),
      updatedAt: sql<string>`${now}`.as("updated_at"),
    }).from(tasteLearningStates).where(and(
      eq(tasteLearningStates.userId, userId),
      eq(tasteLearningStates.versionToken, leaseToken),
    )),
  ).onConflictDoUpdate({
    target: [userTasteBadges.userId, userTasteBadges.badgeId, userTasteBadges.source],
    set: {
      score: badge.score,
      evidenceJson,
      updatedAt: now,
    },
  }));

  const statements: BatchItem<"sqlite">[] = [claimVersion, deleteStaleInferred, ...upserts];
  const [first, ...rest] = statements;
  await db.batch([first, ...rest]);
}
