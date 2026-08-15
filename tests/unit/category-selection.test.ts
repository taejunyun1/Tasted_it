import { describe, expect, it } from "vitest";

import { getTerminalCategoryIds, listSelectableCategories, setCandidateCategories, setCandidateCategory } from "../../app/features/candidates/category-selection";

describe("setCandidateCategory", () => {
  it("stores the category value captured by the select change handler", () => {
    expect(setCandidateCategory({ candidate: "old" }, "candidate", "new")).toEqual({ candidate: "new" });
  });

  it("applies one category to every selected candidate without changing unselected values", () => {
    expect(setCandidateCategories(
      { first: "old", second: "other", untouched: "keep" },
      new Set(["first", "second"]),
      "new",
    )).toEqual({ first: "new", second: "new", untouched: "keep" });
  });

  it("includes a parent category when it has no child categories", () => {
    const categories = [
      { id: "korean", parentId: null },
      { id: "gukbap", parentId: "korean" },
      { id: "chicken", parentId: null },
    ];

    expect(listSelectableCategories(categories).map((category) => category.id)).toEqual(["gukbap", "chicken"]);
    expect([...getTerminalCategoryIds(categories)]).toEqual(["gukbap", "chicken"]);
  });
});
