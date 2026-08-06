import { describe, expect, it } from "vitest";

import { getClusterFocusBounds, getClusterFocusZoom, getMarkerFocusZoom, getMarkerInfluence } from "../../app/features/maps/place-marker-policy";

describe("place marker policy", () => {
  it("derives influence from rating sample boundaries", () => {
    expect(getMarkerInfluence(7, 0)).toBe("base");
    expect(getMarkerInfluence(4, 4)).toBe("medium");
    expect(getMarkerInfluence(12, 12)).toBe("medium");
    expect(getMarkerInfluence(13, 12)).toBe("high");
  });

  it("raises low zoom to 16 and preserves an already close view", () => {
    expect(getMarkerFocusZoom(12)).toBe(16);
    expect(getMarkerFocusZoom(15)).toBe(16);
    expect(getMarkerFocusZoom(16)).toBeNull();
    expect(getMarkerFocusZoom(18)).toBeNull();
  });

  it("moves district clusters to neighborhoods and neighborhoods to places", () => {
    expect(getClusterFocusZoom("DISTRICT")).toBe(13);
    expect(getClusterFocusZoom("NEIGHBORHOOD")).toBe(15);
  });

  it("pads cluster bounds so single-place groups still create a useful viewport", () => {
    expect(getClusterFocusBounds([126.8, 35.1, 126.8, 35.1], "DISTRICT")).toEqual([
      126.76,
      35.07,
      126.84,
      35.13,
    ]);
    expect(getClusterFocusBounds([126.8, 35.1, 126.9, 35.2], "NEIGHBORHOOD")).toEqual([
      126.795,
      35.095,
      126.905,
      35.205,
    ]);
  });
});
