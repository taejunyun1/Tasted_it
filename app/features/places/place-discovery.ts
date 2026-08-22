import { calculateRating } from "../ratings/rating-v1";
import type { TasteBadgeSource } from "../members/profile-taste-badges";
import type { PlaceSummary } from "./place.types";
import { seasonForMonth, TASTE_ADJACENCY, termsForBadge } from "./place-recommendation-options";
import {
  canonicalRecommendationMatchKind,
  publicDiscoveryMatchKind,
  type LegacyRecommendationMatchKind,
  type PublicDiscoveryMatchKind,
  type RecommendationMatchKind,
} from "./recommendation-action-values";

export interface DiscoveryCenter {
  latitude: number;
  longitude: number;
}

export interface GoldenPickSummary {
  placeId: string;
  effectiveAt: string;
}

export interface DiscoveryPlace extends PlaceSummary {
  distanceMeters?: number;
  goldenPickAt?: string;
  reviewerUserId?: string;
  ratingScore?: number | null;
  ratingSampleCount?: number;
  userScore?: number | null;
  reviewerScore?: number | null;
  userRatingScore?: number | null;
  userRatingSampleCount?: number;
  reviewerRatingScore?: number | null;
  reviewerRatingSampleCount?: number;
  discoveryMode?: PublicDiscoveryMatchKind;
  recommendationReasons?: string[];
}

export interface DiscoverySections {
  nearby: DiscoveryPlace[];
  service: DiscoveryPlace[];
  golden: DiscoveryPlace[];
}

export type RankingTasteSignal = {
  badgeId: string;
  score: number;
  source: TasteBadgeSource;
};

const TASTE_SOURCE_STRENGTH: Record<TasteBadgeSource, number> = {
  USER: 1,
  NAVER: 0.9,
  GOOGLE: 0.9,
  INFERRED: 0.75,
};

export const GUEST_TASTE_SIGNAL_SCORE = 1;

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function normalizedTasteSignalStrength(signal: RankingTasteSignal) {
  return clampUnit(signal.score) * TASTE_SOURCE_STRENGTH[signal.source];
}

export function personalizationBoostForDiscovery(input: {
  mode: LegacyRecommendationMatchKind;
  tasteStrength: number;
  directionBoost: number;
}) {
  const tasteStrength = clampUnit(input.tasteStrength);
  const mode = canonicalRecommendationMatchKind(input.mode);
  const modeBoost = mode === "DIRECT"
    ? 0.35 * tasteStrength
    : mode === "ADJACENT" ? 0.22 * tasteStrength : 0.08;
  const directionBoost = Math.max(0, Number.isFinite(input.directionBoost) ? input.directionBoost : 0);
  return Math.min(0.35, modeBoost + directionBoost);
}

function directTasteSignals(badgeIds: string[]): RankingTasteSignal[] {
  return badgeIds.map((badgeId) => ({
    badgeId,
    score: GUEST_TASTE_SIGNAL_SCORE,
    source: "USER",
  }));
}

function effectiveTasteSignals(input: {
  selectedBadges: string[];
  tasteSignals?: RankingTasteSignal[];
  userBadgeIds?: string[];
}) {
  const signals = [
    ...input.selectedBadges.map((badgeId) => ({ badgeId, score: 1, source: "USER" as const })),
    ...(input.tasteSignals ?? []),
    ...directTasteSignals(input.userBadgeIds ?? []),
  ].filter((signal) => normalizedTasteSignalStrength(signal) > 0);
  return signals.sort((left, right) => (
    normalizedTasteSignalStrength(right) - normalizedTasteSignalStrength(left)
    || left.badgeId.localeCompare(right.badgeId)
  ));
}

const EARTH_RADIUS_METERS = 6_371_000;

function radians(value: number) {
  return value * (Math.PI / 180);
}

export function distanceInMeters(left: DiscoveryCenter, right: DiscoveryCenter) {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1_000) return `${Math.max(10, Math.round(distanceMeters / 10) * 10)}m`;
  return `${(distanceMeters / 1_000).toFixed(distanceMeters < 10_000 ? 1 : 0)}km`;
}

export function formatRatingSummary(place: Pick<PlaceSummary, "positive" | "negative">) {
  const sampleCount = place.positive + place.negative;
  const rating = calculateRating(place);
  return rating.sampleStatus === "VISIBLE"
    ? `추천 ${rating.displayScore}% · ${sampleCount}명 평가`
    : `평가 ${sampleCount}/8`;
}

export const PUBLIC_RATING_FALLBACK_COPY = "표본 수집 중";

export function formatPublicRatingSummary(place: Pick<PlaceSummary, "ratingScore" | "ratingSampleCount">) {
  if (place.ratingScore != null) {
    return `추천 ${place.ratingScore}% · ${place.ratingSampleCount ?? 0}명 평가`;
  }
  if (place.ratingSampleCount != null && place.ratingSampleCount > 0) {
    return `${PUBLIC_RATING_FALLBACK_COPY} · ${place.ratingSampleCount}/8`;
  }
  return PUBLIC_RATING_FALLBACK_COPY;
}

export function buildDiscoverySections(
  places: PlaceSummary[],
  goldenPicks: GoldenPickSummary[],
  center: DiscoveryCenter,
  limit = 8,
): DiscoverySections {
  const used = new Set<string>();
  const takeUnused = (candidates: DiscoveryPlace[]) => {
    const selected = candidates.filter((place) => !used.has(place.id)).slice(0, limit);
    selected.forEach((place) => used.add(place.id));
    return selected;
  };

  const nearby = takeUnused(places
    .map((place) => ({ ...place, distanceMeters: distanceInMeters(center, place) }))
    .sort((left, right) => left.distanceMeters - right.distanceMeters || left.name.localeCompare(right.name, "ko")));

  const service = takeUnused(places
    .filter((place) => place.positive + place.negative >= 8)
    .sort((left, right) => {
      const leftScore = calculateRating(left).displayScore;
      const rightScore = calculateRating(right).displayScore;
      return rightScore - leftScore
        || (right.positive + right.negative) - (left.positive + left.negative)
        || left.name.localeCompare(right.name, "ko");
    }));

  const byPlace = new Map(places.map((place) => [place.id, place]));
  const golden = takeUnused([...goldenPicks]
    .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))
    .flatMap((pick) => {
      const place = byPlace.get(pick.placeId);
      return place ? [{ ...place, goldenPickAt: pick.effectiveAt }] : [];
    }));

  return { nearby, service, golden };
}

function normalizedPlaceText(place: PlaceSummary) {
  return `${place.name} ${place.primaryCategory.slug} ${place.primaryCategory.name} ${place.searchText ?? ""}`.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function matchesTerms(place: PlaceSummary, terms: string[]) {
  const haystack = normalizedPlaceText(place);
  return terms.some((term) => haystack.includes(term.toLocaleLowerCase("ko-KR").replace(/\s+/g, "")));
}

function qualityScore(place: DiscoveryPlace) {
  if (place.ratingScore != null) return place.ratingScore / 100;
  const rating = calculateRating(place);
  return rating.sampleStatus === "VISIBLE" ? rating.displayScore / 100 : Math.min(0.55, (place.positive + place.negative) / 16);
}

function distanceScore(center: DiscoveryCenter, place: DiscoveryPlace) {
  return Math.max(0, 1 - distanceInMeters(center, place) / 20_000);
}

function takeDiverse(output: DiscoveryPlace[], candidates: DiscoveryPlace[], limit: number) {
  const categories = new Map<string, number>();
  const neighborhoods = new Map<string, number>();
  output.forEach((item) => {
    categories.set(item.primaryCategory.slug, (categories.get(item.primaryCategory.slug) ?? 0) + 1);
    neighborhoods.set(item.neighborhood, (neighborhoods.get(item.neighborhood) ?? 0) + 1);
  });
  for (const candidate of candidates) {
    if (output.length >= limit) break;
    if (output.some((item) => item.id === candidate.id)) continue;
    if ((categories.get(candidate.primaryCategory.slug) ?? 0) >= 3) continue;
    if ((neighborhoods.get(candidate.neighborhood) ?? 0) >= 2) continue;
    output.push(candidate);
    categories.set(candidate.primaryCategory.slug, (categories.get(candidate.primaryCategory.slug) ?? 0) + 1);
    neighborhoods.set(candidate.neighborhood, (neighborhoods.get(candidate.neighborhood) ?? 0) + 1);
  }
}

export function mergePersonalDiscoveryRankings(input: {
  preferred: DiscoveryPlace[];
  fallback: DiscoveryPlace[];
  limit: number;
}) {
  const candidates = [...new Map(
    [...input.preferred, ...input.fallback].map((place) => [place.id, place]),
  ).values()];
  const output: DiscoveryPlace[] = [];
  takeDiverse(
    output,
    candidates.filter((place) => place.discoveryMode === "EXPLORATION"),
    Math.min(input.limit, 2),
  );
  takeDiverse(output, candidates, input.limit);
  return output;
}

export function rankPersonalDiscovery(input: {
  places: DiscoveryPlace[];
  selectedBadges: string[];
  tasteSignals?: RankingTasteSignal[];
  userBadgeIds?: string[];
  center: DiscoveryCenter;
  month: number;
  limit?: number;
}) {
  const limit = input.limit ?? 8;
  const tasteSignals = effectiveTasteSignals(input);
  const seasonalTerms = termsForBadge(`season-${seasonForMonth(input.month).toLocaleLowerCase()}`);
  const wantsDiscovery = input.selectedBadges.includes("discovery-new-taste");
  const wantsNeighborhood = input.selectedBadges.includes("discovery-neighborhood");
  const wantsTrusted = input.selectedBadges.includes("general-trusted");
  const scored = input.places.map((place) => {
    const matchedTasteSignal = tasteSignals.find((signal) => matchesTerms(place, termsForBadge(signal.badgeId)));
    const adjacentTasteSignal = matchedTasteSignal ? undefined : tasteSignals.find((signal) => (
      matchesTerms(place, TASTE_ADJACENCY[signal.badgeId] ?? [])
    ));
    const matchKind: RecommendationMatchKind = matchedTasteSignal
      ? "DIRECT" : adjacentTasteSignal ? "ADJACENT" : "EXPLORATION";
    const tasteStrength = normalizedTasteSignalStrength(matchedTasteSignal ?? adjacentTasteSignal ?? {
      badgeId: "",
      score: 0,
      source: "INFERRED",
    });
    const quality = qualityScore(place);
    const distance = distanceScore(input.center, place);
    const seasonalMatch = matchesTerms(place, seasonalTerms);
    const seasonalBoost = seasonalMatch && quality >= 0.55 ? Math.min(0.15, 0.08 + quality * 0.07) : 0;
    const directionBoost = (wantsDiscovery && matchKind === "EXPLORATION" ? 0.12 : 0)
      + (wantsNeighborhood ? distance * 0.12 : 0)
      + (wantsTrusted ? quality * 0.12 : 0);
    const personalizationBoost = personalizationBoostForDiscovery({
      mode: matchKind,
      tasteStrength,
      directionBoost,
    });
    const score = quality * 0.45 + distance * 0.2 + personalizationBoost + seasonalBoost;
    const recommendationReasons = [
      matchKind === "DIRECT"
        ? `${termsForBadge(matchedTasteSignal!.badgeId)[0] ?? "선택한"} 취향과 가까움`
        : matchKind === "ADJACENT" ? "평소 취향에서 한 발짝" : "오늘의 새로운 메뉴",
      ...(seasonalBoost > 0 ? ["지금 먹기 좋은 메뉴"] : []),
    ].slice(0, 2);
    return {
      ...place,
      distanceMeters: distanceInMeters(input.center, place),
      discoveryMode: publicDiscoveryMatchKind(matchKind),
      recommendationReasons,
      _score: score,
    };
  }).sort((left, right) => right._score - left._score || left.name.localeCompare(right.name, "ko"));
  const exploration = scored.filter((item) => item.discoveryMode === "EXPLORATION");
  const output: typeof scored = [];
  takeDiverse(output, exploration, Math.min(limit, 2));
  takeDiverse(output, scored, limit);
  return output.map(({ _score: _, ...place }) => place);
}

export function rankTrustedPlaces(input: { places: DiscoveryPlace[]; limit?: number }) {
  return input.places.map((place) => {
    const sample = place.ratingSampleCount ?? place.positive + place.negative;
    const score = place.ratingScore ?? calculateRating(place).displayScore;
    const sampleConfidence = Math.min(1, Math.log1p(sample) / Math.log1p(50));
    const agreement = place.userScore != null && place.reviewerScore != null
      ? 1 - Math.abs(place.userScore - place.reviewerScore) / 100 : 0.5;
    return { ...place, recommendationReasons: [sample >= 8 ? "평가 신뢰도 상위" : "평가가 쌓이는 중"], _score: score / 100 * 0.6 + sampleConfidence * 0.3 + agreement * 0.1 };
  }).sort((left, right) => right._score - left._score || left.name.localeCompare(right.name, "ko"))
    .slice(0, input.limit ?? 8)
    .map(({ _score: _, ...place }) => place);
}

export function rankGoldenRelay(input: {
  places: DiscoveryPlace[];
  center: DiscoveryCenter;
  tasteSignals?: RankingTasteSignal[];
  userBadgeIds?: string[];
  limit?: number;
}) {
  const remaining = input.places.map((place) => ({ ...place }));
  const output: DiscoveryPlace[] = [];
  const directTerms = effectiveTasteSignals({
    selectedBadges: [],
    tasteSignals: input.tasteSignals,
    userBadgeIds: input.userBadgeIds,
  }).slice(0, 3).flatMap((signal) => termsForBadge(signal.badgeId));
  while (remaining.length && output.length < (input.limit ?? 8)) {
    const previous = output.at(-1);
    remaining.sort((left, right) => {
      const score = (place: DiscoveryPlace) => {
        const taste = matchesTerms(place, directTerms) ? 0.25 : 0;
        const distance = distanceScore(input.center, place) * (previous ? 0.1 : 0.35);
        const reviewer = previous && previous.reviewerUserId !== place.reviewerUserId ? 0.3 : 0;
        const category = previous && previous.primaryCategory.slug !== place.primaryCategory.slug ? 0.35 : 0;
        return taste + distance + reviewer + category;
      };
      return score(right) - score(left) || (right.goldenPickAt ?? "").localeCompare(left.goldenPickAt ?? "");
    });
    const next = remaining.shift()!;
    output.push({ ...next, recommendationReasons: ["리뷰어 Golden Pick", output.length ? "취향 릴레이" : "리뷰어의 선택"] });
  }
  return output;
}
