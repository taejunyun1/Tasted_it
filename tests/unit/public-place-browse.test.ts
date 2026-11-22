import { describe, expect, it } from "vitest";
import { publicPlaceBrowseHref, readPublicPlaceBrowse, updatePublicPlaceBrowseSearch } from "../../app/features/places/public-place-browse";

const bbox = "126.9,35.14,126.93,35.16";
const search = `?q=라멘&category=ramen-detail&bbox=${bbox}&badge=food-ramen&badge=style-market&page=2&selected=sample-place-1&place=%2Fplaces%2Fsample&mode=golden&qa=1`;

describe("public place collection links", () => {
  it("opens the filtered map even without a search term or category", () => {
    expect(publicPlaceBrowseHref("map", "")).toBe("/?view=browse");
    expect(new URL(publicPlaceBrowseHref("map", `?bbox=${bbox}`), "https://example.test").searchParams.get("bbox")).toBe(bbox);
  });

  it("preserves collection filters and a verified selection across a round trip", () => {
    const map = new URL(publicPlaceBrowseHref("map", search, { selected: "sample-place-1" }), "https://example.test");
    const list = new URL(publicPlaceBrowseHref("list", map.search, { selected: "sample-place-1" }), "https://example.test");
    expect(map.searchParams.get("view")).toBe("browse");
    expect(list.pathname).toBe("/places");
    expect([...list.searchParams]).toEqual([
      ["q", "라멘"], ["category", "ramen-detail"], ["bbox", bbox], ["badge", "food-ramen"], ["badge", "style-market"],
      ["page", "2"], ["selected", "sample-place-1"], ["qa", "1"],
    ]);
  });

  it("strips a stale or unverified selection and recovers an invalid page on the map link", () => {
    const href = publicPlaceBrowseHref("map", "?page=2&page=0&selected=hidden&temp=1");
    expect(href).toBe("/?view=browse&temp=1");
    expect(readPublicPlaceBrowse(href.slice(1)).filters).toMatchObject({ tempOnly: true, bbox: undefined });
  });
});

describe("map result pages", () => {
  it("keeps its page when only selection or numeric bbox formatting changes", () => {
    const next = updatePublicPlaceBrowseSearch(new URLSearchParams(search), { selected: "sample-place-2", bbox: "126.90,35.140,126.93,35.16" });
    expect(next.get("page")).toBe("2");
    expect(next.get("selected")).toBe("sample-place-2");
  });

  it.each([{ bbox: "126.9,35.14,126.95,35.17" }, { category: null }, { q: "국밥" }])("resets the result page when a filter changes to %o", (change) => {
    const next = updatePublicPlaceBrowseSearch(new URLSearchParams(search), change);
    expect(next.get("view")).toBe("browse");
    expect(next.has("page")).toBe(false);
    expect(next.has("place")).toBe(false);
    expect(next.getAll("badge")).toEqual(["food-ramen", "style-market"]);
  });

  it("keeps the TEMP result page on a pan because TEMP is not bounded by the viewport", () => {
    const next = updatePublicPlaceBrowseSearch(new URLSearchParams(`${search}&temp=1`), { bbox: "126.9,35.14,126.95,35.17" });
    expect(next.get("page")).toBe("2");
  });
});
