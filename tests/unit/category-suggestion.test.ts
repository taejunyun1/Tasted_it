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

  it("maps only the 경양식 subtype to donkatsu", () => {
    expect(classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: "경양식",
      businessName: "동명식당",
    }).categorySlug).toBe("donkatsu-detail");
    expect(classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: "양식",
      businessName: "동명식당",
    }).categorySlug).toBe("pasta");
  });

  it("keeps a concrete western food name above the 경양식 default", () => {
    expect(classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: "경양식",
      businessName: "동명파스타",
    }).categorySlug).toBe("pasta");
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
    "시장꽈배기",
    "오월브레드",
    "동네브래드",
  ])("classifies explicit bakery name %s as bakery", (businessName) => {
    expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName }).categorySlug)
      .toBe("bakery-detail");
  });

  it("does not force the broad term 행복한빵 into bakery", () => {
    const businessName = "행복한빵";
    expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName }).categorySlug)
      .not.toBe("bakery-detail");
  });

  it.each([
    ["남도순대국", "gukbap-detail"],
    ["담양떡갈비", "grill"],
    ["바다아구찜", "seafood-dish"],
    ["연어연구소", "seafood-dish"],
    ["멘야하루", "ramen-detail"],
    ["마라공방", "mala-hotpot"],
    ["오월브런치", "brunch"],
    ["시장순대분식", "tteokbokki"],
    ["서울닭강정", "chicken"],
    ["사이공쌀국수", "vietnamese"],
    ["오늘베이킹", "bakery-detail"],
    ["추억의과자", "bakery-detail"],
    ["달빛빙수", "ice-dessert"],
    ["7080음악주점", "pub"],
    ["초록비건", "vegan"],
  ])("classifies %s as %s", (businessName, expected) => {
    expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName }).categorySlug)
      .toBe(expected);
  });

  it.each(["사과농장", "망고상회", "딸기마켓", "자연어린이집"])(
    "does not infer a food category from ambiguous name %s",
    (businessName) => expect(classifyCandidate({ sourceType: "GENERAL_RESTAURANT", businessName }).confidence)
      .toBe("LOW"),
  );

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
