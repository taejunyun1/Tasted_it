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

const history = {
  sessionSeed: "test-session",
  recentFirst: [],
  recentShown: [],
  previousMode: null,
  previousIds: [],
};

function qualityFixtures() {
  return [
    place("visible-low", { category: "soup", neighborhood: "A", ratingScore: 54, ratingSampleCount: 8 }),
    place("small-sample", { category: "noodle", neighborhood: "B", ratingScore: null, ratingSampleCount: 4 }),
    ...buildDiversityFixtures(),
  ];
}

describe("rankHomeCuration", () => {
  it("slot-first 배정 없이 전역 모드 적합도로 1위를 고른다", () => {
    const result = rankHomeCuration({
      places: [
        place("near-no-taste", { category: "soup", neighborhood: "A", ratingScore: 88, ratingSampleCount: 20,
          latitude: 35.1501, longitude: 126.9201 }),
        place("far-strong-taste", { category: "noodle", neighborhood: "B", ratingScore: 82, ratingSampleCount: 14,
          terms: "국밥", latitude: 35.17, longitude: 126.94 }),
      ],
      goldenPicks: [],
      center,
      tasteSignals: [{ badgeId: "food-gukbap", score: 1, source: "USER" }],
      mode: "taste",
      timeSlot: "lunch",
      radiusMeters: 3_000,
      history,
      dateKey: "2026-08-11",
      locationSource: "map_center",
    });

    expect(result[0].id).toBe("far-strong-taste");
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
      history,
      dateKey: "2026-08-11",
      locationSource: "map_center",
    });

    expect(result.some((item) => item.id === "visible-low")).toBe(false);
    expect(result.find((item) => item.id === "small-sample")?.slot).not.toBe("TRUSTED_PICK");
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
      history,
      dateKey: "2026-08-11",
      locationSource: "map_center",
    });

    expect(result).toHaveLength(5);
    expect(result.filter((item) => item.isGoldenPick).map((item) => item.id)).toEqual(["a1"]);
  });

  it("Golden 활성 후보가 없을 때 리뷰어·전체 평가 근거가 없는 일반 후보는 반환하지 않는다", () => {
    const result = rankHomeCuration({
      places: [place("general", { category: "soup", neighborhood: "A", ratingSampleCount: 0 })],
      goldenPicks: [],
      center,
      tasteSignals: [],
      mode: "golden",
      timeSlot: "dinner",
      radiusMeters: 3_000,
      history,
      dateKey: "2026-08-11",
      locationSource: "map_center",
    });

    expect(result).toEqual([]);
  });

  it.each([
    ["gps", "현재 위치에서 가까워요"],
    ["map_center", "현재 보고 있는 지역에서 가까워요"],
  ] as const)("%s 거리 이유를 사용하고 실제 기여 이유를 최대 두 개만 반환한다", (locationSource, distanceReason) => {
    const result = rankHomeCuration({
      places: buildDiversityFixtures(),
      goldenPicks: [],
      center,
      tasteSignals: [],
      mode: "now",
      timeSlot: "afternoon",
      radiusMeters: 3_000,
      history,
      dateKey: "2026-08-11",
      locationSource,
    });

    expect(result.every((item) => item.recommendationReasons.length <= 2)).toBe(true);
    expect(result.flatMap((item) => item.recommendationReasons)).toContain(distanceReason);
    expect(result.flatMap((item) => item.recommendationReasons)).not.toContain("나의 취향과 가까움");
  });
});
