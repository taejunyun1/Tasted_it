import type { HomeCurationMode } from "../maps/home-curation-options";
import { confidenceScore, type HomeCandidateFeatures } from "./home-curation-features";
import type { HomeLocationSource } from "./home-curation-history.client";
import { distanceInMeters, type DiscoveryPlace } from "./place-discovery";

export type { HomeCandidateFeatures } from "./home-curation-features";

export type HomeRankingCandidate = {
  place: DiscoveryPlace;
  features: HomeCandidateFeatures;
  golden?: 0 | .8 | 1;
  pastGolden?: 0 | .4;
  reviewerConfidence?: number;
  reviewerId?: string | null;
};

type HomeReasonKey = "taste" | "distance" | "time" | "confidence" | "discovery" | "freshness" | "golden" | "reviewer" | "past_golden";

export type HomeRankedCandidate = HomeRankingCandidate & {
  weightedScore: number;
  categoryKey: string;
  detailTypeKey: string;
  primaryReason: HomeReasonKey;
  recommendationReasons: string[];
  reviewerId: string | null;
  isGoldenPick: boolean;
};

type StandardMode = Exclude<HomeCurationMode, "golden">;

const MODE_WEIGHTS = {
  now: { taste: .25, distance: .20, time: .25, confidence: .15, discovery: .10, freshness: .05 },
  taste: { taste: .45, distance: .12, time: .08, confidence: .15, discovery: .12, freshness: .08 },
  time: { taste: .18, distance: .17, time: .40, confidence: .10, discovery: .08, freshness: .07 },
  discovery: { taste: .10, distance: .12, time: .05, confidence: .15, discovery: .40, freshness: .18 },
} as const;

const DISTANCE_REASON: Record<HomeLocationSource, string> = {
  gps: "현재 위치에서 가까워요",
  map_center: "현재 보고 있는 지역에서 가까워요",
};

const GOLDEN_FALLBACK_NOTICE = "현재 주변 Golden Pick이 없어 과거 선정 이력과 평가 기록을 바탕으로 추천합니다.";

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function strongestBadge(features: HomeCandidateFeatures, match: "DIRECT" | "ADJACENT") {
  return features.tasteMatches
    .filter((item) => item.match === match)
    .sort((left, right) => (
      right.strength - left.strength
      || stableHash(left.badgeId) - stableHash(right.badgeId)
      || left.badgeId.localeCompare(right.badgeId)
    ))[0]?.badgeId;
}

function detailTypeKey(candidate: HomeRankingCandidate) {
  return strongestBadge(candidate.features, "DIRECT")
    ?? strongestBadge(candidate.features, "ADJACENT")
    ?? candidate.place.primaryCategory.slug;
}

function coreFeature(candidate: HomeRankedCandidate, mode: StandardMode | "golden") {
  if (mode === "taste") return candidate.features.taste;
  if (mode === "time" || mode === "now") return candidate.features.time;
  if (mode === "discovery") return candidate.features.discovery;
  return candidate.golden ?? 0;
}

function compareRanked(
  left: HomeRankedCandidate,
  right: HomeRankedCandidate,
  leftScore: number,
  rightScore: number,
  mode: StandardMode | "golden",
) {
  return rightScore - leftScore
    || right.features.freshness - left.features.freshness
    || coreFeature(right, mode) - coreFeature(left, mode)
    || right.features.variation - left.features.variation
    || stableHash(left.place.id) - stableHash(right.place.id)
    || left.place.id.localeCompare(right.place.id);
}

function normalContributions(
  candidate: HomeRankingCandidate,
  mode: StandardMode,
  locationSource: HomeLocationSource,
) {
  const weights = MODE_WEIGHTS[mode];
  const contributions: Array<{ key: HomeReasonKey; score: number; text: string }> = [];
  const hasTasteEvidence = candidate.features.taste > 0 && candidate.features.tasteMatches.length > 0;
  if (hasTasteEvidence) {
    contributions.push({ key: "taste", score: candidate.features.taste * weights.taste, text: "평소 좋아하는 취향과 잘 맞아요" });
  }
  if (candidate.features.distanceMeters <= 8_000) {
    contributions.push({ key: "distance", score: candidate.features.distance * weights.distance, text: DISTANCE_REASON[locationSource] });
  }
  if (candidate.features.timeCompatibility === "STRONG" || candidate.features.timeCompatibility === "WEAK") {
    contributions.push({ key: "time", score: candidate.features.time * weights.time, text: "현재 시간대에 잘 맞아요" });
  }
  const samples = candidate.place.ratingSampleCount ?? candidate.place.positive + candidate.place.negative;
  if (samples >= 8) {
    contributions.push({ key: "confidence", score: candidate.features.confidence * weights.confidence, text: "평가 신뢰도가 높아요" });
  }
  if (!candidate.features.tasteMatches.some((item) => item.match === "DIRECT") && candidate.features.discovery >= .65) {
    contributions.push({ key: "discovery", score: candidate.features.discovery * weights.discovery, text: "자주 고르지 않던 메뉴예요" });
  }
  if (candidate.features.freshness >= .8) {
    contributions.push({ key: "freshness", score: candidate.features.freshness * weights.freshness, text: "최근에 자주 보지 않은 곳이에요" });
  }
  return contributions.sort((left, right) => right.score - left.score || stableHash(left.key) - stableHash(right.key));
}

function prepareNormalCandidate(
  candidate: HomeRankingCandidate,
  mode: StandardMode,
  locationSource: HomeLocationSource,
): HomeRankedCandidate {
  const weights = MODE_WEIGHTS[mode];
  const weightedScore = candidate.features.taste * weights.taste
    + candidate.features.distance * weights.distance
    + candidate.features.time * weights.time
    + candidate.features.confidence * weights.confidence
    + candidate.features.discovery * weights.discovery
    + candidate.features.freshness * weights.freshness;
  const contributions = normalContributions(candidate, mode, locationSource);
  const primaryReason = contributions[0]?.key ?? "freshness";

  return {
    ...candidate,
    weightedScore,
    categoryKey: candidate.place.primaryCategory.slug,
    detailTypeKey: detailTypeKey(candidate),
    primaryReason,
    recommendationReasons: contributions.slice(0, 2).map((item) => item.text),
    reviewerId: candidate.reviewerId ?? null,
    isGoldenPick: false,
  };
}

function mmrAdjustment(candidate: HomeRankedCandidate, selected: HomeRankedCandidate[]) {
  let adjustment = candidate.features.freshness * .05;
  if (selected.some((item) => item.categoryKey === candidate.categoryKey)) adjustment -= .12;
  if (selected.some((item) => item.detailTypeKey === candidate.detailTypeKey)) adjustment -= .10;
  if (selected.some((item) => distanceInMeters(item.place, candidate.place) <= 500)) adjustment -= .08;
  if (selected.some((item) => item.primaryReason === candidate.primaryReason)) adjustment -= .08;
  if (candidate.reviewerId && selected.some((item) => item.reviewerId === candidate.reviewerId)) adjustment -= .08;
  return adjustment;
}

function selectByMmr(input: {
  candidates: HomeRankedCandidate[];
  mode: StandardMode | "golden";
  limit: number;
  selected?: HomeRankedCandidate[];
  previousIds?: Set<string>;
  enforcePreviousMaximum?: number;
}) {
  const selected = [...(input.selected ?? [])];
  const selectedFromPool: HomeRankedCandidate[] = [];
  const alreadySelected = new Set(selected.map((item) => item.place.id));
  const previousIds = input.previousIds ?? new Set<string>();

  while (selectedFromPool.length < input.limit) {
    let unused = input.candidates.filter((candidate) => !alreadySelected.has(candidate.place.id));
    if (!unused.length) break;

    const previousCount = selected.filter((item) => previousIds.has(item.place.id)).length;
    if (input.enforcePreviousMaximum !== undefined && previousCount >= input.enforcePreviousMaximum) {
      const fresh = unused.filter((candidate) => !previousIds.has(candidate.place.id));
      if (fresh.length) unused = fresh;
    }

    const isFirst = selected.length === 0;
    unused.sort((left, right) => {
      const score = (candidate: HomeRankedCandidate) => {
        if (isFirst) {
          return candidate.weightedScore + candidate.features.firstRankPenalty + candidate.features.variation;
        }
        const modeChangePenalty = previousIds.has(candidate.place.id) ? -.12 : 0;
        return candidate.weightedScore + mmrAdjustment(candidate, selected) + modeChangePenalty;
      };
      return compareRanked(left, right, score(left), score(right), input.mode);
    });

    const picked = unused[0];
    selected.push(picked);
    selectedFromPool.push(picked);
    alreadySelected.add(picked.place.id);
  }

  return { selected, selectedFromPool };
}

export function rankHomeCandidates(input: {
  candidates: HomeRankingCandidate[];
  mode: StandardMode;
  previousMode?: HomeCurationMode | null;
  previousIds?: readonly string[];
  locationSource: HomeLocationSource;
  limit?: number;
}) {
  const limit = input.limit ?? 5;
  const prepared = input.candidates.map((candidate) => prepareNormalCandidate(candidate, input.mode, input.locationSource));
  const initial = selectByMmr({ candidates: prepared, mode: input.mode, limit }).selectedFromPool;
  const previousIds = new Set(input.previousIds ?? []);
  const overlap = initial.filter((candidate) => previousIds.has(candidate.place.id)).length;
  const changedMode = input.previousMode != null && input.previousMode !== input.mode;

  if (!changedMode || prepared.length < 8 || overlap < 4 || limit < 2) return initial;

  const first = initial[0];
  return selectByMmr({
    candidates: prepared,
    mode: input.mode,
    limit: limit - 1,
    selected: [first],
    previousIds,
    enforcePreviousMaximum: 3,
  }).selected;
}

function goldenContributions(
  candidate: HomeRankingCandidate,
  fallback: boolean,
  locationSource: HomeLocationSource,
) {
  const contributions: Array<{ key: HomeReasonKey; score: number; text: string }> = [];
  if (!fallback && (candidate.golden ?? 0) > 0) {
    contributions.push({ key: "golden", score: (candidate.golden ?? 0) * .55, text: "주변 Golden Pick이에요" });
  }
  if (fallback && (candidate.pastGolden ?? 0) > 0) {
    contributions.push({ key: "past_golden", score: (candidate.pastGolden ?? 0) * .35, text: "과거 Golden Pick 기록이 있어요" });
  }
  if (fallback && (candidate.reviewerConfidence ?? 0) > 0) {
    contributions.push({ key: "reviewer", score: (candidate.reviewerConfidence ?? 0) * .35, text: "최근 리뷰어 평가 기록이 있어요" });
  }
  const samples = candidate.place.ratingSampleCount ?? candidate.place.positive + candidate.place.negative;
  if (samples >= 8 && candidate.features.confidence > 0) {
    contributions.push({ key: "confidence", score: candidate.features.confidence * (fallback ? .20 : .18), text: "평가 신뢰도가 높아요" });
  }
  if (!fallback && candidate.features.taste > 0 && candidate.features.tasteMatches.length > 0) {
    contributions.push({ key: "taste", score: candidate.features.taste * .10, text: "평소 좋아하는 취향과 잘 맞아요" });
  }
  if (!fallback && candidate.features.distance > 0 && candidate.features.distanceMeters <= 8_000) {
    contributions.push({ key: "distance", score: candidate.features.distance * .07, text: DISTANCE_REASON[locationSource] });
  }
  if (!fallback && (candidate.features.timeCompatibility === "STRONG" || candidate.features.timeCompatibility === "WEAK")) {
    contributions.push({ key: "time", score: candidate.features.time * .03, text: "현재 시간대에 잘 맞아요" });
  }
  if (candidate.features.freshness >= .8) {
    contributions.push({ key: "freshness", score: candidate.features.freshness * (fallback ? .10 : .07), text: "최근에 자주 보지 않은 곳이에요" });
  }
  return contributions.sort((left, right) => right.score - left.score || stableHash(left.key) - stableHash(right.key));
}

function prepareGoldenCandidate(
  candidate: HomeRankingCandidate,
  fallback: boolean,
  locationSource: HomeLocationSource,
): HomeRankedCandidate {
  const weightedScore = fallback
    ? (candidate.pastGolden ?? 0) * .35
      + (candidate.reviewerConfidence ?? 0) * .35
      + candidate.features.confidence * .20
      + candidate.features.freshness * .10
    : (candidate.golden ?? 0) * .55
      + candidate.features.confidence * .18
      + candidate.features.taste * .10
      + candidate.features.distance * .07
      + candidate.features.time * .03
      + candidate.features.freshness * .07;
  const contributions = goldenContributions(candidate, fallback, locationSource);
  return {
    ...candidate,
    weightedScore,
    categoryKey: candidate.place.primaryCategory.slug,
    detailTypeKey: detailTypeKey(candidate),
    primaryReason: contributions[0]?.key ?? "confidence",
    recommendationReasons: contributions.slice(0, 2).map((item) => item.text),
    reviewerId: candidate.reviewerId ?? null,
    isGoldenPick: !fallback && (candidate.golden ?? 0) > 0,
  };
}

function hasFallbackEvidence(candidate: HomeRankingCandidate) {
  const samples = candidate.place.ratingSampleCount ?? candidate.place.positive + candidate.place.negative;
  return (candidate.pastGolden ?? 0) > 0 || (candidate.reviewerConfidence ?? 0) > 0 || samples >= 8;
}

export function rankGoldenCandidates(input: {
  candidates: HomeRankingCandidate[];
  activeGoldenIds?: readonly string[];
  previousMode?: HomeCurationMode | null;
  previousIds?: readonly string[];
  locationSource: HomeLocationSource;
  limit?: number;
}) {
  const limit = input.limit ?? 5;
  const explicitActiveIds = input.activeGoldenIds ? new Set(input.activeGoldenIds) : null;
  const candidates = input.candidates.map((candidate) => {
    const active = explicitActiveIds ? explicitActiveIds.has(candidate.place.id) : (candidate.golden ?? 0) > 0;
    return { ...candidate, golden: active ? (candidate.golden || 1) : 0 } as HomeRankingCandidate;
  });
  const activeIds = new Set(candidates.filter((candidate) => (candidate.golden ?? 0) > 0).map((candidate) => candidate.place.id));
  const active = candidates
    .filter((candidate) => activeIds.has(candidate.place.id))
    .map((candidate) => prepareGoldenCandidate(candidate, false, input.locationSource));
  const fallback = candidates
    .filter((candidate) => !activeIds.has(candidate.place.id) && hasFallbackEvidence(candidate))
    .map((candidate) => prepareGoldenCandidate(candidate, true, input.locationSource));
  const selectedActive = selectByMmr({ candidates: active, mode: "golden", limit }).selectedFromPool;
  const selectedFallback = selectedActive.length < limit
    ? selectByMmr({
      candidates: fallback,
      mode: "golden",
      limit: limit - selectedActive.length,
      selected: selectedActive,
    }).selectedFromPool
    : [];
  const initial = [...selectedActive, ...selectedFallback];
  const goldenFallback = active.length === 0;
  const previousIds = new Set(input.previousIds ?? []);
  const overlap = initial.filter((candidate) => previousIds.has(candidate.place.id)).length;
  const changedMode = input.previousMode != null && input.previousMode !== "golden";

  if (changedMode && active.length + fallback.length >= 8 && overlap >= 4 && initial.length >= 2) {
    const first = initial[0];
    if (active.length >= limit) {
      return {
        places: selectByMmr({
          candidates: active,
          mode: "golden",
          limit: limit - 1,
          selected: [first],
          previousIds,
          enforcePreviousMaximum: 3,
        }).selected,
        goldenFallback,
        notice: goldenFallback ? GOLDEN_FALLBACK_NOTICE : null,
      };
    }

    const fixedPrimary = active.length ? selectedActive : [first];
    const fallbackLimit = limit - fixedPrimary.length;
    return {
      places: selectByMmr({
        candidates: fallback,
        mode: "golden",
        limit: fallbackLimit,
        selected: fixedPrimary,
        previousIds,
        enforcePreviousMaximum: 3,
      }).selected,
      goldenFallback,
      notice: goldenFallback ? GOLDEN_FALLBACK_NOTICE : null,
    };
  }

  return {
    places: initial,
    goldenFallback,
    notice: goldenFallback ? GOLDEN_FALLBACK_NOTICE : null,
  };
}

export function reviewerConfidenceScore(score: number | null | undefined, samples: number | null | undefined) {
  if (score == null || samples == null || samples <= 0) return 0;
  return confidenceScore(score, samples);
}
