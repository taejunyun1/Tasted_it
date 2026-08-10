import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ONBOARDING_LOCATION_DECIMAL_PLACES,
  minimizeOnboardingLocation,
  requestOnboardingLocation,
} from "../../app/features/onboarding/location.client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("onboarding location minimization", () => {
  it("rounds center and bbox to three decimal places before browser-session storage", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("sessionStorage", { getItem: vi.fn(), setItem });
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: { latitude: 35.1234567, longitude: 126.9876543 },
          } as GeolocationPosition);
        },
      },
    });

    const location = await requestOnboardingLocation();

    expect(ONBOARDING_LOCATION_DECIMAL_PLACES).toBe(3);
    expect(location).toEqual({
      center: { latitude: 35.123, longitude: 126.988 },
      bbox: [126.953, 35.088, 127.023, 35.158],
      mode: "DEVICE",
    });
    expect(JSON.parse(setItem.mock.calls[0]![1])).toEqual(location);
  });

  it("minimizes a precise bbox again before URL transfer", () => {
    expect(minimizeOnboardingLocation({
      center: { latitude: 35.1234567, longitude: 126.9876543 },
      bbox: [126.9526543, 35.0884567, 127.0226543, 35.1584567],
      mode: "DEVICE",
    })).toEqual({
      center: { latitude: 35.123, longitude: 126.988 },
      bbox: [126.953, 35.088, 127.023, 35.158],
      mode: "DEVICE",
    });
  });
});
