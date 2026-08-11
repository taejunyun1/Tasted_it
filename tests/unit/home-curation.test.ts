import { describe, expect, it } from "vitest";

import { rankHomeCuration } from "../../app/features/places/home-curation";
import type { DiscoveryPlace } from "../../app/features/places/place-discovery";

const center = { latitude: 35.15, longitude: 126.92 };

function place(id: string, input: {
  category: string;
  neighborhood: string;
  ratingScore?: number | null;
  ratingSampleCount?: number;
  terms?: string;
  latitude?: number;
  longitude?: number;
}): DiscoveryPlace {
  return {
    id,
    slug: id,
    name: id,
    address: `${input.neighborhood} ${id}`,
    neighborhood: input.neighborhood,
    latitude: input.latitude ?? 35.151,
    longitude: input.longitude ?? 126.921,
    heroImageUrl: null,
    searchText: input.terms ?? "",
    primaryCategory: { slug: input.category, name: input.category, emoji: "🍽️" },
    positive: input.ratingSampleCount ?? 0,
    negative: 0,
    ratingScore: input.ratingScore,
    ratingSampleCount: input.ratingSampleCount,
  };
}

function counts(items: DiscoveryPlace[], key: (item: DiscoveryPlace) => string) {
  const result = new Map<string, number>();
  items.forEach((item) => result.set(key(item), (result.get(key(item)) ?? 0) + 1));
  return result;
}

function buildDiversityFixtures() {
  return [
    place("a1", { category: "soup", neighborhood: "A", ratingScore: 90, ratingSampleCount: 20 }),
    place("a2", { category: "soup", neighborhood: "A", ratingScore: 89, ratingSampleCount: 20 }),
    place("a3", { category: "soup", neighborhood: "A", ratingScore: 88, ratingSampleCount: 20 }),
    place("b1", { category: "noodle", neighborhood: "B", ratingScore: 87, ratingSampleCount: 20 }),
    place("c1", { category: "seafood", neighborhood: "C", ratingScore: 86, ratingSampleCount: 20 }),
    place("d1", { category: "home-meal", neighborhood: "D", ratingScore: 85, ratingSampleCount: 20 }),
  ];
}

function qualityFixtures() {
  return [
    place("visible-low", { category: "soup", neighborhood: "A", ratingScore: 54, ratingSampleCount: 8 }),
    place("small-sample", { category: "noodle", neighborhood: "B", ratingScore: null, ratingSampleCount: 4 }),
    ...buildDiversityFixtures(),
  ];
}

describe("rankHomeCuration", () => {
  it("기본 모드에서 다섯 역할과 새로운 발견을 유지한다", () => {
    const result = rankHomeCuration({
      places: [
        place("best", { category: "soup", neighborhood: "A", ratingScore: 88, ratingSampleCount: 20, terms: "국밥" }),
        place("taste", { category: "noodle", neighborhood: "B", ratingScore: 82, ratingSampleCount: 14, terms: "냉면" }),
        place("time", { category: "home-meal", neighborhood: "C", ratingScore: 79, ratingSampleCount: 10, terms: "백반" }),
        place("trusted", { category: "seafood", neighborhood: "D", ratingScore: 91, ratingSampleCount: 40, terms: "생선" }),
        place("new", { category: "soba", neighborhood: "E", ratingScore: 76, ratingSampleCount: 9, terms: "메밀" }),
      ],
      goldenPicks: [],
      center,
      tasteSignals: [{ badgeId: "food-gukbap", score: 1, source: "USER" }],
      mode: "now",
      timeSlot: "lunch",
      radiusMeters: 3_000,
    });

    expect(result.map((item) => item.slot)).toEqual([
      "BEST_NOW",
      "TASTE_MATCH",
      "TIME_MATCH",
      "TRUSTED_PICK",
      "DISCOVERY",
    ]);
    expect(result).toHaveLength(5);
  });

  it("후보가 충분하면 같은 카테고리와 동네를 각각 두 곳까지만 선택한다", () => {
    const result = rankHomeCuration({
      places: buildDiversityFixtures(),
      goldenPicks: [],
      center,
      tasteSignals: [],
      mode: "now",
      timeSlot: "lunch",
      radiusMeters: 3_000,
    });

    expect(Math.max(...counts(result, (item) => item.primaryCategory.slug).values())).toBeLessThanOrEqual(2);
    expect(Math.max(...counts(result, (item) => item.neighborhood).values())).toBeLessThanOrEqual(2);
  });

  it("표본 8개 이상 55점 미만 장소를 제외하고 소표본 장소를 신뢰 슬롯에 넣지 않는다", () => {
    const result = rankHomeCuration({
      places: qualityFixtures(),
      goldenPicks: [],
      center,
      tasteSignals: [],
      mode: "now",
      timeSlot: "lunch",
      radiusMeters: 3_000,
    });

    expect(result.some((item) => item.id === "visible-low")).toBe(false);
    expect(result.find((item) => item.id === "small-sample")?.slot).not.toBe("TRUSTED_PICK");
  });

  it.each(["now", "taste", "time"] as const)("%s 모드에서 새로운 발견 한 곳을 유지한다", (mode) => {
    const result = rankHomeCuration({
      places: buildDiversityFixtures(),
      goldenPicks: [],
      center,
      tasteSignals: [{ badgeId: "food-gukbap", score: 1, source: "USER" }],
      mode,
      timeSlot: "lunch",
      radiusMeters: 3_000,
    });

    expect(result.some((item) => item.slot === "DISCOVERY")).toBe(true);
  });

  it("Golden Pick 부족분은 신뢰 장소로 채우되 Golden 배지를 위조하지 않는다", () => {
    const result = rankHomeCuration({
      places: buildDiversityFixtures(),
      goldenPicks: [{ placeId: "a1" }],
      center,
      tasteSignals: [],
      mode: "golden",
      timeSlot: "dinner",
      radiusMeters: 3_000,
    });

    expect(result).toHaveLength(5);
    expect(result.filter((item) => item.isGoldenPick).map((item) => item.id)).toEqual(["a1"]);
  });

  it("추천 이유는 실제 근거가 없는 슬롯 문구를 만들지 않는다", () => {
    const result = rankHomeCuration({
      places: buildDiversityFixtures(),
      goldenPicks: [],
      center,
      tasteSignals: [],
      mode: "taste",
      timeSlot: "afternoon",
      radiusMeters: 3_000,
    });

    expect(result.flatMap((item) => item.recommendationReasons)).not.toContain("나의 취향과 가까움");
  });
});
