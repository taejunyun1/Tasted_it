import { describe, expect, it } from "vitest";

import { getMarkerFocusZoom, getMarkerInfluence } from "../../app/features/maps/place-marker-policy";

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
});
