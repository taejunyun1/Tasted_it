import { describe, expect, it } from "vitest";

import { DEFAULT_BBOX, parseMapState } from "../../app/features/maps/map-state";

describe("map URL state", () => {
  it("parses valid bounds, selection, query, and view", () => {
    expect(
      parseMapState(
        "?bbox=126.80,35.05,127.05,35.25&selected=place-1&q=%EB%9D%BC%EB%A9%B4&view=list",
      ),
    ).toEqual({
      bbox: [126.8, 35.05, 127.05, 35.25],
      selected: "place-1",
      query: "라면",
      view: "list",
    });
  });

  it("falls back to Gwangju bounds and map view for invalid state", () => {
    expect(parseMapState("?bbox=broken&view=tiles")).toMatchObject({
      bbox: DEFAULT_BBOX,
      selected: null,
      view: "map",
    });
  });
});
