import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import { ratingSnapshots, userTasteBadges } from "../../db/schema";
import { listActiveGoldenPicks } from "../ratings/golden-pick.server";
import {
  mergePersonalDiscoveryRankings,
  rankGoldenRelay,
  rankPersonalDiscovery,
  rankTrustedPlaces,
  type DiscoveryCenter,
  type DiscoveryPlace,
} from "./place-discovery";
import {
  buildRecommendationChips,
  buildRecommendationTitle,
  parseRecommendationSelection,
} from "./place-recommendation-options";
import { listRecommendationCandidates } from "./place.server";

export type PlaceRecommendationPage = {
  chips: ReturnType<typeof buildRecommendationChips>;
  selectedBadges: string[];
  title: string;
  personal: DiscoveryPlace[];
  trusted: DiscoveryPlace[];
  golden: DiscoveryPlace[];
};

function withFallback<T extends { id: string }>(preferred: T[], all: T[], limit: number) {
  const output = [...preferred];
  for (const item of all) {
    if (output.length >= limit) break;
    if (!output.some((candidate) => candidate.id === item.id)) output.push(item);
  }
  return output.slice(0, limit);
}

export async function getPlaceRecommendationPage(db: AppDb, input: {
  userId?: string | null;
  tasteBadgeIds?: string[];
  bbox: [number, number, number, number];
  categorySlug?: string;
  center: DiscoveryCenter;
  selectedBadges: string[];
  now: string;
  limit?: number;
}): Promise<PlaceRecommendationPage> {
  const limit = input.limit ?? 8;
  const [places, goldenPicks, storedTaste] = await Promise.all([
    listRecommendationCandidates(db, { bbox: input.bbox, categorySlug: input.categorySlug, limit: 500 }),
    listActiveGoldenPicks(db, input.now),
    input.userId ? db.select({ badgeId: userTasteBadges.badgeId, score: userTasteBadges.score })
      .from(userTasteBadges).where(eq(userTasteBadges.userId, input.userId)).orderBy(desc(userTasteBadges.score)) : Promise.resolve([]),
  ]);
  const placeIds = places.map((place) => place.id);
  const snapshots = await loadInD1Chunks(placeIds, (placeIdChunk) => db.select().from(ratingSnapshots)
    .where(and(inArray(ratingSnapshots.placeId, placeIdChunk), eq(ratingSnapshots.isStale, false)))
    .orderBy(desc(ratingSnapshots.computedAt)), { reservedBindings: 1 });
  const latestSnapshot = new Map<string, typeof snapshots[number]>();
  snapshots.forEach((snapshot) => {
    if (!latestSnapshot.has(snapshot.placeId)) latestSnapshot.set(snapshot.placeId, snapshot);
  });
  const candidates: DiscoveryPlace[] = places.map((place) => {
    const snapshot = latestSnapshot.get(place.id);
    return {
      ...place,
      ratingScore: snapshot?.overallScore,
      ratingSampleCount: snapshot?.overallSampleCount,
      userScore: snapshot?.userScore,
      reviewerScore: snapshot?.reviewerScore,
    };
  });
  const userBadgeIds = [...new Set([
    ...storedTaste.map((badge) => badge.badgeId),
    ...(input.tasteBadgeIds ?? []),
  ])];
  const selectedBadges = parseRecommendationSelection(input.selectedBadges);
  const month = new Date(input.now).getUTCMonth() + 1;
  const goldenCandidates = goldenPicks.flatMap((pick) => {
    const place = candidates.find((candidate) => candidate.id === pick.placeId);
    return place ? [{ ...place, reviewerUserId: pick.reviewerUserId, goldenPickAt: pick.effectiveAt }] : [];
  });
  const golden = rankGoldenRelay({ places: goldenCandidates, center: input.center, userBadgeIds, limit });
  const goldenIds = new Set(golden.map((place) => place.id));
  const trustedAll = rankTrustedPlaces({ places: candidates, limit: Math.max(limit * 3, limit) });
  const trusted = withFallback(trustedAll.filter((place) => !goldenIds.has(place.id)), trustedAll, limit);
  const reserved = new Set([...goldenIds, ...trusted.map((place) => place.id)]);
  const personalPreferred = rankPersonalDiscovery({
    places: candidates.filter((place) => !reserved.has(place.id)), selectedBadges, userBadgeIds, center: input.center, month, limit,
  });
  const personalFallback = rankPersonalDiscovery({ places: candidates, selectedBadges, userBadgeIds, center: input.center, month, limit });
  const personal = mergePersonalDiscoveryRankings({
    preferred: personalPreferred,
    fallback: personalFallback,
    limit,
  });

  return {
    chips: buildRecommendationChips({ userBadges: userBadgeIds, month }),
    selectedBadges,
    title: buildRecommendationTitle(selectedBadges, month),
    personal,
    trusted,
    golden,
  };
}
