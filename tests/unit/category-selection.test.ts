import { describe, expect, it } from "vitest";

import { listSelectableCategories, setCandidateCategory } from "../../app/features/candidates/category-selection";

describe("setCandidateCategory", () => {
  it("stores the category value captured by the select change handler", () => {
    expect(setCandidateCategory({ candidate: "old" }, "candidate", "new")).toEqual({ candidate: "new" });
  });

  it("includes a parent category when it has no child categories", () => {
    const categories = [
      { id: "korean", parentId: null },
      { id: "gukbap", parentId: "korean" },
      { id: "chicken", parentId: null },
    ];

    expect(listSelectableCategories(categories).map((category) => category.id)).toEqual(["gukbap", "chicken"]);
  });
});
