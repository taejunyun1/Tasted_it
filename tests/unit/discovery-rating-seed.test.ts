import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { rankPersonalDiscovery, type DiscoveryPlace } from "../../app/features/places/place-discovery";

function discoveryPlace(id: string, input: Partial<DiscoveryPlace> = {}): DiscoveryPlace {
  return {
    id,
    slug: id,
    name: id,
    address: `${id} address`,
    neighborhood: `${id}동`,
    latitude: 35.15,
    longitude: 126.9,
    heroImageUrl: null,
    primaryCategory: { slug: `${id}-category`, name: id, emoji: "🍽️" },
    positive: 0,
    negative: 0,
    ...input,
  };
}

describe("discovery rating seed", () => {
  it("is repeatable, isolated to QA identities, and covers rating boundaries", () => {
    const sql = readFileSync(new URL("../../scripts/seed-discovery-ratings.sql", import.meta.url), "utf8");
    expect(sql).toContain("qa-discovery-");
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("WHEN 2 THEN 3");
    expect(sql).toContain("WHEN 3 THEN 7");
    expect(sql).toContain("WHEN 4 THEN 8");
    expect(sql).toContain("WHEN 5 THEN 12");
    expect(sql).toContain("WHEN 6 THEN 25");
    expect(sql).toContain("WHEN 7 THEN 50");
    expect(sql).toContain("golden_pick_events");
  });
});

describe("personal discovery safeguards", () => {
  it("reserves two exploration places before filling by clamped score", () => {
    const result = rankPersonalDiscovery({
      places: [
        discoveryPlace("familiar", { name: "국밥", ratingScore: 60 }),
        discoveryPlace("adjacent", { name: "순대", ratingScore: 72 }),
        discoveryPlace("exploration-1", { name: "화덕피자", ratingScore: 20 }),
        discoveryPlace("exploration-2", { name: "스시", ratingScore: 10 }),
      ],
      selectedBadges: ["food-gukbap", "discovery-neighborhood"],
      userBadgeIds: ["food-gukbap"],
      center: { latitude: 35.15, longitude: 126.9 },
      month: 8,
      limit: 4,
    });

    expect(result.slice(0, 2).every((place) => place.discoveryMode === "EXPLORATION")).toBe(true);
    expect(result.findIndex((place) => place.id === "adjacent"))
      .toBeLessThan(result.findIndex((place) => place.id === "familiar"));
  });

  it("allows up to three places per category while keeping two per neighborhood", () => {
    const result = rankPersonalDiscovery({
      places: [
        discoveryPlace("shared-exploration-1", { name: "피자", neighborhood: "A동", primaryCategory: { slug: "shared", name: "공통", emoji: "🍽️" } }),
        discoveryPlace("shared-exploration-2", { name: "스시", neighborhood: "B동", primaryCategory: { slug: "shared", name: "공통", emoji: "🍽️" } }),
        discoveryPlace("shared-familiar", { name: "국밥", neighborhood: "C동", ratingScore: 90, primaryCategory: { slug: "shared", name: "공통", emoji: "🍽️" } }),
        ...Array.from({ length: 5 }, (_, index) => discoveryPlace(`unique-${index}`, {
          name: `새로운 메뉴 ${index}`,
          neighborhood: `고유동-${index}`,
        })),
      ],
      selectedBadges: ["food-gukbap"],
      userBadgeIds: ["food-gukbap"],
      center: { latitude: 35.15, longitude: 126.9 },
      month: 8,
      limit: 8,
    });

    expect(result).toHaveLength(8);
    expect(result.filter((place) => place.primaryCategory.slug === "shared")).toHaveLength(3);
    const neighborhoodCounts = result.reduce(
      (counts, place) => counts.set(place.neighborhood, (counts.get(place.neighborhood) ?? 0) + 1),
      new Map<string, number>(),
    );
    expect(Math.max(...neighborhoodCounts.values())).toBeLessThanOrEqual(2);
  });

  it("lets a style badge after five food badges change the ranked result", () => {
    const places = [
      discoveryPlace("brunch", { name: "브런치", ratingScore: 90 }),
      discoveryPlace("steak", { name: "스테이크", ratingScore: 80 }),
      discoveryPlace("dessert", { name: "디저트", ratingScore: 75 }),
      discoveryPlace("old-school", { name: "전통 노포", ratingScore: 20 }),
    ];
    const baseInput = {
      places,
      selectedBadges: [],
      center: { latitude: 35.15, longitude: 126.9 },
      month: 8,
      limit: 4,
    };
    const foodBadgeIds = [
      "food-gukbap",
      "food-naengmyeon",
      "food-ramen",
      "food-sushi",
      "food-pizza",
    ];

    const withoutStyle = rankPersonalDiscovery({ ...baseInput, userBadgeIds: foodBadgeIds });
    const withStyle = rankPersonalDiscovery({
      ...baseInput,
      userBadgeIds: [...foodBadgeIds, "style-old-school"],
    });

    expect(withStyle.find((place) => place.id === "old-school")?.discoveryMode).toBe("FAMILIAR");
    expect(withStyle.findIndex((place) => place.id === "old-school"))
      .toBeLessThan(withoutStyle.findIndex((place) => place.id === "old-school"));
  });
});
