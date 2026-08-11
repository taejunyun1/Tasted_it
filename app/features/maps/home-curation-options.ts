export type HomeMapView = "curated" | "browse";
export type HomeCurationMode = "now" | "taste" | "time" | "golden" | "discovery";
export type HomeTimeSlot = "breakfast" | "lunch" | "afternoon" | "dinner" | "late";

const MODES = new Set<HomeCurationMode>(["now", "taste", "time", "golden", "discovery"]);

export function parseHomeCurationState(search: string): {
  view: HomeMapView;
  mode: HomeCurationMode;
} {
  const params = new URLSearchParams(search);
  const requestedMode = params.get("mode") as HomeCurationMode | null;
  const hasBrowseIntent = params.get("view") === "browse"
    || Boolean(params.get("category"))
    || Boolean(params.get("q")?.trim());

  return {
    view: hasBrowseIntent ? "browse" : "curated",
    mode: requestedMode && MODES.has(requestedMode) ? requestedMode : "now",
  };
}

export function homeTimeSlotAt(now: Date): HomeTimeSlot {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const total = hour * 60 + minute;

  if (total >= 300 && total < 630) return "breakfast";
  if (total >= 630 && total < 870) return "lunch";
  if (total >= 870 && total < 1_050) return "afternoon";
  if (total >= 1_050 && total < 1_290) return "dinner";
  return "late";
}

export function homeTimeSlotLabel(slot: HomeTimeSlot) {
  return {
    breakfast: "아침",
    lunch: "점심",
    afternoon: "오후",
    dinner: "저녁",
    late: "늦은 시간",
  }[slot];
}

export function centerOfBbox([west, south, east, north]: [number, number, number, number]) {
  return {
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
  };
}
