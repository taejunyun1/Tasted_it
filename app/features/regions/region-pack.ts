/**
 * Single source for launch-market region constants (광주·전남).
 *
 * Bbox choice: public map / URL fallback uses `map-state` `DEFAULT_BBOX`
 * `[126.72, 35.03, 127.02, 35.25]`. Default center is the public map
 * constructor/QA pin `[35.1595, 126.8526]`. The active packs govern
 * launch-market collection, suggestions, and course location. Public map
 * browsing also accepts the Jeonbuk viewport in `maps/location-policy`.
 *
 * This module is data only. It does not add a city, table, or binding.
 */

export const REGION_CODES = ["GWANGJU", "JEONNAM"] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export type GeoBounds = {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
};

export type GeoCenter = {
  latitude: number;
  longitude: number;
};

export type Bbox = readonly [west: number, south: number, east: number, north: number];

export type DistrictRef = {
  regionCode: RegionCode;
  name: string;
};

export type RegionPack = {
  code: RegionCode;
  displayName: string;
  bounds: GeoBounds;
  defaultCenter: GeoCenter;
  defaultBbox: Bbox;
  districtSet: ReadonlySet<string>;
  publicDataAddressPrefix: string;
  slugPrefix: string;
  evZcode: "29" | "46";
  naverDailyBudget: number;
  naverSearchEnabled: boolean;
};

export const LAUNCH_DEFAULT_BBOX = [126.72, 35.03, 127.02, 35.25] as const satisfies Bbox;
export const LAUNCH_DEFAULT_CENTER = { latitude: 35.1595, longitude: 126.8526 } as const satisfies GeoCenter;
export const LAUNCH_PUBLIC_DATA_ADDRESS_PREFIX = "전남광주통합특별시";
export const LAUNCH_NAVER_DAILY_BUDGET_TOTAL = 20_000;
const LAUNCH_NAVER_DAILY_BUDGET_PER_PACK = 10_000;

const GWANGJU_DISTRICT_NAMES = ["동구", "서구", "남구", "북구", "광산구"] as const;
const JEONNAM_DISTRICT_NAMES = [
  "목포시", "여수시", "순천시", "나주시", "광양시",
  "담양군", "곡성군", "구례군", "고흥군", "보성군", "화순군",
  "장흥군", "강진군", "해남군", "영암군", "무안군", "함평군",
  "영광군", "장성군", "완도군", "진도군", "신안군",
] as const;

const GWANGJU_DISTRICT_NAME_SET = new Set<string>(GWANGJU_DISTRICT_NAMES);

function prefixedDistrictSet(regionCode: RegionCode, names: readonly string[]) {
  return new Set(names.map((name) => `${regionCode}:${name}`));
}

const GWANGJU_PACK = {
  code: "GWANGJU",
  displayName: "광주",
  bounds: { minLatitude: 34.9, maxLatitude: 35.35, minLongitude: 126.5, maxLongitude: 127.1 },
  defaultCenter: LAUNCH_DEFAULT_CENTER,
  defaultBbox: LAUNCH_DEFAULT_BBOX,
  districtSet: prefixedDistrictSet("GWANGJU", GWANGJU_DISTRICT_NAMES),
  publicDataAddressPrefix: LAUNCH_PUBLIC_DATA_ADDRESS_PREFIX,
  slugPrefix: "",
  evZcode: "29",
  naverDailyBudget: LAUNCH_NAVER_DAILY_BUDGET_PER_PACK,
  naverSearchEnabled: true,
} as const satisfies RegionPack;

const JEONNAM_PACK = {
  code: "JEONNAM",
  displayName: "전남",
  bounds: { minLatitude: 33.85, maxLatitude: 35.55, minLongitude: 125, maxLongitude: 127.85 },
  defaultCenter: LAUNCH_DEFAULT_CENTER,
  defaultBbox: LAUNCH_DEFAULT_BBOX,
  districtSet: prefixedDistrictSet("JEONNAM", JEONNAM_DISTRICT_NAMES),
  publicDataAddressPrefix: LAUNCH_PUBLIC_DATA_ADDRESS_PREFIX,
  slugPrefix: "",
  evZcode: "46",
  naverDailyBudget: LAUNCH_NAVER_DAILY_BUDGET_PER_PACK,
  naverSearchEnabled: true,
} as const satisfies RegionPack;

export const REGION_PACKS: Record<RegionCode, RegionPack> = {
  GWANGJU: GWANGJU_PACK,
  JEONNAM: JEONNAM_PACK,
};

export const ACTIVE_REGION_CODES: readonly RegionCode[] = REGION_CODES;

export function isRegionCode(value: string | null | undefined): value is RegionCode {
  return value === "GWANGJU" || value === "JEONNAM";
}

export function getRegionPack(code: RegionCode): RegionPack {
  return REGION_PACKS[code];
}

export function slugPrefixForRegion(code: RegionCode | null | undefined) {
  return code ? REGION_PACKS[code].slugPrefix : "";
}

export function boundsToBbox(bounds: GeoBounds): [number, number, number, number] {
  return [bounds.minLongitude, bounds.minLatitude, bounds.maxLongitude, bounds.maxLatitude];
}

export function activeMarketBounds(): GeoBounds {
  const packs = ACTIVE_REGION_CODES.map((code) => REGION_PACKS[code]);
  return {
    minLatitude: Math.min(...packs.map((pack) => pack.bounds.minLatitude)),
    maxLatitude: Math.max(...packs.map((pack) => pack.bounds.maxLatitude)),
    minLongitude: Math.min(...packs.map((pack) => pack.bounds.minLongitude)),
    maxLongitude: Math.max(...packs.map((pack) => pack.bounds.maxLongitude)),
  };
}

export function activeMarketBbox(): [number, number, number, number] {
  return boundsToBbox(activeMarketBounds());
}

export function isCoordinateInBounds(bounds: GeoBounds, latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= bounds.minLatitude
    && latitude <= bounds.maxLatitude
    && longitude >= bounds.minLongitude
    && longitude <= bounds.maxLongitude;
}

export function isCoordinateInActiveMarket(latitude: number, longitude: number) {
  return isCoordinateInBounds(activeMarketBounds(), latitude, longitude);
}

export function isCoordinateInPackBounds(code: RegionCode, latitude: number, longitude: number) {
  return isCoordinateInBounds(REGION_PACKS[code].bounds, latitude, longitude);
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

function compactAddress(address: string) {
  return address.trim().replace(/\s+/gu, " ");
}

export function regionFromAddress(address: string | null | undefined): RegionCode | null {
  const raw = compactAddress(address ?? "");
  if (!raw) return null;

  if (/^전남광주(?:통합특별시)?(?=\s|$)/u.test(raw)) {
    const district = raw.split(" ")[1] ?? "";
    if (!district || GWANGJU_DISTRICT_NAME_SET.has(district)) return "GWANGJU";
    return "JEONNAM";
  }

  const normalized = normalizeSupportedRegionAddress(raw);
  if (/^광주(?:광역시)?(?:\s|$)/u.test(normalized)) return "GWANGJU";
  if (/^전라남도(?:\s|$)/u.test(normalized)) return "JEONNAM";
  if (/^전남(?:\s|$)/u.test(normalized)) return "JEONNAM";
  return null;
}

export function isSupportedRegionAddress(address: string) {
  return regionFromAddress(address) != null;
}

export function addressMatchesRegion(address: string, regionCode: RegionCode) {
  return regionFromAddress(address) === regionCode;
}

export function addressLikePatterns(regionCode: RegionCode): string[] {
  if (regionCode === "GWANGJU") {
    return ["광주%", ...GWANGJU_DISTRICT_NAMES.map((name) => `${LAUNCH_PUBLIC_DATA_ADDRESS_PREFIX} ${name}%`)];
  }
  return ["전라남도%", "전남%"];
}

export function extractDistrictRef(address: string): DistrictRef | null {
  const regionCode = regionFromAddress(address);
  if (!regionCode) return null;

  const tokens = compactAddress(address).replace(/[(),]/g, " ").split(" ").filter(Boolean);
  const pack = REGION_PACKS[regionCode];
  const named = tokens.find((token) => pack.districtSet.has(`${regionCode}:${token}`));
  if (named) return { regionCode, name: named };

  if (regionCode === "JEONNAM") {
    const cityOrCounty = tokens.find((token) =>
      /^[가-힣]+(?:시|군)$/u.test(token)
      && !token.endsWith("광역시")
      && !token.endsWith("특별시"),
    );
    if (cityOrCounty) return { regionCode, name: cityOrCounty };
  }

  return null;
}

export function evZcodesForActivePacks() {
  return ACTIVE_REGION_CODES.map((code) => REGION_PACKS[code].evZcode);
}
