import { describe, expect, it } from "vitest";
import { parsePublicPlacePage, publicPlacePageHref } from "../../app/features/places/public-place-pagination";

describe("public place pagination", () => {
  it("accepts only one canonical positive safe page number", () => {
    expect(parsePublicPlacePage("")).toBe(1);
    expect(parsePublicPlacePage("?page=2")).toBe(2);
    for (const search of ["?page=0", "?page=-1", "?page=01", "?page=1.5", "?page=no", "?page=", "?page=1&page=2", "?page=9007199254740992"]) {
      expect(parsePublicPlacePage(search)).toBeNull();
    }
  });

  it("keeps all search filters while changing pages and closes the old detail sheet", () => {
    const href = publicPlacePageHref("?q=국밥&category=korean-general&bbox=126.8,35.1,127,35.25&badge=food-gukbap&badge=style-market&temp=1&place=%2Fplaces%2Fold&page=3", 2);
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("q")).toBe("국밥");
    expect(params.get("category")).toBe("korean-general");
    expect(params.get("bbox")).toBe("126.8,35.1,127,35.25");
    expect(params.getAll("badge")).toEqual(["food-gukbap", "style-market"]);
    expect(params.get("temp")).toBe("1");
    expect(params.get("page")).toBe("2");
    expect(params.has("place")).toBe(false);
    expect(new URL(publicPlacePageHref(href.split("?")[1]!, 1), "https://example.test").searchParams.has("page")).toBe(false);
  });
});
