import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import { currentVotes, ratingSnapshots, userTasteBadges } from "../../db/schema";
import {
  loadGoldenPickContextForPlaces,
  type GoldenPlaceSummary,
} from "../ratings/golden-pick.server";
import {
  GUEST_TASTE_SIGNAL_SCORE,
  type DiscoveryPlace,
  type RankingTasteSignal,
} from "./place-discovery";
import { listRecommendationCandidates } from "./place.server";

export type RecommendationCandidateContext = {
  candidates: DiscoveryPlace[];
  dislikedPlaceIds: string[];
  goldenPicks: Awaited<ReturnType<typeof loadGoldenPickContextForPlaces>>["activePicks"];
  goldenSummaries: GoldenPlaceSummary[];
  tasteSignals: RankingTasteSignal[];
};

async function loadStoredTasteSignals(db: AppDb, userId?: string | null) {
  if (!userId) return [];

  return db.select({
    badgeId: userTasteBadges.badgeId,
    score: userTasteBadges.score,
    source: userTasteBadges.source,
  })
    .from(userTasteBadges)
    .where(eq(userTasteBadges.userId, userId))
    .orderBy(desc(userTasteBadges.score));
}

async function attachLatestRatingSnapshots(db: AppDb, places: DiscoveryPlace[]) {
  const placeIds = places.map((place) => place.id);
  const snapshots = await loadInD1Chunks(placeIds, (placeIdChunk) => db.select()
    .from(ratingSnapshots)
    .where(and(
      inArray(ratingSnapshots.placeId, placeIdChunk),
      eq(ratingSnapshots.isStale, false),
    ))
    .orderBy(desc(ratingSnapshots.computedAt)), { reservedBindings: 1 });
  const latestSnapshot = new Map<string, typeof snapshots[number]>();

  snapshots.forEach((snapshot) => {
    if (!latestSnapshot.has(snapshot.placeId)) latestSnapshot.set(snapshot.placeId, snapshot);
  });

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

async function loadDislikedPlaceIds(db: AppDb, userId: string | null | undefined, placeIds: string[]) {
  if (!userId) return [];

  const rows = await loadInD1Chunks(placeIds, (placeIdChunk) => db.select({ placeId: currentVotes.placeId })
    .from(currentVotes)
    .where(and(
      eq(currentVotes.userId, userId),
      eq(currentVotes.value, -1),
      inArray(currentVotes.placeId, placeIdChunk),
    )), { reservedBindings: 2 });
  const disliked = new Set(rows.map((row) => row.placeId));
  return placeIds.filter((placeId) => disliked.has(placeId));
}

function mergeTasteSignals(
  storedTaste: RankingTasteSignal[],
  guestTasteBadgeIds: string[],
) {
  const signals = new Map<string, RankingTasteSignal>();
  storedTaste.forEach((signal) => signals.set(signal.badgeId, signal));
  guestTasteBadgeIds.forEach((badgeId) => {
    if (!signals.has(badgeId)) {
      signals.set(badgeId, {
        badgeId,
        score: GUEST_TASTE_SIGNAL_SCORE,
        source: "USER",
      });
    }
  });
  return [...signals.values()];
}

export async function loadRecommendationCandidateContext(db: AppDb, input: {
  userId?: string | null;
  tasteBadgeIds?: string[];
  bbox: [number, number, number, number];
  categorySlug?: string;
  now: string;
}): Promise<RecommendationCandidateContext> {
  const [places, storedTaste] = await Promise.all([
    listRecommendationCandidates(db, {
      bbox: input.bbox,
      categorySlug: input.categorySlug,
      limit: 500,
    }),
    loadStoredTasteSignals(db, input.userId),
  ]);
  const placeIds = places.map((place) => place.id);
  const [placesWithRatings, dislikedPlaceIds] = await Promise.all([
    attachLatestRatingSnapshots(db, places),
    loadDislikedPlaceIds(db, input.userId, placeIds),
  ]);
  const disliked = new Set(dislikedPlaceIds);
  const candidates = placesWithRatings.filter((place) => !disliked.has(place.id));
  const goldenContext = await loadGoldenPickContextForPlaces(db, candidates.map((place) => place.id), input.now);

  return {
    candidates,
    dislikedPlaceIds,
    goldenPicks: goldenContext.activePicks,
    goldenSummaries: [...goldenContext.summaries.values()],
    tasteSignals: mergeTasteSignals(storedTaste, input.tasteBadgeIds ?? []),
  };
}
