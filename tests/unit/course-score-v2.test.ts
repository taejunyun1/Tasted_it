import { describe, expect, it } from "vitest";
import { rankCoursePairsV2 } from "../../app/features/courses/course-score";

const place = (id: string, slug: string, latitude: number, positive = 8, negative = 0) => ({
  id, slug: id, name: id, address: "광주광역시", neighborhood: "동구", latitude, longitude: 126.85, heroImageUrl: null,
  primaryCategory: { slug, name: slug, emoji: "🍽️" }, positive, negative,
});
const context = (primaryCategorySlug: string, availability: "OPEN" | "CLOSED" | "UNKNOWN", traits: string[] = []) => ({ primaryCategorySlug, secondaryCategorySlugs: [], availability, traits });

describe("course score v2", () => {
  it("prefers quality and confirmed opening over a closer unknown low-sample option", () => {
    const goodMeal = place("good", "grill", 35.16, 20, 1);
    const nearMeal = place("near", "grill", 35.1502, 1, 0);
    const cafe = place("cafe", "cafe", 35.161, 20, 1);
    const ranked = rankCoursePairsV2({
      places: [goodMeal, nearMeal, cafe],
      contexts: new Map([["good", context("grill", "OPEN", ["soloFriendly"])], ["near", context("grill", "UNKNOWN")], ["cafe", context("cafe", "OPEN", ["dessert"])] ]),
      center: { latitude: 35.15, longitude: 126.85 }, mealCategories: ["grill"], second: "cafe", radiusKm: 3, resolvedTime: "dinner", timeWasAuto: false,
    });
    expect(ranked[0]?.first.id).toBe("good");
    expect(ranked[0]?.badges).toContain("지금 영업 중");
  });

  it("hard-excludes known closed places and keeps an unknown-hours notice", () => {
    const meal = place("meal", "grill", 35.15, 10, 0);
    const closedCafe = place("closed", "cafe", 35.151, 10, 0);
    const unknownCafe = place("unknown", "cafe", 35.152, 10, 0);
    const ranked = rankCoursePairsV2({
      places: [meal, closedCafe, unknownCafe],
      contexts: new Map([["meal", context("grill", "OPEN")], ["closed", context("cafe", "CLOSED")], ["unknown", context("cafe", "UNKNOWN")]]),
      center: { latitude: 35.15, longitude: 126.85 }, mealCategories: [], second: "cafe", radiusKm: 3, resolvedTime: "dinner", timeWasAuto: true,
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.second.id).toBe("unknown");
    expect(ranked[0]?.badges).toContain("영업시간 확인 필요");
  });
});
