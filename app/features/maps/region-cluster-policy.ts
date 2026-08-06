import type { PlaceSummary } from "../places/place.types";

export type RegionClusterLevel = "DISTRICT" | "NEIGHBORHOOD" | "PLACE";

export interface RegionCluster {
  id: string;
  level: Exclude<RegionClusterLevel, "PLACE">;
  label: string;
  count: number;
  latitude: number;
  longitude: number;
  bounds: [west: number, south: number, east: number, north: number];
  placeIds: string[];
  fallback: boolean;
}

export interface RegionGroup extends RegionCluster {
  places: PlaceSummary[];
}

const GWANGJU_DISTRICTS = new Set(["광산구", "동구", "서구", "남구", "북구"]);
const DISTRICT_FALLBACK_LATITUDE_STEP = 0.072;
const DISTRICT_FALLBACK_LONGITUDE_STEP = 0.088;
const NEIGHBORHOOD_FALLBACK_LATITUDE_STEP = 0.0135;
const NEIGHBORHOOD_FALLBACK_LONGITUDE_STEP = 0.0165;

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function addressTokens(address: string): string[] {
  return normalize(address)
    .replace(/[(),]/g, " ")
    .split(" ")
    .filter(Boolean);
}

export function getRegionClusterLevel(zoom: number): RegionClusterLevel {
  if (zoom <= 12) return "DISTRICT";
  if (zoom <= 14) return "NEIGHBORHOOD";
  return "PLACE";
}

export function extractDistrict(address: string): string | null {
  const tokens = addressTokens(address);
  const gwangjuDistrict = tokens.find((token) => GWANGJU_DISTRICTS.has(token));
  if (gwangjuDistrict) return gwangjuDistrict;

  const cityOrCounty = tokens.find(
    (token) =>
      /^[가-힣]+(?:시|군)$/.test(token) &&
      !token.endsWith("광역시") &&
      !token.endsWith("특별시"),
  );
  return cityOrCounty ?? null;
}

export function extractNeighborhood(
  place: Pick<PlaceSummary, "address" | "neighborhood">,
): string | null {
  const stored = normalize(place.neighborhood);
  if (stored) return stored;

  const parenthesized = [...place.address.matchAll(/\(([^)]+)\)/g)]
    .flatMap((match) => addressTokens(match[1] ?? ""))
    .find((token) => /^[가-힣0-9]+(?:동|읍|면|리)$/.test(token));
  if (parenthesized) return parenthesized;

  return (
    addressTokens(place.address)
      .filter((token) => /^[가-힣0-9]+(?:동|읍|면|리)$/.test(token))
      .at(-1) ?? null
  );
}

function fallbackCell(
  place: PlaceSummary,
  level: Exclude<RegionClusterLevel, "PLACE">,
): string {
  const latitudeStep =
    level === "DISTRICT" ? DISTRICT_FALLBACK_LATITUDE_STEP : NEIGHBORHOOD_FALLBACK_LATITUDE_STEP;
  const longitudeStep =
    level === "DISTRICT" ? DISTRICT_FALLBACK_LONGITUDE_STEP : NEIGHBORHOOD_FALLBACK_LONGITUDE_STEP;
  return `${Math.floor(place.latitude / latitudeStep)}:${Math.floor(place.longitude / longitudeStep)}`;
}

function aggregate(
  id: string,
  level: Exclude<RegionClusterLevel, "PLACE">,
  label: string,
  places: PlaceSummary[],
  fallback: boolean,
): RegionGroup {
  const latitudes = places.map((place) => place.latitude);
  const longitudes = places.map((place) => place.longitude);
  return {
    id,
    level,
    label: fallback ? `주변 ${places.length}곳` : label,
    count: places.length,
    latitude: latitudes.reduce((sum, value) => sum + value, 0) / places.length,
    longitude: longitudes.reduce((sum, value) => sum + value, 0) / places.length,
    bounds: [
      Math.min(...longitudes),
      Math.min(...latitudes),
      Math.max(...longitudes),
      Math.max(...latitudes),
    ],
    placeIds: places.map((place) => place.id),
    places,
    fallback,
  };
}

export function buildRegionGroups(places: PlaceSummary[], zoom: number): RegionGroup[] {
  const level = getRegionClusterLevel(zoom);
  if (level === "PLACE") return [];

  const buckets = new Map<string, { label: string; fallback: boolean; places: PlaceSummary[] }>();
  for (const place of places) {
    const district = extractDistrict(place.address);
    const neighborhood = level === "NEIGHBORHOOD" ? extractNeighborhood(place) : null;
    const regionLabel = level === "DISTRICT" ? district : neighborhood;
    const parent = level === "NEIGHBORHOOD" ? district ?? "UNKNOWN" : "";
    const fallback = !regionLabel;
    const key = fallback
      ? `FALLBACK:${fallbackCell(place, level)}`
      : level === "DISTRICT"
        ? regionLabel
        : `${parent}:${regionLabel}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.places.push(place);
    } else {
      buckets.set(key, { label: regionLabel ?? "", fallback, places: [place] });
    }
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => aggregate(`${level}:${key}`, level, bucket.label, bucket.places, bucket.fallback))
    .sort((left, right) => left.label.localeCompare(right.label, "ko"));
}

export function buildRegionClusters(places: PlaceSummary[], zoom: number): RegionCluster[] {
  return buildRegionGroups(places, zoom).map(({ places: _places, ...cluster }) => cluster);
}
