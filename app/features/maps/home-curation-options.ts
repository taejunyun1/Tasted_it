import {
  decodeHomeRecommendationHistory,
  type HomeLocationSource,
  type HomeRecommendationHistory,
} from "../places/home-curation-history-codec";
import { DEFAULT_BBOX } from "./map-state";

export type HomeMapView = "curated" | "browse";
export type HomeCurationMode = "now" | "taste" | "time" | "golden" | "discovery";
export type HomeTimeSlot = "breakfast" | "lunch" | "afternoon" | "dinner" | "late";
export type { HomeLocationSource } from "../places/home-curation-history-codec";

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

function recommendationSearchParams(input: string | URL | URLSearchParams) {
  if (input instanceof URL) return input.searchParams;
  return new URLSearchParams(input);
}

export function parseHomeRecommendationRequest(input: string | URL | URLSearchParams): {
  mode: HomeCurationMode;
  bbox: [number, number, number, number];
  center: { latitude: number; longitude: number };
  locationSource: HomeLocationSource;
  history: HomeRecommendationHistory;
} {
  const params = recommendationSearchParams(input);
  const keys = [...params.keys()];
  const validKeys = keys.every((key) => (
    key === "mode" || key === "bbox" || key === "_routes" || key === "history" || key === "locationSource"
  ));
  const modeValues = params.getAll("mode");
  const bboxValues = params.getAll("bbox");
  const routeValues = params.getAll("_routes");
  const historyValues = params.getAll("history");
  const locationSourceValues = params.getAll("locationSource");
  const mode = modeValues[0] as HomeCurationMode | undefined;
  const bboxNumbers = bboxValues[0]?.split(",").map(Number) ?? [...DEFAULT_BBOX];
  const locationSource = locationSourceValues[0] as HomeLocationSource | undefined;

  if (
    !validKeys
    || keys.length < 1
    || modeValues.length !== 1
    || bboxValues.length > 1
    || routeValues.length > 1
    || historyValues.length > 1
    || locationSourceValues.length > 1
    || (routeValues.length === 1 && routeValues[0] !== "routes/home-recommendations-resource")
    || !mode
    || !MODES.has(mode)
    || (locationSource !== undefined && locationSource !== "gps" && locationSource !== "map_center")
    || bboxNumbers.length !== 4
    || bboxNumbers.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("HOME_RECOMMENDATION_REQUEST_INVALID");
  }

  const bbox = bboxNumbers as [number, number, number, number];
  const [west, south, east, north] = bbox;
  if (
    west < 124
    || east > 132
    || south < 33
    || north > 39
    || west >= east
    || south >= north
  ) {
    throw new Error("HOME_RECOMMENDATION_REQUEST_INVALID");
  }

  return {
    mode,
    bbox,
    center: centerOfBbox(bbox),
    locationSource: locationSource ?? "map_center",
    history: decodeHomeRecommendationHistory(historyValues[0]),
  };
}
