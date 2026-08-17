import { LAUNCH_DEFAULT_CENTER } from "../regions/region-pack";

export type OnboardingLocation = {
  center: { latitude: number; longitude: number };
  bbox: [number, number, number, number];
  mode: "DEVICE" | "DEFAULT";
};

const DEFAULT_CENTER = LAUNCH_DEFAULT_CENTER;
const STORAGE_KEY = "retaste_onboarding_location";
export const ONBOARDING_LOCATION_DECIMAL_PLACES = 3;

function roundOnboardingCoordinate(value: number) {
  const scale = 10 ** ONBOARDING_LOCATION_DECIMAL_PLACES;
  return Math.round(value * scale) / scale;
}

export function minimizeOnboardingBbox(bbox: OnboardingLocation["bbox"]): OnboardingLocation["bbox"] {
  return bbox.map(roundOnboardingCoordinate) as OnboardingLocation["bbox"];
}

export function minimizeOnboardingLocation(location: OnboardingLocation): OnboardingLocation {
  return {
    center: {
      latitude: roundOnboardingCoordinate(location.center.latitude),
      longitude: roundOnboardingCoordinate(location.center.longitude),
    },
    bbox: minimizeOnboardingBbox(location.bbox),
    mode: location.mode,
  };
}

function bboxAround(center: OnboardingLocation["center"], delta = 0.035): OnboardingLocation["bbox"] {
  return [center.longitude - delta, center.latitude - delta, center.longitude + delta, center.latitude + delta];
}

export async function requestOnboardingLocation(): Promise<OnboardingLocation> {
  if (!("geolocation" in navigator)) return defaultOnboardingLocation();
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const center = {
        latitude: roundOnboardingCoordinate(coords.latitude),
        longitude: roundOnboardingCoordinate(coords.longitude),
      };
      const value = minimizeOnboardingLocation({ center, bbox: bboxAround(center), mode: "DEVICE" });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      resolve(value);
    },
    () => resolve(defaultOnboardingLocation()),
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
  ));
}

export function defaultOnboardingLocation(): OnboardingLocation {
  const center = {
    latitude: roundOnboardingCoordinate(DEFAULT_CENTER.latitude),
    longitude: roundOnboardingCoordinate(DEFAULT_CENTER.longitude),
  };
  return minimizeOnboardingLocation({ center, bbox: bboxAround(center), mode: "DEFAULT" });
}

export function readOnboardingLocation(): OnboardingLocation | null {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as OnboardingLocation;
    if (!Array.isArray(value.bbox) || value.bbox.length !== 4) return null;
    if (!value.center || !Number.isFinite(value.center.latitude) || !Number.isFinite(value.center.longitude)) return null;
    if (!value.bbox.every(Number.isFinite)) return null;
    return minimizeOnboardingLocation(value);
  } catch {
    return null;
  }
}
