import { describe, expect, it } from "vitest";
import { parseCourseOptions, toCourseSearchParams } from "../../app/features/courses/course-options";

describe("course options", () => {
  it("does not recommend before the user applies conditions", () => {
    const parsed = parseCourseOptions("", new Date("2026-08-08T05:00:00Z"));
    expect(parsed.hasSelection).toBe(false);
    expect(parsed.context.locationSource).toBe("DEFAULT");
  });

  it("normalizes enums, radius and coordinates", () => {
    const parsed = parseCourseOptions("time=dinner&mealCategory=grill&second=dessert&radiusKm=5&parkingMode=shared&ev=required&weather=rain&child=1&lat=35.15&lng=126.85", new Date("2026-08-08T05:00:00Z"));
    expect(parsed).toMatchObject({
      hasSelection: true,
      options: { time: "dinner", mealCategories: ["grill"], second: "dessert", radiusKm: 5, parkingMode: "shared", ev: "required", weather: "rain", child: true },
      context: { latitude: 35.15, longitude: 126.85, locationSource: "USER" },
    });
  });

  it("deduplicates repeated meal categories and keeps at most two", () => {
    const parsed = parseCourseOptions("apply=1&mealCategory=grill&mealCategory=grill&mealCategory=ramen-detail&mealCategory=invalid_value", new Date("2026-08-08T05:00:00Z"));
    expect(parsed.options.mealCategories).toEqual(["grill", "ramen-detail"]);
  });

  it("serializes selected meal categories as repeated URL parameters", () => {
    const parsed = parseCourseOptions("apply=1&mealCategory=grill&mealCategory=ramen-detail", new Date("2026-08-08T05:00:00Z"));
    expect(toCourseSearchParams(parsed.options).getAll("mealCategory")).toEqual(["grill", "ramen-detail"]);
  });

  it("keeps legacy mealCategory=all links as an all-meals selection", () => {
    expect(parseCourseOptions("apply=1&mealCategory=all").options.mealCategories).toEqual([]);
  });

  it("maps auto time and serializes a stable query", () => {
    const parsed = parseCourseOptions("apply=1", new Date("2026-08-08T05:00:00Z"));
    expect(parsed.context.resolvedTime).toBe("afternoon");
    expect(toCourseSearchParams(parsed.options).toString()).toContain("apply=1");
  });
});
