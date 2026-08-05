import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  currentVotes,
  integrityCases,
  invalidatedVoteEvents,
  placeCategories,
  placeDailyMetrics,
  places,
  ratingSnapshots,
  users,
} from "../../db/schema";
import { evaluateHiddenGem, evaluateHotTake } from "./rating-badges";

function dateOnly(value: string) { return value.slice(0, 10); }

export async function recordPlaceDetailView(db: AppDb, input: { placeId: string; now: string }) {
  const metricDate = dateOnly(input.now);
  await db.insert(placeDailyMetrics).values({
    placeId: input.placeId, metricDate, detailViews: 1, directionClicks: 0, saveActions: 0,
  }).onConflictDoUpdate({
    target: [placeDailyMetrics.placeId, placeDailyMetrics.metricDate],
    set: { detailViews: sql`${placeDailyMetrics.detailViews} + 1` },
  });
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function getHiddenGemStatus(db: AppDb, input: { placeId: string; now: string }) {
  const target = await db.select({ categoryId: placeCategories.categoryId, neighborhood: places.neighborhood })
    .from(places)
    .innerJoin(placeCategories, and(eq(placeCategories.placeId, places.id), eq(placeCategories.isPrimary, true)))
    .where(eq(places.id, input.placeId)).limit(1);
  const cutoff = new Date(input.now); cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  const peerIds = target[0] ? (await db.select({ placeId: places.id }).from(places)
    .innerJoin(placeCategories, and(eq(placeCategories.placeId, places.id), eq(placeCategories.categoryId, target[0].categoryId), eq(placeCategories.isPrimary, true)))
    .where(and(eq(places.status, "PUBLISHED"), eq(places.neighborhood, target[0].neighborhood))).limit(1_000)).map((row) => row.placeId) : [];
  const metrics = peerIds.length ? await db.select().from(placeDailyMetrics)
    .where(and(inArray(placeDailyMetrics.placeId, peerIds), gte(placeDailyMetrics.metricDate, dateOnly(cutoff.toISOString())))) : [];
  const viewsByPlace = new Map(peerIds.map((placeId) => [placeId, 0]));
  for (const metric of metrics) viewsByPlace.set(metric.placeId, (viewsByPlace.get(metric.placeId) ?? 0) + metric.detailViews);
  const snapshot = await db.query.ratingSnapshots.findFirst({ where: eq(ratingSnapshots.placeId, input.placeId), orderBy: [desc(ratingSnapshots.computedAt)] });
  const openCase = await db.query.integrityCases.findFirst({ where: and(
    eq(integrityCases.subjectType, "PLACE"), eq(integrityCases.subjectId, input.placeId),
    ne(integrityCases.status, "DISMISSED"), ne(integrityCases.status, "CONFIRMED"),
  ) });
  const detailViews90d = viewsByPlace.has(input.placeId) ? viewsByPlace.get(input.placeId)! : null;
  const categoryRegionMedianViews90d = median([...viewsByPlace.values()]);
  const evaluated = evaluateHiddenGem({
    totalVotes: snapshot?.overallSampleCount ?? 0,
    overallScore: snapshot?.overallScore ?? null,
    reviewerVotes: snapshot?.reviewerSampleCount ?? 0,
    reviewerScore: snapshot?.reviewerScore ?? null,
    detailViews90d,
    categoryRegionMedianViews90d,
    hasOpenIntegrityCase: Boolean(openCase),
  });
  return { ...evaluated, detailViews90d, categoryRegionMedianViews90d };
}

export async function listReviewerHotTakes(db: AppDb, reviewerUserId: string) {
  const rows = await db.select({
    placeId: currentVotes.placeId, userId: currentVotes.userId, value: currentVotes.value,
    invalidatedEventId: invalidatedVoteEvents.voteEventId,
  }).from(currentVotes)
    .innerJoin(users, and(eq(users.id, currentVotes.userId), eq(users.role, "REVIEWER")))
    .leftJoin(invalidatedVoteEvents, eq(invalidatedVoteEvents.voteEventId, currentVotes.eventId))
    .orderBy(asc(currentVotes.placeId), asc(currentVotes.userId))
    .limit(50_000);
  const active = rows.filter((row) => !row.invalidatedEventId && (row.value === 1 || row.value === -1));
  const own = active.filter((row) => row.userId === reviewerUserId);
  return new Map(own.map((vote) => {
    const peers = active.filter((row) => row.placeId === vote.placeId && row.userId !== reviewerUserId);
    return [vote.placeId, evaluateHotTake({
      reviewerValue: vote.value as -1 | 1,
      peerPositive: peers.filter((row) => row.value === 1).length,
      peerNegative: peers.filter((row) => row.value === -1).length,
    })];
  }));
}
