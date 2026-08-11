import type { AppDb } from "../../db/client.server";
import {
  mergePersonalDiscoveryRankings,
  normalizedTasteSignalStrength,
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
import { loadRecommendationCandidateContext } from "./recommendation-candidates.server";

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
  const { candidates, goldenPicks, tasteSignals } = await loadRecommendationCandidateContext(db, input);
  const userBadgeIds = [...new Set(tasteSignals
    .filter((signal) => normalizedTasteSignalStrength(signal) > 0)
    .sort((left, right) => normalizedTasteSignalStrength(right) - normalizedTasteSignalStrength(left))
    .map((signal) => signal.badgeId))];
  const selectedBadges = parseRecommendationSelection(input.selectedBadges);
  const month = new Date(input.now).getUTCMonth() + 1;
  const goldenCandidates = goldenPicks.flatMap((pick) => {
    const place = candidates.find((candidate) => candidate.id === pick.placeId);
    return place ? [{ ...place, reviewerUserId: pick.reviewerUserId, goldenPickAt: pick.effectiveAt }] : [];
  });
  const golden = rankGoldenRelay({ places: goldenCandidates, center: input.center, tasteSignals, limit });
  const goldenIds = new Set(golden.map((place) => place.id));
  const trustedAll = rankTrustedPlaces({ places: candidates, limit: Math.max(limit * 3, limit) });
  const trusted = withFallback(trustedAll.filter((place) => !goldenIds.has(place.id)), trustedAll, limit);
  const reserved = new Set([...goldenIds, ...trusted.map((place) => place.id)]);
  const personalPreferred = rankPersonalDiscovery({
    places: candidates.filter((place) => !reserved.has(place.id)), selectedBadges, tasteSignals, center: input.center, month, limit,
  });
  const personalFallback = rankPersonalDiscovery({ places: candidates, selectedBadges, tasteSignals, center: input.center, month, limit });
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
