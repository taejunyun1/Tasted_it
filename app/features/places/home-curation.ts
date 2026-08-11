import type {
  HomeCurationMode,
  HomeTimeSlot,
} from "../maps/home-curation-options";
import { calculateRating } from "../ratings/rating-v1";
import {
  distanceInMeters,
  normalizedTasteSignalStrength,
  type DiscoveryCenter,
  type DiscoveryPlace,
  type RankingTasteSignal,
} from "./place-discovery";
import { TASTE_ADJACENCY, termsForBadge } from "./place-recommendation-options";

export type HomeCurationSlot = "BEST_NOW" | "TASTE_MATCH" | "TIME_MATCH" | "TRUSTED_PICK" | "DISCOVERY";

export type HomeCuratedPlace = DiscoveryPlace & {
  slot: HomeCurationSlot;
  rank: number;
  recommendationReasons: string[];
  isGoldenPick: boolean;
};

export type HomeCurationInput = {
  places: DiscoveryPlace[];
  goldenPicks: Array<{ placeId: string }>;
  center: DiscoveryCenter;
  tasteSignals: RankingTasteSignal[];
  mode: HomeCurationMode;
  timeSlot: HomeTimeSlot;
  radiusMeters: 3_000 | 5_000;
};

export type HomeCurationPage = {
  status: "READY" | "EMPTY";
  places: HomeCuratedPlace[];
  mode: HomeCurationMode;
  timeSlot: HomeTimeSlot;
  radiusMeters: 3_000 | 5_000;
};

type ScoredHomeCandidate = {
  place: DiscoveryPlace;
  directTaste: number;
  adjacentTaste: number;
  time: number;
  trust: number;
  distance: number;
  discovery: number;
  total: number;
  isGoldenPick: boolean;
};

type HomeWeights = {
  taste: number;
  distance: number;
  time: number;
  trust: number;
  discovery: number;
};

const MODE_WEIGHTS: Record<HomeCurationMode, HomeWeights> = {
  now: { taste: 0.30, distance: 0.25, time: 0.20, trust: 0.15, discovery: 0.10 },
  taste: { taste: 0.35, distance: 0.20, time: 0.10, trust: 0.20, discovery: 0.15 },
  time: { taste: 0.20, distance: 0.25, time: 0.30, trust: 0.15, discovery: 0.10 },
  golden: { taste: 0.20, distance: 0.20, time: 0.10, trust: 0.40, discovery: 0.10 },
  discovery: { taste: 0.15, distance: 0.20, time: 0.10, trust: 0.20, discovery: 0.35 },
};

const MODE_SLOTS: Record<HomeCurationMode, HomeCurationSlot[]> = {
  now: ["BEST_NOW", "TASTE_MATCH", "TIME_MATCH", "TRUSTED_PICK", "DISCOVERY"],
  taste: ["TASTE_MATCH", "TASTE_MATCH", "TIME_MATCH", "TRUSTED_PICK", "DISCOVERY"],
  time: ["TIME_MATCH", "TIME_MATCH", "BEST_NOW", "TRUSTED_PICK", "DISCOVERY"],
  golden: ["TRUSTED_PICK", "TRUSTED_PICK", "TRUSTED_PICK", "TRUSTED_PICK", "TRUSTED_PICK"],
  discovery: ["DISCOVERY", "DISCOVERY", "DISCOVERY", "DISCOVERY", "TRUSTED_PICK"],
};

const TIME_TERMS: Record<HomeTimeSlot, string[]> = {
  breakfast: ["백반", "국밥", "해장국", "베이커리", "빵", "커피"],
  lunch: ["백반", "국밥", "면", "분식", "돈가스", "덮밥", "한식"],
  afternoon: ["카페", "커피", "디저트", "베이커리", "빙수"],
  dinner: ["고기", "해산물", "전골", "구이", "주점", "술안주"],
  late: ["야식", "국물", "주점", "분식", "해장", "포장마차"],
};

function sampleCount(place: DiscoveryPlace) {
  return place.ratingSampleCount ?? place.positive + place.negative;
}

function passesHomeQuality(place: DiscoveryPlace) {
  const samples = sampleCount(place);
  const visibleScore = place.ratingScore ?? (samples >= 8 ? calculateRating(place).displayScore : null);
  return visibleScore == null || visibleScore >= 55;
}

function trustedEligible(place: DiscoveryPlace) {
  return sampleCount(place) >= 8;
}

function normalizedText(place: DiscoveryPlace) {
  return `${place.name} ${place.primaryCategory.slug} ${place.primaryCategory.name} ${place.searchText ?? ""}`
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "");
}

function includesAny(place: DiscoveryPlace, terms: string[]) {
  const text = normalizedText(place);
  return terms.some((term) => text.includes(term.toLocaleLowerCase("ko-KR").replace(/\s+/g, "")));
}

function scoreHomeCandidates(
  places: DiscoveryPlace[],
  input: HomeCurationInput,
  weights: HomeWeights,
): ScoredHomeCandidate[] {
  const goldenIds = new Set(input.goldenPicks.map((pick) => pick.placeId));

  return places.map((place) => {
    const directSignal = input.tasteSignals.find((signal) => includesAny(place, termsForBadge(signal.badgeId)));
    const adjacentSignal = directSignal
      ? undefined
      : input.tasteSignals.find((signal) => includesAny(place, TASTE_ADJACENCY[signal.badgeId] ?? []));
    const directTaste = directSignal ? normalizedTasteSignalStrength(directSignal) : 0;
    const adjacentTaste = adjacentSignal ? normalizedTasteSignalStrength(adjacentSignal) * 0.7 : 0;
    const taste = Math.min(1, directTaste + adjacentTaste);
    const distanceMeters = distanceInMeters(input.center, place);
    const distance = Math.max(0, 1 - distanceMeters / input.radiusMeters);
    const time = includesAny(place, TIME_TERMS[input.timeSlot]) ? 1 : 0.25;
    const samples = sampleCount(place);
    const score = place.ratingScore ?? calculateRating(place).displayScore;
    const trust = samples >= 8
      ? Math.min(1, score / 100 * 0.7 + Math.min(1, samples / 50) * 0.3)
      : 0.2;
    const discovery = directTaste ? 0 : adjacentTaste ? 0.65 : 1;
    const total = Math.min(
      1,
      taste * weights.taste
      + distance * weights.distance
      + time * weights.time
      + trust * weights.trust
      + discovery * weights.discovery,
    );

    return {
      place: { ...place, distanceMeters },
      directTaste,
      adjacentTaste,
      time,
      trust,
      distance,
      discovery,
      total,
      isGoldenPick: goldenIds.has(place.id),
    };
  });
}

function slotScore(candidate: ScoredHomeCandidate, slot: HomeCurationSlot, mode: HomeCurationMode) {
  if (slot === "TASTE_MATCH") return candidate.directTaste + candidate.adjacentTaste * 0.8 + candidate.total * 0.2;
  if (slot === "TIME_MATCH") return candidate.time + candidate.distance * 0.2 + candidate.total * 0.2;
  if (slot === "TRUSTED_PICK") {
    return (mode === "golden" && candidate.isGoldenPick ? 2 : 0) + candidate.trust + candidate.total * 0.2;
  }
  if (slot === "DISCOVERY") return candidate.discovery + candidate.trust * 0.25 + candidate.total * 0.2;
  return candidate.total;
}

function eligibleForSlot(candidate: ScoredHomeCandidate, slot: HomeCurationSlot, mode: HomeCurationMode) {
  if (slot === "TRUSTED_PICK") return candidate.isGoldenPick || trustedEligible(candidate.place);
  if (slot === "TASTE_MATCH") return candidate.directTaste > 0 || candidate.adjacentTaste > 0;
  if (slot === "DISCOVERY") return candidate.directTaste === 0;
  return mode !== "golden" || candidate.isGoldenPick || trustedEligible(candidate.place);
}

function reasonsFor(candidate: ScoredHomeCandidate, slot: HomeCurationSlot) {
  const reasons: string[] = [];

  if (slot === "TRUSTED_PICK" && candidate.isGoldenPick) reasons.push("리뷰어 Golden Pick");
  else if (slot === "TRUSTED_PICK" && trustedEligible(candidate.place)) reasons.push("평가 신뢰도 상위");
  if (slot === "DISCOVERY" && candidate.directTaste === 0) {
    reasons.push(candidate.adjacentTaste ? "평소 취향에서 한 발짝" : "아직 평가하지 않은 메뉴");
  }
  if (slot === "TIME_MATCH" && candidate.time === 1) reasons.push("현재 시간대에 어울림");
  if (slot === "TASTE_MATCH" && candidate.directTaste) reasons.push("나의 취향과 가까움");
  else if (slot === "TASTE_MATCH" && candidate.adjacentTaste) reasons.push("평소 취향과 이어짐");
  if (candidate.distance >= 0.65) reasons.push("현재 위치에서 가까움");
  if (!reasons.length) reasons.push("지금 가기 좋은 균형");

  return reasons.slice(0, 2);
}

function selectSlotsWithDiversity(
  candidates: ScoredHomeCandidate[],
  slots: HomeCurationSlot[],
  mode: HomeCurationMode,
) {
  const selected: Array<{
    place: DiscoveryPlace;
    slot: HomeCurationSlot;
    reasons: string[];
    isGoldenPick: boolean;
  }> = [];
  const categoryCounts = new Map<string, number>();
  const neighborhoodCounts = new Map<string, number>();

  for (const slot of slots) {
    const unused = candidates.filter((candidate) => !selected.some((item) => item.place.id === candidate.place.id));
    const preferred = unused.filter((candidate) => eligibleForSlot(candidate, slot, mode));
    const ranked = (preferred.length ? preferred : unused).sort((left, right) => (
      slotScore(right, slot, mode) - slotScore(left, slot, mode)
      || left.place.name.localeCompare(right.place.name, "ko")
    ));
    const picked = ([[2, 2], [3, 2], [3, 3]] as const)
      .map(([categoryLimit, neighborhoodLimit]) => ranked.find((candidate) => (
        (categoryCounts.get(candidate.place.primaryCategory.slug) ?? 0) < categoryLimit
        && (neighborhoodCounts.get(candidate.place.neighborhood) ?? 0) < neighborhoodLimit
      )))
      .find((candidate) => candidate !== undefined);

    if (!picked) continue;
    selected.push({
      place: picked.place,
      slot,
      reasons: reasonsFor(picked, slot),
      isGoldenPick: picked.isGoldenPick,
    });
    categoryCounts.set(
      picked.place.primaryCategory.slug,
      (categoryCounts.get(picked.place.primaryCategory.slug) ?? 0) + 1,
    );
    neighborhoodCounts.set(
      picked.place.neighborhood,
      (neighborhoodCounts.get(picked.place.neighborhood) ?? 0) + 1,
    );
  }

  return selected;
}

export function rankHomeCuration(input: HomeCurationInput): HomeCuratedPlace[] {
  const eligible = input.places.filter((place) => (
    passesHomeQuality(place)
    && distanceInMeters(input.center, place) <= input.radiusMeters
  ));
  const scored = scoreHomeCandidates(eligible, input, MODE_WEIGHTS[input.mode]);
  const selected = selectSlotsWithDiversity(scored, MODE_SLOTS[input.mode], input.mode);

  return selected.map((item, index) => ({
    ...item.place,
    slot: item.slot,
    rank: index + 1,
    recommendationReasons: item.reasons,
    isGoldenPick: item.isGoldenPick,
  }));
}
