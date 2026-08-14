import { distanceInMeters } from "../places/place-discovery";

export type PlaceCoordinate = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type GeocodedPlaceCandidate = Readonly<{
  address: string;
  roadAddress: string | null;
  jibunAddress: string | null;
  neighborhood: string | null;
  coordinate: PlaceCoordinate;
}>;

export type NaverGeocodeAddress = Readonly<{
  roadAddress?: string | null;
  jibunAddress?: string | null;
  x?: string | number | null;
  y?: string | number | null;
}>;

export type PlaceLocationValidation =
  | Readonly<{ ok: true; coordinate: PlaceCoordinate }>
  | Readonly<{
    ok: false;
    code: "LOCATION_REQUIRED" | "LOCATION_OUT_OF_SCOPE" | "LOCATION_TOO_FAR_FROM_ADDRESS";
  }>;

const SUPPORTED_BOUNDS = {
  minLatitude: 33,
  maxLatitude: 36.2,
  minLongitude: 125,
  maxLongitude: 128.2,
} as const;
const MAX_PIN_ADJUSTMENT_METERS = 2_000;

function compactText(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/\s+/gu, " ");
  return trimmed || null;
}

function isCoordinateInSupportedBounds({ latitude, longitude }: PlaceCoordinate) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= SUPPORTED_BOUNDS.minLatitude
    && latitude <= SUPPORTED_BOUNDS.maxLatitude
    && longitude >= SUPPORTED_BOUNDS.minLongitude
    && longitude <= SUPPORTED_BOUNDS.maxLongitude;
}

export function isSupportedRegionAddress(address: string) {
  const normalized = compactText(normalizeSupportedRegionAddress(address));
  return normalized !== null && /^(?:광주(?:광역시)?|전라남도|전남(?:\s|$)|전남광주통합특별시)/u.test(normalized);
}

/**
 * Some legacy public-data rows use `전남광주` for a Gwangju address.
 * Convert only that leading administrative prefix so map lookup and server
 * validation share the same canonical value. All other address text remains
 * unchanged.
 */
export function normalizeSupportedRegionAddress(address: string) {
  return address.trim().replace(/^전남광주(?:통합특별시)?(?=\s|$)/u, "광주광역시");
}

export function extractPlaceNeighborhood(address: string | null | undefined) {
  if (!address) return null;
  const isNeighborhood = (token: string) => /(?:동|읍|면|리)$/u.test(token);
  const parenthesized = [...address.matchAll(/\(([^)]*)\)/gu)]
    .flatMap((match) => match[1].split(/[·,\s]+/u))
    .find(isNeighborhood);
  if (parenthesized) return parenthesized;
  const tokens = address.split(/[·,()\s]+/u).filter(isNeighborhood);
  return tokens.find((token) => token.endsWith("리")) ?? tokens.at(-1) ?? null;
}

export function validatePlaceCoordinate(coordinate: PlaceCoordinate): PlaceLocationValidation {
  if (!isCoordinateInSupportedBounds(coordinate)) {
    return { ok: false, code: "LOCATION_OUT_OF_SCOPE" };
  }

  return { ok: true, coordinate };
}

export function validateAdjustedCoordinate(
  origin: PlaceCoordinate,
  adjusted: PlaceCoordinate,
): PlaceLocationValidation {
  const originValidation = validatePlaceCoordinate(origin);
  const adjustedValidation = validatePlaceCoordinate(adjusted);
  if (!originValidation.ok || !adjustedValidation.ok) {
    return { ok: false, code: "LOCATION_OUT_OF_SCOPE" };
  }

  if (distanceInMeters(origin, adjusted) > MAX_PIN_ADJUSTMENT_METERS) {
    return { ok: false, code: "LOCATION_TOO_FAR_FROM_ADDRESS" };
  }

  return { ok: true, coordinate: adjusted };
}

function toGeocodedCandidate(item: NaverGeocodeAddress): GeocodedPlaceCandidate | null {
  const roadAddress = compactText(item.roadAddress);
  const jibunAddress = compactText(item.jibunAddress);
  const address = roadAddress ?? jibunAddress;
  const latitude = Number(item.y);
  const longitude = Number(item.x);
  const validation = validatePlaceCoordinate({ latitude, longitude });

  if (!address || !isSupportedRegionAddress(address) || !validation.ok) return null;

  return {
    address,
    roadAddress,
    jibunAddress,
    neighborhood: extractPlaceNeighborhood(jibunAddress ?? address),
    coordinate: validation.coordinate,
  };
}

export function normalizeGeocodeCandidates(items: readonly NaverGeocodeAddress[]): GeocodedPlaceCandidate[] {
  const seen = new Set<string>();

  return items
    .map((item, index) => ({ candidate: toGeocodedCandidate(item), index }))
    .filter((entry): entry is { candidate: GeocodedPlaceCandidate; index: number } => entry.candidate !== null)
    .sort((left, right) => (
      Number(left.candidate.roadAddress === null) - Number(right.candidate.roadAddress === null)
      || left.index - right.index
    ))
    .flatMap(({ candidate }) => {
      const key = [
        candidate.roadAddress ?? "",
        candidate.jibunAddress ?? "",
        candidate.coordinate.latitude.toFixed(6),
        candidate.coordinate.longitude.toFixed(6),
      ].join("|");
      if (seen.has(key)) return [];
      seen.add(key);
      return [candidate];
    })
    .slice(0, 5);
}
