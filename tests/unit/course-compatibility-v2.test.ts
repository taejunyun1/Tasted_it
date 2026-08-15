import { describe, expect, it } from "vitest";
import { courseCompatibilityV2 } from "../../app/features/courses/course-compatibility-v2";

const context = (primaryCategorySlug: string, secondaryCategorySlugs: string[] = []) => ({ primaryCategorySlug, secondaryCategorySlugs, traits: [], availability: "UNKNOWN" as const });

describe("course compatibility v2", () => {
  it("orders exact, direct, family, adjacent and unrelated matches", () => {
    expect(courseCompatibilityV2(context("grill"), context("grill"))).toBe(100);
    expect(courseCompatibilityV2(context("grill", ["home-meal"]), context("home-meal"))).toBe(90);
    expect(courseCompatibilityV2(context("grill"), context("gukbap-detail"))).toBe(70);
    expect(courseCompatibilityV2(context("ramen-detail"), context("udon"))).toBe(40);
    expect(courseCompatibilityV2(context("grill"), context("cafe"))).toBe(0);
  });
});
