import { describe, expect, it } from "vitest";
import { toggleMealCategorySelection } from "../../app/features/courses/course-filter-selection";

describe("course meal category selection", () => {
  it("adds and removes a category", () => {
    expect(toggleMealCategorySelection([], "grill")).toEqual({ values: ["grill"], limitReached: false });
    expect(toggleMealCategorySelection(["grill"], "grill")).toEqual({ values: [], limitReached: false });
  });

  it("keeps the existing two selections when a third is requested", () => {
    expect(toggleMealCategorySelection(["grill", "ramen-detail"], "western-detail")).toEqual({
      values: ["grill", "ramen-detail"],
      limitReached: true,
    });
  });
});
