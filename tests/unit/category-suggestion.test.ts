import { describe, expect, it } from "vitest";
import { suggestCategorySlugs } from "../../app/features/candidates/category-suggestion";

describe("public-data category suggestions", () => {
  it("maps specific business subtypes before broad source defaults", () => {
    expect(suggestCategorySlugs("GENERAL_RESTAURANT", "일식")).toContain("japanese-rice");
    expect(suggestCategorySlugs("GENERAL_RESTAURANT", "한식")).toContain("home-meal");
    expect(suggestCategorySlugs("REST_CAFE", "커피숍")).toContain("cafe");
    expect(suggestCategorySlugs("BAKERY", "제과점영업")).toEqual(["bakery-detail"]);
    expect(suggestCategorySlugs("ENTERTAINMENT_BAR", "호프/통닭")[0]).toBe("chicken");
    expect(suggestCategorySlugs("ENTERTAINMENT_BAR", "호프/통닭")).toContain("pub");
  });
});
