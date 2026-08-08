import type { Coordinate } from "./parking-types";

const EARTH_RADIUS_METERS = 6_371_000;
const WALKING_CORRECTION = 1.25;

function radians(value: number) {
  return value * (Math.PI / 180);
}

export function estimateWalkingMeters(left: Coordinate, right: Coordinate) {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  const straight = EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round((straight * WALKING_CORRECTION) / 10) * 10;
}

export function distanceBurden(first: number, second: number) {
  return 0.65 * Math.max(first, second) + 0.35 * ((first + second) / 2);
}

export function isSameDistanceCohort(
  best: { first: number; second: number },
  candidate: { first: number; second: number },
) {
  return Math.max(candidate.first, candidate.second) <= Math.max(best.first, best.second) + 150
    && candidate.first + candidate.second <= best.first + best.second + 250;
}
