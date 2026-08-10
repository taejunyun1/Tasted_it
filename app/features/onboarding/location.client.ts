export type OnboardingLocation = {
  center: { latitude: number; longitude: number };
  bbox: [number, number, number, number];
  mode: "DEVICE" | "DEFAULT";
};

const DEFAULT_CENTER = { latitude: 35.1601, longitude: 126.8514 };
const STORAGE_KEY = "retaste_onboarding_location";

function bboxAround(center: OnboardingLocation["center"], delta = 0.035): OnboardingLocation["bbox"] {
  return [center.longitude - delta, center.latitude - delta, center.longitude + delta, center.latitude + delta];
}

export async function requestOnboardingLocation(): Promise<OnboardingLocation> {
  if (!("geolocation" in navigator)) return defaultOnboardingLocation();
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const center = { latitude: coords.latitude, longitude: coords.longitude };
      const value = { center, bbox: bboxAround(center), mode: "DEVICE" as const };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      resolve(value);
    },
    () => resolve(defaultOnboardingLocation()),
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
  ));
}

export function defaultOnboardingLocation(): OnboardingLocation {
  return { center: DEFAULT_CENTER, bbox: bboxAround(DEFAULT_CENTER), mode: "DEFAULT" };
}

export function readOnboardingLocation(): OnboardingLocation | null {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as OnboardingLocation;
    if (!Array.isArray(value.bbox) || value.bbox.length !== 4) return null;
    return value;
  } catch {
    return null;
  }
}
