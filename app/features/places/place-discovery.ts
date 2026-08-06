import { calculateRating } from "../ratings/rating-v1";
import type { PlaceSummary } from "./place.types";

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
}

export interface DiscoverySections {
  nearby: DiscoveryPlace[];
  service: DiscoveryPlace[];
  golden: DiscoveryPlace[];
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
