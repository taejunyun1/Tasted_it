export type CourseTime = "auto" | "lunch" | "afternoon" | "dinner" | "late";
export type CourseSecond = "cafe" | "dessert";
export type CourseParkingMode = "auto" | "shared" | "separate";
export type CourseEv = "none" | "preferred" | "required";
export type CourseWeather = "normal" | "rain";

export interface CourseOptions {
  time: CourseTime;
  mealCategory: string;
  second: CourseSecond;
  radiusKm: 1 | 3 | 5 | 8;
  parkingMode: CourseParkingMode;
  ev: CourseEv;
  weather: CourseWeather;
  child: boolean;
}

export interface CourseContext {
  latitude: number;
  longitude: number;
  locationSource: "USER" | "DEFAULT";
  resolvedTime: Exclude<CourseTime, "auto">;
}

const DEFAULT_LOCATION = { latitude: 35.1601, longitude: 126.8514 };
const allowed = <T extends string>(value: string | null, values: readonly T[], fallback: T): T => values.includes(value as T) ? value as T : fallback;

function resolvedTime(now: Date): CourseContext["resolvedTime"] {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour >= 11 && hour < 14) return "lunch";
  if (hour >= 14 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "dinner";
  return "late";
}

export function parseCourseOptions(search: string, now = new Date()) {
  const params = new URLSearchParams(search);
  const rawLat = Number(params.get("lat"));
  const rawLng = Number(params.get("lng"));
  const hasUserLocation = Number.isFinite(rawLat) && Number.isFinite(rawLng)
    && rawLat >= 33 && rawLat <= 39 && rawLng >= 124 && rawLng <= 132;
  const time = allowed(params.get("time"), ["auto", "lunch", "afternoon", "dinner", "late"] as const, "auto");
  const rawRadius = Number(params.get("radiusKm"));
  const radiusKm: CourseOptions["radiusKm"] = ([1, 3, 5, 8] as const).includes(rawRadius as CourseOptions["radiusKm"])
    ? rawRadius as CourseOptions["radiusKm"]
    : 3;
  const options: CourseOptions = {
    time,
    mealCategory: /^[a-z0-9-]{1,80}$/.test(params.get("mealCategory") ?? "") ? params.get("mealCategory")! : "all",
    second: allowed(params.get("second"), ["cafe", "dessert"] as const, "cafe"),
    radiusKm,
    parkingMode: allowed(params.get("parkingMode"), ["auto", "shared", "separate"] as const, "auto"),
    ev: allowed(params.get("ev"), ["none", "preferred", "required"] as const, "none"),
    weather: allowed(params.get("weather"), ["normal", "rain"] as const, "normal"),
    child: params.get("child") === "1",
  };
  return {
    hasSelection: params.get("apply") === "1" || ["time", "mealCategory", "second", "radiusKm", "parkingMode", "ev", "weather", "child"].some((key) => params.has(key)),
    options,
    context: {
      latitude: hasUserLocation ? rawLat : DEFAULT_LOCATION.latitude,
      longitude: hasUserLocation ? rawLng : DEFAULT_LOCATION.longitude,
      locationSource: hasUserLocation ? "USER" as const : "DEFAULT" as const,
      resolvedTime: time === "auto" ? resolvedTime(now) : time,
    },
  };
}

export function toCourseSearchParams(options: CourseOptions) {
  const params = new URLSearchParams({
    apply: "1",
    time: options.time,
    mealCategory: options.mealCategory,
    second: options.second,
    radiusKm: String(options.radiusKm),
    parkingMode: options.parkingMode,
    ev: options.ev,
    weather: options.weather,
    child: options.child ? "1" : "0",
  });
  return params;
}
