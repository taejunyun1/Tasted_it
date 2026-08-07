import { describe, expect, it } from "vitest";

import { DEFAULT_BBOX } from "../../app/features/maps/map-state";
import {
  OUTSIDE_SERVICE_AREA_MESSAGE,
  resolveLocationViewport,
} from "../../app/features/maps/location-policy";

describe("map location policy", () => {
  it.each([
    { name: "Seoul", latitude: 37.5665, longitude: 126.978 },
    { name: "Jeonju", latitude: 35.8242, longitude: 127.148 },
    { name: "Jeju", latitude: 33.4996, longitude: 126.5312 },
  ])("falls back to Gwangju for $name outside the service area", ({ latitude, longitude }) => {
    expect(resolveLocationViewport({ latitude, longitude })).toEqual({
      bbox: [...DEFAULT_BBOX],
      notice: OUTSIDE_SERVICE_AREA_MESSAGE,
    });
  });

  it.each([
    { name: "Gwangju", latitude: 35.1595, longitude: 126.8526 },
    { name: "Yeosu", latitude: 34.7604, longitude: 127.6622 },
  ])("keeps $name locations centered on the current position", ({ latitude, longitude }) => {
    const result = resolveLocationViewport({ latitude, longitude });

    expect(result.notice).toBeNull();
    expect(result.bbox).toEqual([
      longitude - 0.025,
      latitude - 0.018,
      longitude + 0.025,
      latitude + 0.018,
    ]);
  });
});
