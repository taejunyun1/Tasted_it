import { describe, expect, it } from "vitest";

import {
  buildDiscoverySections,
  formatPublicRatingSummary,
  formatRatingSummary,
  PUBLIC_RATING_FALLBACK_COPY,
  rankGoldenRelay,
  rankPersonalDiscovery,
  rankTrustedPlaces,
} from "../../app/features/places/place-discovery";
import type { PlaceSummary } from "../../app/features/places/place.types";

function place(
  id: string,
  input: Partial<PlaceSummary> & Pick<PlaceSummary, "latitude" | "longitude">,
): PlaceSummary {
  return {
    id,
    slug: id,
    name: id,
    address: `${id} address`,
    neighborhood: `${id}동`,
    heroImageUrl: null,
    primaryCategory: { slug: "gukbap", name: "국밥", emoji: "🍲" },
    positive: 0,
    negative: 0,
    ...input,
  };
}

describe("place discovery", () => {
  it("shows progress below eight votes and the Bayesian score from eight", () => {
    expect(formatRatingSummary(place("seven", { latitude: 35, longitude: 126, positive: 6, negative: 1 }))).toBe("평가 7/8");
    expect(formatRatingSummary(place("eight", { latitude: 35, longitude: 126, positive: 6, negative: 2 }))).toBe("추천 67% · 8명 평가");
  });

  it("prints public list scores from a snapshot and fallback copy when none exists", () => {
    expect(formatPublicRatingSummary({ ratingScore: 41, ratingSampleCount: 8 })).toBe("추천 41% · 8명 평가");
    expect(formatPublicRatingSummary({ ratingScore: null, ratingSampleCount: 3 })).toBe(`${PUBLIC_RATING_FALLBACK_COPY} · 3/8`);
    expect(formatPublicRatingSummary({})).toBe(PUBLIC_RATING_FALLBACK_COPY);
  });

  it("sorts nearby by distance and service picks by score then sample count", () => {
    const places = [
      place("far", { latitude: 35.2, longitude: 126.9, positive: 8, negative: 2 }),
      place("near", { latitude: 35.001, longitude: 126.9, positive: 7, negative: 1 }),
      place("best", { latitude: 35.3, longitude: 126.9, positive: 11, negative: 1 }),
    ];
    const result = buildDiscoverySections(places, [], { latitude: 35, longitude: 126.9 }, 2);
    expect(result.nearby.map((item) => item.id)).toEqual(["near", "far"]);
    expect(result.service.map((item) => item.id)).toEqual(["best"]);
  });

  it("uses each place only once across ordered recommendation rails", () => {
    const places = [
      place("near", { latitude: 35, longitude: 126.9, positive: 8, negative: 0 }),
      place("service", { latitude: 36, longitude: 127, positive: 10, negative: 2 }),
      place("golden", { latitude: 37, longitude: 128, positive: 0, negative: 0 }),
    ];
    const result = buildDiscoverySections(
      places,
      [
        { placeId: "near", effectiveAt: "2026-08-06T01:00:00Z" },
        { placeId: "golden", effectiveAt: "2026-08-06T02:00:00Z" },
      ],
      { latitude: 35, longitude: 126.9 },
      1,
    );
    const ids = [...result.nearby, ...result.service, ...result.golden].map((item) => item.id);
    expect(ids).toEqual(["near", "service", "golden"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps two exploration places and caps each category and neighborhood at two", () => {
    const places = [
      place("gukbap-1", { name: "시장국밥", neighborhood: "A동", latitude: 35, longitude: 126.9, positive: 20, primaryCategory: { slug: "gukbap", name: "국밥", emoji: "🍲" } }),
      place("gukbap-2", { name: "원조국밥", neighborhood: "A동", latitude: 35.001, longitude: 126.9, positive: 18, primaryCategory: { slug: "gukbap", name: "국밥", emoji: "🍲" } }),
      place("gukbap-3", { name: "할매국밥", neighborhood: "A동", latitude: 35.002, longitude: 126.9, positive: 17, primaryCategory: { slug: "gukbap", name: "국밥", emoji: "🍲" } }),
      place("haejang", { name: "새벽해장국", neighborhood: "B동", latitude: 35.003, longitude: 126.9, positive: 16, primaryCategory: { slug: "haejangguk", name: "해장국", emoji: "🥘" } }),
      place("sundae", { name: "시장순대", neighborhood: "C동", latitude: 35.004, longitude: 126.9, positive: 15, primaryCategory: { slug: "sundae", name: "순대", emoji: "🍽️" } }),
      place("ramen", { name: "멘야", neighborhood: "D동", latitude: 35.005, longitude: 126.9, positive: 14, primaryCategory: { slug: "ramen-detail", name: "라멘", emoji: "🍜" } }),
      place("sushi", { name: "스시바", neighborhood: "E동", latitude: 35.006, longitude: 126.9, positive: 14, primaryCategory: { slug: "sushi", name: "스시", emoji: "🍣" } }),
      place("pizza", { name: "화덕피자", neighborhood: "F동", latitude: 35.007, longitude: 126.9, positive: 13, primaryCategory: { slug: "pizza", name: "피자", emoji: "🍕" } }),
    ];

    const result = rankPersonalDiscovery({
      places,
      selectedBadges: ["food-gukbap"],
      userBadgeIds: ["food-gukbap"],
      center: { latitude: 35, longitude: 126.9 },
      month: 8,
      limit: 8,
    });

    const counts = result.reduce((map, item) => map.set(item.primaryCategory.slug, (map.get(item.primaryCategory.slug) ?? 0) + 1), new Map<string, number>());
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    expect(result.filter((item) => item.discoveryMode === "EXPLORATION").length).toBeGreaterThanOrEqual(2);
    expect(result.filter((item) => item.neighborhood === "A동")).toHaveLength(2);
  });

  it("fills the rail for discovery-only directions instead of stopping after two", () => {
    const places = Array.from({ length: 8 }, (_, index) => place(`explore-${index}`, {
      name: `새로운 메뉴 ${index}`,
      neighborhood: `${index}동`,
      latitude: 35 + index * 0.001,
      longitude: 126.9,
      positive: 8,
      negative: 2,
      primaryCategory: { slug: `category-${index}`, name: `분류 ${index}`, emoji: "🍽️" },
    }));

    const result = rankPersonalDiscovery({
      places,
      selectedBadges: ["discovery-new-taste"],
      userBadgeIds: [],
      center: { latitude: 35, longitude: 126.9 },
      month: 8,
      limit: 8,
    });

    expect(result).toHaveLength(8);
    expect(result.every((item) => item.discoveryMode === "EXPLORATION")).toBe(true);
  });

  it("uses search text and a quality-gated seasonal boost when ranking", () => {
    const result = rankPersonalDiscovery({
      places: [
        { ...place("summer", { name: "여름식당", latitude: 35, longitude: 126.9, primaryCategory: { slug: "korean", name: "한식", emoji: "🍚" } }), searchText: "평양냉면 메밀", ratingScore: 80, ratingSampleCount: 20 },
        { ...place("plain", { name: "일반식당", latitude: 35, longitude: 126.9, primaryCategory: { slug: "western", name: "양식", emoji: "🍝" } }), ratingScore: 80, ratingSampleCount: 20 },
        { ...place("poor-season", { name: "저평가 냉면", latitude: 35, longitude: 126.9, primaryCategory: { slug: "noodle", name: "면", emoji: "🍜" } }), ratingScore: 20, ratingSampleCount: 8 },
      ],
      selectedBadges: [],
      userBadgeIds: [],
      center: { latitude: 35, longitude: 126.9 },
      month: 8,
      limit: 3,
    });

    expect(result[0]).toMatchObject({ id: "summer", discoveryMode: "EXPLORATION" });
    expect(result[0].recommendationReasons).toContain("지금 먹기 좋은 메뉴");
    expect(result.findIndex((item) => item.id === "poor-season")).toBeGreaterThan(0);
  });

  it("ranks Re:Taste places from precomputed trust signals", () => {
    const places = [
      { ...place("small-perfect", { latitude: 35, longitude: 126.9, positive: 8 }), ratingScore: 100, ratingSampleCount: 8 },
      { ...place("trusted", { latitude: 35.1, longitude: 126.9, positive: 44, negative: 6 }), ratingScore: 88, ratingSampleCount: 50, userScore: 87, reviewerScore: 90 },
    ];
    expect(rankTrustedPlaces({ places, limit: 2 })[0].id).toBe("trusted");
  });

  it("builds a Golden Pick relay across reviewers and categories", () => {
    const places = [
      { ...place("gold-1", { latitude: 35, longitude: 126.9, primaryCategory: { slug: "gukbap", name: "국밥", emoji: "🍲" } }), reviewerUserId: "r1", goldenPickAt: "2026-08-08T00:00:00Z" },
      { ...place("gold-2", { latitude: 35.01, longitude: 126.9, primaryCategory: { slug: "gukbap", name: "국밥", emoji: "🍲" } }), reviewerUserId: "r1", goldenPickAt: "2026-08-09T00:00:00Z" },
      { ...place("gold-3", { latitude: 35.02, longitude: 126.9, primaryCategory: { slug: "ramen", name: "라멘", emoji: "🍜" } }), reviewerUserId: "r2", goldenPickAt: "2026-08-07T00:00:00Z" },
    ];
    const result = rankGoldenRelay({ places, center: { latitude: 35, longitude: 126.9 }, userBadgeIds: ["food-gukbap"], limit: 3 });
    expect(result.map((item) => item.id)).toEqual(["gold-1", "gold-3", "gold-2"]);
  });
});
