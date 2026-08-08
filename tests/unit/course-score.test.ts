import { describe, expect, it } from "vitest";
import { rankCoursePairs } from "../../app/features/courses/course-score";

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
