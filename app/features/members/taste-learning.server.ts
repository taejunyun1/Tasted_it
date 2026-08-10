import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, notInArray, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  categories,
  placeCategories,
  places,
  productEvents,
  recommendationFeedback,
  userTasteBadges,
} from "../../db/schema";
import { listMemberTaste } from "./member.server";
import { inferTasteBadges, type TasteBadgeScore } from "./profile-taste-badges";

export type FeedbackReason = "MENU" | "DISTANCE" | "PRICE" | "ATMOSPHERE" | "ALREADY_VISITED";

const ACTIVITY_VERSION_EVENT = "TASTE_ACTIVITY_VERSION";

function activityVersionId(userId: string) {
  return `taste-activity-version:${userId}`;
}

function activityVersionJson() {
  return JSON.stringify({ version: crypto.randomUUID() });
}

export function createTasteActivityVersionWrite(db: AppDb, userId: string, now: string) {
  const versionJson = activityVersionJson();
  return db.insert(productEvents).values({
    id: activityVersionId(userId),
    userId,
    guestSessionId: null,
    eventName: ACTIVITY_VERSION_EVENT,
    metadataJson: versionJson,
    occurredAt: now,
  }).onConflictDoUpdate({
    target: productEvents.id,
    set: {
      userId,
      eventName: ACTIVITY_VERSION_EVENT,
      metadataJson: versionJson,
      occurredAt: now,
    },
  });
}

export async function recordRecommendationFeedback(db: AppDb, input: {
  userId: string;
  placeId: string;
  value: -1 | 1;
  reason: FeedbackReason | null;
  now: string;
}): Promise<void> {
  await db.batch([
    db.insert(recommendationFeedback).values({
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
    }),
    createTasteActivityVersionWrite(db, input.userId, input.now),
  ]);
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
  options: { afterSnapshot?: () => Promise<void> } = {},
): Promise<void> {
  const versionId = activityVersionId(userId);
  await db.insert(productEvents).values({
    id: versionId,
    userId,
    guestSessionId: null,
    eventName: ACTIVITY_VERSION_EVENT,
    metadataJson: activityVersionJson(),
    occurredAt: now,
  }).onConflictDoNothing();
  const version = await db.query.productEvents.findFirst({
    where: eq(productEvents.id, versionId),
  });
  if (!version) throw new Error("TASTE_ACTIVITY_VERSION_UNAVAILABLE");

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

  const leaseJson = activityVersionJson();
  const leaseIsCurrent = sql`exists (
    select 1 from ${productEvents}
    where ${productEvents.id} = ${versionId}
      and ${productEvents.metadataJson} = ${leaseJson}
  )`;
  const badgeIds = adjusted.map((badge) => badge.badgeId);
  const claimVersion = db.update(productEvents).set({
    metadataJson: leaseJson,
    occurredAt: now,
  }).where(and(
    eq(productEvents.id, versionId),
    eq(productEvents.metadataJson, version.metadataJson),
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
    }).from(productEvents).where(and(
      eq(productEvents.id, versionId),
      eq(productEvents.metadataJson, leaseJson),
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
