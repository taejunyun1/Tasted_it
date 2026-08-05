import proj4 from "proj4";

export const publicDataSources = {
  GENERAL_RESTAURANT: "https://apis.data.go.kr/1741000/general_restaurants/info",
  REST_CAFE: "https://apis.data.go.kr/1741000/rest_cafes/info",
  BAKERY: "https://apis.data.go.kr/1741000/bakeries/info",
  ENTERTAINMENT_BAR: "https://apis.data.go.kr/1741000/entertainment_bars/info",
} as const;

export type PublicDataSource = keyof typeof publicDataSources;
export type NormalizedBusinessStatus = "OPEN" | "TEMPORARILY_CLOSED" | "CLOSED" | "UNKNOWN";
export type RegionCode = "GWANGJU" | "JEONNAM";

export interface NormalizedLicense {
  sourceType: PublicDataSource;
  sourceManagementNo: string;
  businessName: string;
  businessSubtype: string | null;
  salesStatusCode: string | null;
  salesStatusName: string | null;
  detailStatusCode: string | null;
  detailStatusName: string | null;
  normalizedStatus: NormalizedBusinessStatus;
  lotAddress: string | null;
  roadAddress: string | null;
  phone: string | null;
  sourceX: number | null;
  sourceY: number | null;
  latitude: number | null;
  longitude: number | null;
  regionCode: RegionCode;
  sourceUpdatedAt: string | null;
  rawPayload: string;
}

const EPSG5174 = "+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-146.43,507.89,681.46 +units=m +no_defs";

export function sourceCoordinatesToWgs84(x: number | null, y: number | null) {
  if (x == null || y == null) return { latitude: null, longitude: null };
  const [longitude, latitude] = proj4(EPSG5174, "EPSG:4326", [x, y]);
  if (latitude < 33 || latitude > 39 || longitude < 124 || longitude > 132) {
    return { latitude: null, longitude: null };
  }
  return { latitude, longitude };
}

function decodeServiceKey(value: string) {
  try {
    return /%[0-9a-f]{2}/i.test(value) ? decodeURIComponent(value) : value;
  } catch {
    return value;
  }
}

export function buildPublicDataUrl(input: {
  baseUrl: string;
  serviceKey: string;
  pageNo: number;
  addressField: "ROAD_NM_ADDR" | "LOTNO_ADDR";
  addressPrefix: string;
  numOfRows?: number;
}) {
  const url = new URL(input.baseUrl);
  url.searchParams.set("serviceKey", decodeServiceKey(input.serviceKey.trim()));
  url.searchParams.set("pageNo", String(input.pageNo));
  url.searchParams.set("numOfRows", String(input.numOfRows ?? 100));
  url.searchParams.set("type", "json");
  url.searchParams.set(`cond[${input.addressField}::LIKE]`, `${input.addressPrefix}%`);
  return url;
}

export function normalizeBusinessStatus(
  salesCode: string | null | undefined,
  salesName: string | null | undefined,
  detailCode: string | null | undefined,
  detailName: string | null | undefined,
): NormalizedBusinessStatus {
  const joined = `${salesName ?? ""} ${detailName ?? ""}`;
  if (/폐업|취소|말소/.test(joined) || salesCode === "03") return "CLOSED";
  if (/휴업/.test(joined)) return "TEMPORARILY_CLOSED";
  if (/영업|정상/.test(joined) && salesCode !== "03" && detailCode !== "02") return "OPEN";
  return "UNKNOWN";
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return value !== "" && value != null && Number.isFinite(number) ? number : null;
}

export function regionFromAddress(address: string | null | undefined): RegionCode | null {
  const value = address?.trim() ?? "";
  if (value.startsWith("광주광역시")) return "GWANGJU";
  if (value.startsWith("전라남도")) return "JEONNAM";
  if (value.startsWith("전남광주통합특별시")) {
    const district = value.split(/\s+/)[1] ?? "";
    return ["동구", "서구", "남구", "북구", "광산구"].includes(district) ? "GWANGJU" : "JEONNAM";
  }
  return null;
}

export function normalizePublicDataItem(
  sourceType: PublicDataSource,
  item: Record<string, unknown>,
): NormalizedLicense | null {
  const sourceManagementNo = clean(item.MNG_NO);
  const businessName = clean(item.BPLC_NM);
  const roadAddress = clean(item.ROAD_NM_ADDR);
  const lotAddress = clean(item.LOTNO_ADDR);
  const regionCode = regionFromAddress(roadAddress) ?? regionFromAddress(lotAddress);
  if (!sourceManagementNo || !businessName || !regionCode) return null;

  const salesStatusCode = clean(item.SALS_STTS_CD);
  const salesStatusName = clean(item.SALS_STTS_NM);
  const detailStatusCode = clean(item.DTL_SALS_STTS_CD);
  const detailStatusName = clean(item.DTL_SALS_STTS_NM);
  const sourceX = numberOrNull(item.CRD_INFO_X);
  const sourceY = numberOrNull(item.CRD_INFO_Y);
  const coordinates = sourceCoordinatesToWgs84(sourceX, sourceY);
  return {
    sourceType,
    sourceManagementNo,
    businessName,
    businessSubtype: clean(item.BZSTAT_SE_NM),
    salesStatusCode,
    salesStatusName,
    detailStatusCode,
    detailStatusName,
    normalizedStatus: normalizeBusinessStatus(salesStatusCode, salesStatusName, detailStatusCode, detailStatusName),
    lotAddress,
    roadAddress,
    phone: clean(item.TELNO),
    sourceX,
    sourceY,
    ...coordinates,
    regionCode,
    sourceUpdatedAt: clean(item.LAST_MDFCN_PNT) ?? clean(item.DAT_UPDT_PNT),
    rawPayload: JSON.stringify(item),
  };
}

export function parsePublicDataResponse(payload: unknown) {
  const response = payload as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { totalCount?: number; items?: { item?: unknown[] | unknown } } } };
  if (response.response?.header?.resultCode !== "0") {
    throw new Error(response.response?.header?.resultMsg || "공공데이터 응답 오류");
  }
  const raw = response.response.body?.items?.item;
  const items = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  return { totalCount: Number(response.response.body?.totalCount ?? 0), items: items as Record<string, unknown>[] };
}
