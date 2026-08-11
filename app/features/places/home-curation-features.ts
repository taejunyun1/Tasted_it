import type { HomeCurationMode, HomeTimeSlot } from "../maps/home-curation-options";
import { calculateRating } from "../ratings/rating-v1";
import {
  distanceInMeters,
  normalizedTasteSignalStrength,
  type DiscoveryCenter,
  type DiscoveryPlace,
  type RankingTasteSignal,
} from "./place-discovery";
import type { HomeRecommendationHistory } from "./home-curation-history.client";
import { TASTE_ADJACENCY, termsForBadge } from "./place-recommendation-options";

export type TasteMatch = {
  badgeId: string;
  strength: number;
  match: "DIRECT" | "ADJACENT";
};

export type TimeCompatibility = "STRONG" | "WEAK" | "UNKNOWN" | "MISMATCH";

export type HomeCandidateFeatures = {
  distanceMeters: number;
  distance: number;
  confidence: number;
  taste: number;
  time: number;
  discovery: number;
  freshness: number;
  firstRankPenalty: number;
  variation: number;
  tasteMatches: TasteMatch[];
  timeCompatibility: TimeCompatibility;
};

type TimeProfile = {
  strong: string[];
  mismatch: string[];
};

const TIME_PROFILES: Record<HomeTimeSlot, TimeProfile> = {
  breakfast: {
    strong: ["백반", "국밥", "해장국", "베이커리", "빵", "커피"],
    mismatch: ["야식", "심야", "술안주", "포장마차"],
  },
  lunch: {
    strong: ["백반", "국밥", "면", "분식", "돈가스", "덮밥", "한식"],
    mismatch: ["야식", "심야", "포장마차"],
  },
  afternoon: {
    strong: ["카페", "커피", "디저트", "베이커리", "빙수"],
    mismatch: ["야식", "심야", "해장국", "술안주"],
  },
  dinner: {
    strong: ["고기", "해산물", "전골", "구이", "주점", "술안주"],
    mismatch: ["조식", "아침", "브런치", "야식", "심야"],
  },
  late: {
    strong: ["야식", "국물", "주점", "분식", "해장", "포장마차"],
    mismatch: ["조식", "아침", "브런치"],
  },
};

function normalizedText(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function placeText(place: DiscoveryPlace) {
  return normalizedText(`${place.name} ${place.primaryCategory.slug} ${place.primaryCategory.name} ${place.searchText ?? ""}`);
}

function specificPlaceText(place: DiscoveryPlace) {
  return normalizedText(`${place.name} ${place.searchText ?? ""}`);
}

function categoryText(place: DiscoveryPlace) {
  return normalizedText(`${place.primaryCategory.slug} ${place.primaryCategory.name}`);
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(normalizedText(term)));
}

function sampleCount(place: DiscoveryPlace) {
  return place.ratingSampleCount ?? place.positive + place.negative;
}

function ratingScore(place: DiscoveryPlace) {
  return place.ratingScore ?? calculateRating(place).displayScore;
}

function strongestTasteStrength(matches: TasteMatch[], match: TasteMatch["match"]) {
  const strongest = new Map<string, number>();
  for (const item of matches) {
    if (item.match !== match) continue;
    strongest.set(item.badgeId, Math.max(strongest.get(item.badgeId) ?? 0, item.strength));
  }
  return [...strongest.values()].reduce((sum, strength) => sum + strength, 0);
}

function tasteMatchesFor(place: DiscoveryPlace, tasteSignals: RankingTasteSignal[]) {
  const text = placeText(place);
  const matches: TasteMatch[] = [];
  for (const signal of tasteSignals) {
    const strength = normalizedTasteSignalStrength(signal);
    if (strength <= 0) continue;
    if (includesAny(text, termsForBadge(signal.badgeId))) {
      matches.push({ badgeId: signal.badgeId, strength, match: "DIRECT" });
      continue;
    }
    if (includesAny(text, TASTE_ADJACENCY[signal.badgeId] ?? [])) {
      matches.push({ badgeId: signal.badgeId, strength, match: "ADJACENT" });
    }
  }
  return matches;
}

function timeCompatibilityFor(place: DiscoveryPlace, timeSlot: HomeTimeSlot): TimeCompatibility {
  const profile = TIME_PROFILES[timeSlot];
  const specificText = specificPlaceText(place);
  if (includesAny(specificText, profile.strong)) return "STRONG";
  if (includesAny(specificText, profile.mismatch)) return "MISMATCH";
  if (includesAny(categoryText(place), profile.strong)) return "WEAK";
  return "UNKNOWN";
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function quantizedCenter(center: DiscoveryCenter) {
  const latitudeCellDegrees = 500 / 111_320;
  const longitudeCellDegrees = 500 / (111_320 * Math.cos(center.latitude * Math.PI / 180));
  return `${Math.round(center.latitude / latitudeCellDegrees)},${Math.round(center.longitude / longitudeCellDegrees)}`;
}

export function distanceBandScore(meters: number) {
  if (meters <= 500) return 1;
  if (meters <= 1_000) return .95;
  if (meters <= 2_000) return .85;
  if (meters <= 3_000) return .72;
  if (meters <= 5_000) return .55;
  if (meters <= 8_000) return .35;
  return .15;
}

export function confidenceScore(score: number | null, samples: number) {
  if (samples <= 0 || score == null) return .35;
  const sampleConfidence = Math.min(1, Math.log1p(samples) / Math.log(31));
  return score / 100 * (.45 + .55 * sampleConfidence);
}

export function aggregateTasteScore(matches: TasteMatch[]) {
  const strongest = new Map<string, number>();
  for (const match of matches) {
    const weighted = match.strength * (match.match === "DIRECT" ? 1 : .6);
    strongest.set(match.badgeId, Math.max(strongest.get(match.badgeId) ?? 0, weighted));
  }
  return Math.min(1, 1 - Math.exp(-[...strongest.values()].reduce((sum, value) => sum + value, 0)));
}

export function timeCompatibilityScore(compatibility: TimeCompatibility) {
  return {
    STRONG: 1,
    WEAK: .7,
    UNKNOWN: .5,
    MISMATCH: .2,
  }[compatibility];
}

export function discoveryScore(input: {
  directTaste: number;
  adjacentTaste: number;
  explicitNew: boolean;
}) {
  if (input.explicitNew && input.directTaste <= 0 && input.adjacentTaste <= 0) return 1;
  if (input.directTaste >= .75) return .2;
  if (input.directTaste > 0) return .35;
  if (input.adjacentTaste > 0) return .65;
  return .8;
}

export function freshnessScore(count: number) {
  if (count <= 0) return 1;
  if (count === 1) return .8;
  if (count === 2) return .55;
  return .3;
}

export function firstRankPenalty(placeId: string, recentFirst: string[]) {
  const occurrences = recentFirst.filter((id) => id === placeId).length;
  if (occurrences >= 3) return -.30;
  if (occurrences >= 2) return -.18;
  if (occurrences === 1) return -.12;
  return 0;
}

export function deterministicVariation(input: {
  sessionSeed: string;
  dateKey: string;
  mode: HomeCurationMode;
  center: DiscoveryCenter;
  placeId: string;
}) {
  const hash = fnv1a(`${input.sessionSeed}|${input.dateKey}|${input.mode}|${quantizedCenter(input.center)}|${input.placeId}`);
  return hash / 0xffff_ffff * .05;
}

export function buildHomeCandidateFeatures(input: {
  place: DiscoveryPlace;
  center: DiscoveryCenter;
  tasteSignals: RankingTasteSignal[];
  timeSlot: HomeTimeSlot;
  history: HomeRecommendationHistory;
  dateKey: string;
  mode: HomeCurationMode;
  recentCategorySlugs?: readonly string[];
}): HomeCandidateFeatures {
  const distanceMeters = distanceInMeters(input.center, input.place);
  const tasteMatches = tasteMatchesFor(input.place, input.tasteSignals);
  const directTaste = strongestTasteStrength(tasteMatches, "DIRECT");
  const adjacentTaste = strongestTasteStrength(tasteMatches, "ADJACENT");
  const timeCompatibility = timeCompatibilityFor(input.place, input.timeSlot);
  const shownCount = input.history.recentShown.find((item) => item.placeId === input.place.id)?.count ?? 0;
  const explicitNew = directTaste === 0
    && adjacentTaste === 0
    && input.recentCategorySlugs?.includes(input.place.primaryCategory.slug) === false;

  return {
    distanceMeters,
    distance: distanceBandScore(distanceMeters),
    confidence: confidenceScore(ratingScore(input.place), sampleCount(input.place)),
    taste: aggregateTasteScore(tasteMatches),
    time: timeCompatibilityScore(timeCompatibility),
    discovery: discoveryScore({ directTaste, adjacentTaste, explicitNew }),
    freshness: freshnessScore(shownCount),
    firstRankPenalty: firstRankPenalty(input.place.id, input.history.recentFirst),
    variation: deterministicVariation({
      sessionSeed: input.history.sessionSeed,
      dateKey: input.dateKey,
      mode: input.mode,
      center: input.center,
      placeId: input.place.id,
    }),
    tasteMatches,
    timeCompatibility,
  };
}
