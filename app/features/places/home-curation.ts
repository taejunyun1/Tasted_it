import type { HomeCurationMode, HomeTimeSlot } from "../maps/home-curation-options";
import { calculateRating } from "../ratings/rating-v1";
import { buildHomeCandidateFeatures } from "./home-curation-features";
import type { HomeLocationSource, HomeRecommendationHistory } from "./home-curation-history.client";
import {
  rankGoldenCandidates,
  rankHomeCandidates,
  reviewerConfidenceScore,
  type HomeRankedCandidate,
  type HomeRankingCandidate,
} from "./home-curation-ranking";
import { distanceInMeters, type DiscoveryCenter, type DiscoveryPlace, type RankingTasteSignal } from "./place-discovery";

export type HomeCurationSlot = "BEST_NOW" | "TASTE_MATCH" | "TIME_MATCH" | "TRUSTED_PICK" | "DISCOVERY";

export type HomeCuratedPlace = DiscoveryPlace & {
  slot: HomeCurationSlot;
  rank: number;
  recommendationReasons: string[];
  isGoldenPick: boolean;
};

export type HomeGoldenSummary = {
  placeId: string;
  active: boolean;
  activeStrength: 0 | .8 | 1;
  pastStrength: 0 | .4;
  reviewerUserId: string | null;
};

type HomeCurationCandidatePlace = DiscoveryPlace & {
  reviewerRatingScore?: number | null;
  reviewerRatingSampleCount?: number;
};

export type HomeCurationInput = {
  places: HomeCurationCandidatePlace[];
  goldenPicks: Array<{ placeId: string; reviewerUserId?: string | null }>;
  goldenSummaries?: HomeGoldenSummary[];
  center: DiscoveryCenter;
  tasteSignals: RankingTasteSignal[];
  mode: HomeCurationMode;
  timeSlot: HomeTimeSlot;
  radiusMeters: 3_000 | 5_000;
  history?: HomeRecommendationHistory;
  dateKey?: string;
  locationSource?: HomeLocationSource;
};

export type HomeCurationPage = {
  status: "READY" | "EMPTY";
  places: HomeCuratedPlace[];
  mode: HomeCurationMode;
  timeSlot: HomeTimeSlot;
  radiusMeters: 3_000 | 5_000;
};

const EMPTY_HISTORY: HomeRecommendationHistory = {
  sessionSeed: "initial-home-curation",
  recentFirst: [],
  recentShown: [],
  previousMode: null,
  previousIds: [],
};

function sampleCount(place: DiscoveryPlace) {
  return place.ratingSampleCount ?? place.positive + place.negative;
}

function passesHomeQuality(place: DiscoveryPlace) {
  const samples = sampleCount(place);
  if (samples < 8) return true;
  const visibleScore = place.ratingScore ?? calculateRating(place).displayScore;
  return visibleScore >= 55;
}

function slotFor(candidate: HomeRankedCandidate): HomeCurationSlot {
  if (candidate.isGoldenPick || candidate.primaryReason === "golden" || candidate.primaryReason === "reviewer"
    || candidate.primaryReason === "past_golden" || candidate.primaryReason === "confidence") return "TRUSTED_PICK";
  if (candidate.primaryReason === "taste") return "TASTE_MATCH";
  if (candidate.primaryReason === "time") return "TIME_MATCH";
  if (candidate.primaryReason === "discovery") return "DISCOVERY";
  return "BEST_NOW";
}

export function rankHomeCuration(input: HomeCurationInput): HomeCuratedPlace[] {
  const history = input.history ?? EMPTY_HISTORY;
  const locationSource = input.locationSource ?? "map_center";
  const goldenSummaries = new Map(input.goldenSummaries?.map((summary) => [summary.placeId, summary]));
  const legacyGolden = new Map(input.goldenPicks.map((pick) => [pick.placeId, pick]));
  const recentCategorySlugs = history.recentShown.flatMap((shown) => {
    const place = input.places.find((candidate) => candidate.id === shown.placeId);
    return place ? [place.primaryCategory.slug] : [];
  });
  const candidates: HomeRankingCandidate[] = input.places
    .filter((place) => passesHomeQuality(place) && distanceInMeters(input.center, place) <= input.radiusMeters)
    .map((place) => {
      const summary = goldenSummaries.get(place.id);
      const legacy = legacyGolden.get(place.id);
      return {
        place,
        features: buildHomeCandidateFeatures({
          place,
          center: input.center,
          tasteSignals: input.tasteSignals,
          timeSlot: input.timeSlot,
          history,
          dateKey: input.dateKey ?? "1970-01-01",
          mode: input.mode,
          recentCategorySlugs,
        }),
        golden: summary?.active ? summary.activeStrength : legacy ? 1 : 0,
        pastGolden: summary?.pastStrength ?? 0,
        reviewerConfidence: reviewerConfidenceScore(place.reviewerRatingScore, place.reviewerRatingSampleCount),
        reviewerId: summary?.reviewerUserId ?? legacy?.reviewerUserId ?? null,
      };
    });
  const ranked = input.mode === "golden"
    ? rankGoldenCandidates({
      candidates,
      previousMode: history.previousMode,
      previousIds: history.previousIds,
      locationSource,
    }).places
    : rankHomeCandidates({
      candidates,
      mode: input.mode,
      previousMode: history.previousMode,
      previousIds: history.previousIds,
      locationSource,
    });

  return ranked.map((candidate, index) => ({
    ...candidate.place,
    slot: slotFor(candidate),
    rank: index + 1,
    recommendationReasons: candidate.recommendationReasons,
    isGoldenPick: candidate.isGoldenPick,
  }));
}
