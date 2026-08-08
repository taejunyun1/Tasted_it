import { describe, expect, it } from "vitest";
import { classifyCandidate, suggestCategorySlugs } from "../../app/features/candidates/category-suggestion";

describe("public-data category suggestions", () => {
  it("maps specific business subtypes before broad source defaults", () => {
    expect(suggestCategorySlugs("GENERAL_RESTAURANT", "일식")).toContain("japanese-rice");
    expect(suggestCategorySlugs("GENERAL_RESTAURANT", "한식")).toContain("home-meal");
    expect(suggestCategorySlugs("REST_CAFE", "커피숍")).toContain("cafe");
    expect(suggestCategorySlugs("BAKERY", "제과점영업")).toEqual(["bakery-detail"]);
    expect(suggestCategorySlugs("ENTERTAINMENT_BAR", "호프/통닭")[0]).toBe("chicken");
    expect(suggestCategorySlugs("ENTERTAINMENT_BAR", "호프/통닭")).toContain("pub");
  });

  it.each([
    "행복제과점",
    "우리동네제빵소",
    "광주제과제빵",
    "아침식빵연구소",
    "달빛케이크",
    "오월도넛",
    "시장도너츠",
    "프렌치크루아상",
    "버터쿠키",
    "목포과자점",
    "파리바게뜨 중흥점",
    "파리바게트 연제점",
    "빵쇼핑",
  ])("classifies explicit bakery name %s as bakery", (businessName) => {
    expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName }).categorySlug)
      .toBe("bakery-detail");
  });

  it.each(["행복한빵", "추억의과자"])("does not force broad term %s into bakery", (businessName) => {
    expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName }).categorySlug)
      .not.toBe("bakery-detail");
  });

  it("prioritizes explicit bakery products over cafe and dessert wording", () => {
    expect(classifyCandidate({ sourceType: "REST_CAFE", businessName: "오월베이커리카페" }).categorySlug)
      .toBe("bakery-detail");
    expect(classifyCandidate({ sourceType: "REST_CAFE", businessName: "달빛케이크디저트" }).categorySlug)
      .toBe("bakery-detail");
  });

  it("raises confidence when a bakery name and subtype support each other", () => {
    expect(classifyCandidate({
      sourceType: "BAKERY",
      businessSubtype: "제과점영업",
      businessName: "우리동네제빵소",
    })).toMatchObject({ categorySlug: "bakery-detail", confidence: "HIGH" });
  });

  it("keeps explicit sushi wording in Japanese while routing sashimi to seafood", () => {
    expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName: "스시하루" }).categorySlug)
      .toBe("sushi-sashimi");
    expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName: "바다횟집" }).categorySlug)
      .toBe("seafood-dish");
  });
});
