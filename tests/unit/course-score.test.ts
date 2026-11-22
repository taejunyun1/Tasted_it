import { describe, expect, it } from "vitest";
import { rankCoursePairs, rankCoursePairsV2 } from "../../app/features/courses/course-score";

const place = (id: string, slug: string, latitude: number, longitude: number, positive = 8, negative = 2) => ({
  id, slug: id, name: id, address: "광주광역시", neighborhood: "동구", latitude, longitude, heroImageUrl: null,
  primaryCategory: { slug, name: slug, emoji: "🍽️" }, positive, negative,
});

describe("course pair ranking", () => {
  it("pairs a meal with a nearby cafe deterministically", () => {
    const pairs = rankCoursePairs({
      places: [
        place("meal-a", "grill", 35.15, 126.85, 20, 2),
        place("meal-b", "grill", 35.151, 126.85, 1, 0),
        place("cafe-a", "cafe", 35.152, 126.85, 12, 1),
      ],
      center: { latitude: 35.15, longitude: 126.85 }, mealCategories: ["grill"], second: "cafe", radiusKm: 3,
    });
    expect(pairs[0]?.first.id).toBe("meal-a");
    expect(pairs[0]?.second.id).toBe("cafe-a");
    expect(pairs[0]?.expandedSecondRadius).toBe(false);
  });

  it("expands the second-place distance from 1.5km to 3km", () => {
    const pairs = rankCoursePairs({
      places: [place("meal", "grill", 35.15, 126.85), place("dessert", "bakery-detail", 35.17, 126.85)],
      center: { latitude: 35.15, longitude: 126.85 }, mealCategories: [], second: "dessert", radiusKm: 5,
    });
    expect(pairs[0]?.expandedSecondRadius).toBe(true);
  });

  it("keeps low-sample ratings neutral and marks them", () => {
    const pairs = rankCoursePairs({
      places: [place("meal", "grill", 35.15, 126.85, 1, 0), place("cafe", "cafe", 35.151, 126.85, 1, 0)],
      center: { latitude: 35.15, longitude: 126.85 }, mealCategories: [], second: "cafe", radiusKm: 3,
    });
    expect(pairs[0]?.badges).toContain("평가 더 필요");
  });

  it("includes meals matching either of two selected categories", () => {
    const pairs = rankCoursePairs({
      places: [
        place("grill", "grill", 35.15, 126.85),
        place("ramen", "ramen-detail", 35.151, 126.85),
        place("korean", "korean", 35.152, 126.85),
        place("cafe", "cafe", 35.153, 126.85),
      ],
      center: { latitude: 35.15, longitude: 126.85 }, mealCategories: ["grill", "ramen-detail"], second: "cafe", radiusKm: 3,
    });
    expect(new Set(pairs.map((pair) => pair.first.id))).toEqual(new Set(["grill", "ramen"]));
  });
});

describe.each([
  { name: "legacy courses", rank: rankCoursePairs },
  {
    name: "contextual courses",
    rank: (input: Parameters<typeof rankCoursePairs>[0]) => rankCoursePairsV2({
      ...input, contexts: new Map(), resolvedTime: "dinner", timeWasAuto: false,
    }),
  },
])("$name rating quality", ({ rank }) => {
  const center = { latitude: 35.15, longitude: 126.85 };
  const input = { center, mealCategories: ["grill"], second: "cafe" as const, radiusKm: 3 };
  const cafe = place("cafe", "cafe", center.latitude, center.longitude, 0, 0);

  it("uses the 30% reviewer cap while pending and prefers current snapshot scores when available", () => {
    const generalFavored = {
      ...place("general", "grill", center.latitude, center.longitude, 5, 9),
      userPositive: 5, userNegative: 0, reviewerPositive: 0, reviewerNegative: 9,
      ratingScore: 20, ratingIsStale: true,
    };
    const reviewerFavored = {
      ...place("reviewer", "grill", center.latitude, center.longitude, 9, 5),
      userPositive: 0, userNegative: 5, reviewerPositive: 9, reviewerNegative: 0,
      ratingScore: null, ratingIsStale: true,
    };
    const pending = rank({ ...input, places: [generalFavored, reviewerFavored, cafe] });
    expect(pending.map((pair) => pair.first.id)).toEqual(["general", "reviewer"]);

    const current = rank({
      ...input,
      places: [
        { ...generalFavored, ratingScore: 50, ratingIsStale: false },
        { ...reviewerFavored, ratingScore: 50, ratingIsStale: false },
        cafe,
      ],
    });
    expect(current).toHaveLength(2);
    expect(current[0]?.score).toBe(current[1]?.score);
  });

  it("keeps seven votes neutral and uses sentiment starting at eight", () => {
    const sevenPositive = {
      ...place("positive", "grill", center.latitude, center.longitude, 7, 0),
      userPositive: 7, userNegative: 0, reviewerPositive: 0, reviewerNegative: 0,
      ratingScore: 80, ratingIsStale: true,
    };
    const sevenNegative = {
      ...place("negative", "grill", center.latitude, center.longitude, 0, 7),
      userPositive: 0, userNegative: 7, reviewerPositive: 0, reviewerNegative: 0,
      ratingScore: null, ratingIsStale: false,
    };
    const pairs = rank({ ...input, places: [sevenPositive, sevenNegative, cafe] });
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.score).toBe(pairs[1]?.score);

    const eightVotes = rank({
      ...input,
      places: [
        { ...sevenPositive, positive: 8, userPositive: 8 },
        { ...sevenNegative, negative: 8, userNegative: 8 },
        cafe,
      ],
    });
    expect(eightVotes.map((pair) => pair.first.id)).toEqual(["positive", "negative"]);
  });
});
