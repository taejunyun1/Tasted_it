import type { PlaceSummary } from "../places/place.types";
import { estimateWalkingMeters } from "../parking/parking-distance";
import { calculateRating } from "../ratings/rating-v1";
import { courseCompatibilityV2, hasCourseTraitPairing } from "./course-compatibility-v2";
import { allowsCourseCandidate, normalizedCourseContext, timeFitScore, type CoursePlaceContextV2 } from "./course-context-v2";
import type { ResolvedCourseTime } from "./course-options";

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

export interface RankedCoursePairV2 extends RankedCoursePair {
  algorithmVersion: "course-context-v2";
  timeFitScore: number;
  compatibilityScore: number;
  availability: { first: CoursePlaceContextV2["availability"]; second: CoursePlaceContextV2["availability"] };
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

function reliability(place: PlaceSummary) {
  return Math.min(100, Math.round(((place.positive + place.negative) / 8) * 100));
}

function v2Badges(input: { first: CoursePlaceContextV2; second: CoursePlaceContextV2; compatibility: number; timeFit: number; expanded: boolean }) {
  const values: string[] = [];
  if (input.first.availability === "OPEN" && input.second.availability === "OPEN") values.push("기록상 두 곳 모두 영업시간");
  else if (input.first.availability === "UNKNOWN" || input.second.availability === "UNKNOWN") values.push("영업시간 확인 필요");
  if (input.timeFit >= 0.8) values.push("시간대에 잘 맞음");
  if (input.compatibility >= 70) values.push("메뉴 조합 좋음");
  if (input.expanded) values.push("이동거리 확장");
  return values.slice(0, 2);
}

/**
 * Contextual ranking deliberately reads only already-derived profile/context data.
 * It never triggers provider, AI, rating, or parking recalculation.
 */
export function rankCoursePairsV2(input: {
  places: PlaceSummary[];
  contexts: ReadonlyMap<string, CoursePlaceContextV2>;
  center: { latitude: number; longitude: number };
  mealCategories: string[];
  second: "cafe" | "dessert";
  radiusKm: number;
  resolvedTime: ResolvedCourseTime;
  timeWasAuto: boolean;
  limit?: number;
}) {
  const contextFor = (place: PlaceSummary) => input.contexts.get(place.id) ?? normalizedCourseContext({ primaryCategorySlug: place.primaryCategory.slug });
  const radiusMeters = input.radiusKm * 1_000;
  const meals = input.places.filter((place) => {
    const context = contextFor(place);
    const categorySlugs = [context.primaryCategorySlug, ...context.secondaryCategorySlugs];
    return !allSecondSlugs.has(context.primaryCategorySlug)
      && (!input.mealCategories.length || input.mealCategories.some((slug) => categorySlugs.includes(slug)))
      && allowsCourseCandidate(context)
      && estimateWalkingMeters(input.center, place) <= radiusMeters;
  });
  const seconds = input.places.filter((place) => allowsCourseCandidate(contextFor(place)) && categoryMatchesSecond(place, input.second));
  const direct: Array<{ first: PlaceSummary; second: PlaceSummary; between: number; expanded: boolean }> = [];
  const expanded: typeof direct = [];
  for (const first of meals) for (const second of seconds) {
    if (first.id === second.id) continue;
    const between = estimateWalkingMeters(first, second);
    if (between <= 1_500) direct.push({ first, second, between, expanded: false });
    else if (between <= 3_000) expanded.push({ first, second, between, expanded: true });
  }
  const pool = direct.length ? direct : expanded;
  const ranked = pool.map(({ first, second, between, expanded: wasExpanded }) => {
    const firstContext = contextFor(first);
    const secondContext = contextFor(second);
    const userToFirstMeters = estimateWalkingMeters(input.center, first);
    const pairDistanceScore = Math.max(0, 100 - (between / 3_000) * 100);
    const userDistanceScore = Math.max(0, 100 - (userToFirstMeters / radiusMeters) * 100);
    const distanceScore = (userDistanceScore + pairDistanceScore) / 2;
    const timeFit = (timeFitScore(firstContext.availability, input.resolvedTime, { auto: input.timeWasAuto })
      + timeFitScore(secondContext.availability, input.resolvedTime, { auto: input.timeWasAuto })) / 2;
    const compatibility = courseCompatibilityV2(firstContext, secondContext);
    const traitScore = hasCourseTraitPairing(firstContext, secondContext) ? 100 : 0;
    const foodQuality = (quality(first) + quality(second)) / 2;
    const ratingReliability = (reliability(first) + reliability(second)) / 2;
    const score = Math.round(foodQuality * 0.30 + ratingReliability * 0.20 + timeFit * 100 * 0.20 + compatibility * 0.15 + distanceScore * 0.10 + traitScore * 0.05);
    return {
      algorithmVersion: "course-context-v2" as const,
      first,
      second,
      userToFirstMeters,
      betweenPlacesMeters: between,
      score,
      expandedSecondRadius: wasExpanded,
      timeFitScore: Math.round(timeFit * 100),
      compatibilityScore: compatibility,
      availability: { first: firstContext.availability, second: secondContext.availability },
      badges: v2Badges({ first: firstContext, second: secondContext, compatibility, timeFit, expanded: wasExpanded }),
    };
  }).sort((left, right) => right.score - left.score
    || right.compatibilityScore - left.compatibilityScore
    || left.userToFirstMeters - right.userToFirstMeters
    || left.betweenPlacesMeters - right.betweenPlacesMeters
    || left.first.id.localeCompare(right.first.id)
    || left.second.id.localeCompare(right.second.id));

  // Preserve variety even if scoring happens to cluster one meal category.
  const firstCategoryCount = new Map<string, number>();
  const selected: RankedCoursePairV2[] = [];
  for (const candidate of ranked) {
    const count = firstCategoryCount.get(candidate.first.primaryCategory.slug) ?? 0;
    if (count >= 3) continue;
    firstCategoryCount.set(candidate.first.primaryCategory.slug, count + 1);
    selected.push(candidate);
    if (selected.length >= (input.limit ?? 6)) break;
  }
  return selected;
}
