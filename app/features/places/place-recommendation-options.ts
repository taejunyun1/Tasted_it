import { TASTE_BADGE_CATALOG } from "../members/profile-taste-badges";

export type RecommendationChipKind = "USER" | "SEASONAL" | "DISCOVERY" | "GENERAL";
export type RecommendationChip = { id: string; label: string; kind: RecommendationChipKind };

const catalog = new Map(TASTE_BADGE_CATALOG.map((badge) => [badge.id, badge]));

const SPECIAL_CHIPS: RecommendationChip[] = [
  { id: "discovery-new-taste", label: "새로운 맛", kind: "DISCOVERY" },
  { id: "discovery-neighborhood", label: "동네에서 발견", kind: "DISCOVERY" },
  { id: "general-trusted", label: "평가 좋은 곳", kind: "GENERAL" },
  { id: "season-spring", label: "봄 제철", kind: "SEASONAL" },
  { id: "season-summer", label: "여름 별미", kind: "SEASONAL" },
  { id: "season-autumn", label: "가을 제철", kind: "SEASONAL" },
  { id: "season-winter", label: "겨울 국물", kind: "SEASONAL" },
];

const knownIds = new Set([...catalog.keys(), ...SPECIAL_CHIPS.map((chip) => chip.id)]);

const SEASONAL_BADGES: Record<"SPRING" | "SUMMER" | "AUTUMN" | "WINTER", string[]> = {
  SPRING: ["food-strawberry", "food-seafood", "season-spring"],
  SUMMER: ["food-naengmyeon", "food-makguksu", "season-summer"],
  AUTUMN: ["food-crustacean", "food-mushroom", "season-autumn"],
  WINTER: ["food-gukbap", "food-kalguksu", "season-winter"],
};

export function seasonForMonth(month: number): keyof typeof SEASONAL_BADGES {
  if (month >= 3 && month <= 5) return "SPRING";
  if (month >= 6 && month <= 8) return "SUMMER";
  if (month >= 9 && month <= 11) return "AUTUMN";
  return "WINTER";
}

function chipFor(id: string, kind: RecommendationChipKind): RecommendationChip | null {
  const badge = catalog.get(id);
  if (badge) return { id, label: badge.headlineNoun, kind };
  const special = SPECIAL_CHIPS.find((chip) => chip.id === id);
  return special ? { ...special, kind } : null;
}

export function parseRecommendationSelection(values: string[]) {
  return [...new Set(values)].filter((value) => knownIds.has(value)).slice(0, 2);
}

export function buildRecommendationChips(input: { userBadges: string[]; month: number }): RecommendationChip[] {
  const chips: RecommendationChip[] = [];
  const add = (chip: RecommendationChip | null) => {
    if (chip && !chips.some((item) => item.id === chip.id) && chips.length < 8) chips.push(chip);
  };
  input.userBadges.slice(0, 3).forEach((id) => add(chipFor(id, "USER")));
  SEASONAL_BADGES[seasonForMonth(input.month)].forEach((id) => {
    if (chips.filter((chip) => chip.kind === "SEASONAL").length < 2) add(chipFor(id, "SEASONAL"));
  });
  add(chipFor("discovery-new-taste", "DISCOVERY"));
  add(chipFor("discovery-neighborhood", "DISCOVERY"));
  add(chipFor("general-trusted", "GENERAL"));
  const fallbacks = ["food-gukbap", "food-naengmyeon", "style-old-school", "taste-spicy"];
  fallbacks.forEach((id) => add(chipFor(id, "USER")));
  return chips.slice(0, 8);
}

export function buildRecommendationTitle(selected: string[], month: number) {
  const values = new Set(parseRecommendationSelection(selected));
  if (values.has("food-naengmyeon") && values.has("style-old-school")) return "오래된 여름의 맛";
  if (values.has("food-gukbap") && values.has("style-old-school")) return "오래된 집에서 뜨끈하게";
  if (values.has("food-naengmyeon")) return "오늘은 시원하게";
  if (values.has("food-gukbap")) return "오늘은 뜨끈하게";
  if (values.has("style-old-school")) return "오래된 맛을 찾아서";
  if (values.has("discovery-new-taste")) return "평소와 다른 한 끼";
  if ([...values].some((id) => id.startsWith("season-"))) {
    const labels = { SPRING: "봄", SUMMER: "여름", AUTUMN: "가을", WINTER: "겨울" } as const;
    return `지금 먹기 좋은 ${labels[seasonForMonth(month)]}의 맛`;
  }
  return "취향과 새로운 맛 사이";
}

export const TASTE_ADJACENCY: Record<string, string[]> = {
  "food-naengmyeon": ["막국수", "메밀", "소바", "만두"],
  "food-gukbap": ["해장국", "순대", "감자탕", "백반"],
  "food-tteokbokki": ["순대", "튀김", "즉석떡볶이", "라볶이"],
  "food-ramen": ["우동", "소바", "쌀국수"],
  "food-sushi": ["회", "덮밥", "소바", "이자카야"],
};

export function termsForBadge(id: string) {
  if (id === "discovery-new-taste" || id === "discovery-neighborhood") return [];
  if (id.startsWith("season-")) return SEASONAL_BADGES[seasonForMonth(id === "season-spring" ? 4 : id === "season-summer" ? 7 : id === "season-autumn" ? 10 : 1)]
    .flatMap((badgeId) => catalog.get(badgeId)?.matchTerms ?? []);
  const badge = catalog.get(id);
  return badge ? [...(badge.matchTerms ?? []), badge.headlineNoun, badge.label] : [];
}

