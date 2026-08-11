import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import { ratingSnapshots, userTasteBadges } from "../../db/schema";
import { listActiveGoldenPicks } from "../ratings/golden-pick.server";
import {
  GUEST_TASTE_SIGNAL_SCORE,
  type DiscoveryPlace,
  type RankingTasteSignal,
} from "./place-discovery";
import { listRecommendationCandidates } from "./place.server";

export type RecommendationCandidateContext = {
  candidates: DiscoveryPlace[];
  goldenPicks: Awaited<ReturnType<typeof listActiveGoldenPicks>>;
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
    return {
      ...place,
      ratingScore: snapshot?.overallScore,
      ratingSampleCount: snapshot?.overallSampleCount,
      userScore: snapshot?.userScore,
      reviewerScore: snapshot?.reviewerScore,
    };
  });
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
  const [places, goldenPicks, storedTaste] = await Promise.all([
    listRecommendationCandidates(db, {
      bbox: input.bbox,
      categorySlug: input.categorySlug,
      limit: 500,
    }),
    listActiveGoldenPicks(db, input.now),
    loadStoredTasteSignals(db, input.userId),
  ]);
  const candidates = await attachLatestRatingSnapshots(db, places);

  return {
    candidates,
    goldenPicks,
    tasteSignals: mergeTasteSignals(storedTaste, input.tasteBadgeIds ?? []),
  };
}
