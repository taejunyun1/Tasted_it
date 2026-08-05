import { describe, expect, it } from "vitest";
import { findSelectedPlace, updateMapSearch } from "../../app/features/maps/map-selection";
import type { PlaceSummary } from "../../app/features/places/place.types";

const place = { id: "place-1", name: "테스트 식당" } as PlaceSummary;

describe("map selection", () => {
  it("finds the selected place in the current results", () => {
    expect(findSelectedPlace([place], "place-1")).toBe(place);
  });

  it("returns null when the selected place is outside the current results", () => {
    expect(findSelectedPlace([place], "missing")).toBeNull();
  });

  it("preserves map filters while clearing a selection", () => {
    const next = updateMapSearch(
      new URLSearchParams("bbox=1,2,3,4&q=국밥&category=gukbap&selected=place-1"),
      { selected: null },
    );

    expect(next.get("bbox")).toBe("1,2,3,4");
    expect(next.get("q")).toBe("국밥");
    expect(next.get("category")).toBe("gukbap");
    expect(next.has("selected")).toBe(false);
  });

  it("clears selection when a search condition changes", () => {
    const next = updateMapSearch(
      new URLSearchParams("bbox=1,2,3,4&selected=place-1"),
      { q: "라멘", selected: null },
    );

    expect(next.get("q")).toBe("라멘");
    expect(next.has("selected")).toBe(false);
    expect(next.get("bbox")).toBe("1,2,3,4");
  });
});
