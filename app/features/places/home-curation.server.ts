import type { AppDb } from "../../db/client.server";
import {
  homeDateKeyAt,
  homeTimeSlotAt,
  type HomeCurationMode,
} from "../maps/home-curation-options";
import {
  passesHomeQuality,
  rankHomeCuration,
  type HomeCurationPage,
} from "./home-curation";
import type {
  HomeLocationSource,
  HomeRecommendationHistory,
} from "./home-curation-history.client";
import {
  distanceInMeters,
  type DiscoveryCenter,
  type DiscoveryPlace,
} from "./place-discovery";
import { loadRecommendationCandidateContext } from "./recommendation-candidates.server";

const CANDIDATE_RADIUS_METERS = 8_000;
const GOLDEN_FALLBACK_NOTICE = "현재 주변 Golden Pick이 없어 과거 선정 이력과 평가 기록을 바탕으로 추천합니다.";

type HomeCurationRadius = HomeCurationPage["radiusMeters"];

export type HomeCurationRequest = {
  userId?: string | null;
  tasteBadgeIds?: string[];
  bbox: [number, number, number, number];
  categorySlug?: string;
  center: DiscoveryCenter;
  mode: HomeCurationMode;
  now: string;
  history?: HomeRecommendationHistory;
  locationSource?: HomeLocationSource;
};

function candidateBbox(center: DiscoveryCenter): [number, number, number, number] {
  const latitudeDelta = CANDIDATE_RADIUS_METERS / 6_371_000 * 180 / Math.PI;
  const longitudeDelta = latitudeDelta / Math.max(Math.abs(Math.cos(center.latitude * Math.PI / 180)), .000_001);
  return [
    Math.max(-180, center.longitude - longitudeDelta),
    Math.max(-90, center.latitude - latitudeDelta),
    Math.min(180, center.longitude + longitudeDelta),
    Math.min(90, center.latitude + latitudeDelta),
  ];
}

function within(radiusMeters: HomeCurationRadius) {
  return (place: DiscoveryPlace) => (place.distanceMeters ?? Infinity) <= radiusMeters;
}

export async function getHomeCurationPage(
  db: AppDb,
  input: HomeCurationRequest,
): Promise<HomeCurationPage> {
  const context = await loadRecommendationCandidateContext(db, {
    userId: input.userId,
    tasteBadgeIds: input.tasteBadgeIds,
    bbox: candidateBbox(input.center),
    categorySlug: input.categorySlug,
    now: input.now,
    goldenContext: input.mode === "golden" ? "empty-on-error" : "omit",
  });
  const timeSlot = homeTimeSlotAt(new Date(input.now));
  const qualityCandidates = context.candidates
    .map((place) => ({
      ...place,
      distanceMeters: distanceInMeters(input.center, place),
    }))
    .filter(passesHomeQuality)
    .filter(within(CANDIDATE_RADIUS_METERS));
  const radiusMeters: HomeCurationRadius = qualityCandidates.filter(within(3_000)).length >= 20
    ? 3_000
    : qualityCandidates.filter(within(5_000)).length >= 20 ? 5_000 : 8_000;
  const candidates = qualityCandidates.filter(within(radiusMeters));
  if (input.mode === "golden" && context.goldenContextStatus === "UNAVAILABLE") {
    return {
      algorithmVersion: "home-curation-v2",
      status: "EMPTY",
      places: [],
      mode: input.mode,
      timeSlot,
      radiusMeters,
      candidateCount: candidates.length,
      goldenFallback: true,
      notice: GOLDEN_FALLBACK_NOTICE,
    };
  }
  const curatedPlaces = rankHomeCuration({
    places: candidates,
    goldenPicks: context.goldenPicks,
    goldenSummaries: context.goldenSummaries,
    center: input.center,
    tasteSignals: context.tasteSignals,
    mode: input.mode,
    timeSlot,
    radiusMeters,
    history: input.history,
    dateKey: homeDateKeyAt(new Date(input.now)),
    locationSource: input.locationSource,
  });
  const candidateIds = new Set(candidates.map((place) => place.id));
  const hasActiveGolden = context.goldenSummaries.some((summary) => (
    summary.active && candidateIds.has(summary.placeId)
  ));
  const goldenFallback = input.mode === "golden" && !hasActiveGolden;

  return {
    algorithmVersion: "home-curation-v2",
    status: curatedPlaces.length ? "READY" : "EMPTY",
    places: curatedPlaces,
    mode: input.mode,
    timeSlot,
    radiusMeters,
    candidateCount: candidates.length,
    goldenFallback,
    notice: goldenFallback ? GOLDEN_FALLBACK_NOTICE : null,
  };
}
