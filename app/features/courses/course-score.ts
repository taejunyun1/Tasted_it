import type { PlaceSummary } from "../places/place.types";
import { estimateWalkingMeters } from "../parking/parking-distance";
import { calculateRating } from "../ratings/rating-v1";

const cafeSlugs = new Set(["cafe"]);
const dessertSlugs = new Set(["dessert", "bakery-detail", "ice-dessert"]);
const allSecondSlugs = new Set([...cafeSlugs, ...dessertSlugs]);

export interface RankedCoursePair {
  first: PlaceSummary;
  second: PlaceSummary;
  userToFirstMeters: number;
  betweenPlacesMeters: number;
  score: number;
  expandedSecondRadius: boolean;
  badges: string[];
}

function quality(place: PlaceSummary) {
  const rating = calculateRating(place);
  return rating.sampleStatus === "VISIBLE" ? rating.displayScore : 50;
}

function categoryMatchesSecond(place: PlaceSummary, second: "cafe" | "dessert") {
  return (second === "cafe" ? cafeSlugs : dessertSlugs).has(place.primaryCategory.slug);
}

function badges(first: PlaceSummary, second: PlaceSummary, score: number, expanded: boolean) {
  const values: string[] = [];
  if (score >= 75) values.push("코스 균형 우수");
  if (first.positive + first.negative < 8 || second.positive + second.negative < 8) values.push("평가 더 필요");
  else values.push("평가 신뢰도 상위");
  if (expanded) values.push("이동거리 확장");
  else values.push("이동 동선 우수");
  return values.slice(0, 3);
}

export function rankCoursePairs(input: {
  places: PlaceSummary[];
  center: { latitude: number; longitude: number };
  mealCategories: string[];
  second: "cafe" | "dessert";
  radiusKm: number;
  limit?: number;
}) {
  const radiusMeters = input.radiusKm * 1_000;
  const meals = input.places.filter((place) => !allSecondSlugs.has(place.primaryCategory.slug)
    && (!input.mealCategories.length || input.mealCategories.includes(place.primaryCategory.slug))
    && estimateWalkingMeters(input.center, place) <= radiusMeters);
  const seconds = input.places.filter((place) => categoryMatchesSecond(place, input.second));
  const direct: Array<{ first: PlaceSummary; second: PlaceSummary; between: number; expanded: boolean }> = [];
  const expanded: typeof direct = [];
  for (const first of meals) for (const second of seconds) {
    if (first.id === second.id) continue;
    const between = estimateWalkingMeters(first, second);
    if (between <= 1_500) direct.push({ first, second, between, expanded: false });
    else if (between <= 3_000) expanded.push({ first, second, between, expanded: true });
  }
  const pool = direct.length ? direct : expanded;
  return pool.map(({ first, second, between, expanded: wasExpanded }) => {
    const userToFirstMeters = estimateWalkingMeters(input.center, first);
    const userDistanceScore = Math.max(0, 100 - (userToFirstMeters / radiusMeters) * 100);
    const pairDistanceScore = Math.max(0, 100 - (between / 3_000) * 100);
    const diversity = first.primaryCategory.slug === second.primaryCategory.slug ? 0 : 100;
    const score = Math.round(quality(first) * 0.30 + quality(second) * 0.25 + userDistanceScore * 0.20 + pairDistanceScore * 0.20 + diversity * 0.05);
    return { first, second, userToFirstMeters, betweenPlacesMeters: between, score, expandedSecondRadius: wasExpanded, badges: badges(first, second, score, wasExpanded) };
  }).sort((left, right) => right.score - left.score
    || left.userToFirstMeters - right.userToFirstMeters
    || left.betweenPlacesMeters - right.betweenPlacesMeters
    || left.first.id.localeCompare(right.first.id)
    || left.second.id.localeCompare(right.second.id)).slice(0, input.limit ?? 6);
}
