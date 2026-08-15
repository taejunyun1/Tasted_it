import type { CoursePlaceContextV2 } from "./course-context-v2";

const familyByCategory: Record<string, string> = {
  "korean-general": "korean", "home-meal": "korean", "gukbap-detail": "korean", stew: "korean", grill: "korean", pub: "korean",
  "japanese-general": "japanese", "japanese-rice": "japanese", "ramen-detail": "japanese", sushi: "japanese", donkatsu: "japanese",
  "chinese-general": "chinese", "chinese-dish": "chinese", malatang: "chinese",
  "western-general": "western", pasta: "western", pizza: "western", burger: "western", steak: "western",
  cafe: "cafe", dessert: "cafe", "bakery-detail": "cafe", "ice-dessert": "cafe",
};

const adjacency = new Map<string, ReadonlySet<string>>([
  ["gukbap-detail", new Set(["home-meal", "stew", "grill"])],
  ["ramen-detail", new Set(["japanese-rice", "sushi", "udon"])],
  ["cafe", new Set(["dessert", "bakery-detail", "ice-dessert"])],
  ["dessert", new Set(["cafe", "bakery-detail", "ice-dessert"])],
]);

function allSlugs(context: CoursePlaceContextV2) {
  return [context.primaryCategorySlug, ...context.secondaryCategorySlugs];
}

export function courseCompatibilityV2(first: CoursePlaceContextV2, second: CoursePlaceContextV2) {
  const firstSlugs = allSlugs(first);
  const secondSlugs = allSlugs(second);
  if (first.primaryCategorySlug === second.primaryCategorySlug) return 100;
  if (firstSlugs.some((slug) => secondSlugs.includes(slug))) return 90;
  if (firstSlugs.some((slug) => secondSlugs.some((other) => familyByCategory[slug] && familyByCategory[slug] === familyByCategory[other]))) return 70;
  if (firstSlugs.some((slug) => adjacency.get(slug)?.has(second.primaryCategorySlug) || adjacency.get(second.primaryCategorySlug)?.has(slug))) return 40;
  return 0;
}

export function hasCourseTraitPairing(first: CoursePlaceContextV2, second: CoursePlaceContextV2) {
  const traits = new Set([...first.traits, ...second.traits]);
  return traits.has("soloFriendly") || traits.has("date") || traits.has("family") || traits.has("dessert") || traits.has("parkingFriendly");
}
