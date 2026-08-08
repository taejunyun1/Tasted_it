import { estimateWalkingMeters } from "./parking-distance";

export const EV_DATA_URL = "https://apis.data.go.kr/B552584/EvCharger/getChargerInfo";
export type EvRegionCode = "29" | "46";

function decodeServiceKey(value: string) {
  try { return /%[0-9a-f]{2}/i.test(value) ? decodeURIComponent(value) : value; } catch { return value; }
}

export function buildEvDataUrl(input: { serviceKey: string; regionCode: EvRegionCode; page?: number; rows?: number }) {
  const url = new URL(EV_DATA_URL);
  url.searchParams.set("serviceKey", decodeServiceKey(input.serviceKey.trim()));
  url.searchParams.set("pageNo", String(input.page ?? 1));
  url.searchParams.set("numOfRows", String(input.rows ?? 9_999));
  url.searchParams.set("zcode", input.regionCode);
  url.searchParams.set("dataType", "JSON");
  return url;
}

const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const numberOrNull = (value: unknown) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const isLocal = (address: string | null) => Boolean(address?.startsWith("광주광역시") || address?.startsWith("전라남도") || address?.startsWith("전남광주통합특별시"));
const dateFromUpdate = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : null;
};

type ParkingLinkCandidate = { name: string; roadAddress: string | null; lotAddress: string | null; latitude: number; longitude: number };
type EvLinkCandidate = { name: string; address: string | null; latitude: number; longitude: number };

function addressKey(value: string | null) {
  if (!value) return null;
  const normalized = value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const road = normalized.match(/([가-힣A-Za-z0-9·.-]+(?:로|길))\s*(\d+(?:-\d+)?)/);
  if (road) return `${road[1]}:${road[2]}`;
  const lot = normalized.match(/([가-힣A-Za-z0-9·.-]+(?:동|읍|면|리))\s*(\d+(?:-\d+)?)/);
  return lot ? `${lot[1]}:${lot[2]}` : null;
}

function meaningfulNameTokens(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/[()·,.-]/g, " ").split(/\s+/)
    .map((token) => token.replace(/(전기차|충전소|충전|공영|민영|주차장|주차)/g, ""))
    .filter((token) => token.length >= 2);
}

export function classifyParkingEvLink(parking: ParkingLinkCandidate, station: EvLinkCandidate) {
  const distanceMeters = estimateWalkingMeters(parking, station);
  if (distanceMeters > 250) return null;
  const stationAddress = addressKey(station.address);
  const sameAddress = stationAddress != null && [parking.roadAddress, parking.lotAddress].some((value) => addressKey(value) === stationAddress);
  const parkingTokens = meaningfulNameTokens(parking.name);
  const stationTokens = meaningfulNameTokens(station.name);
  const hasNameRelation = parkingTokens.some((token) => stationTokens.includes(token));
  if (distanceMeters <= 80 && sameAddress && hasNameRelation) {
    return { relationship: "ONSITE_CONFIRMED" as const, matchMethod: "ADDRESS_AND_DISTANCE", confidence: 0.95, distanceMeters };
  }
  return { relationship: "NEARBY_ONLY" as const, matchMethod: "DISTANCE_ONLY", confidence: distanceMeters <= 120 ? 0.75 : 0.6, distanceMeters };
}

export function normalizeEvStations(items: Record<string, unknown>[]) {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const id = clean(item.statId);
    const address = clean(item.addr);
    if (!id || !isLocal(address)) continue;
    const group = groups.get(id) ?? [];
    group.push(item);
    groups.set(id, group);
  }
  return [...groups.entries()].flatMap(([sourceStationId, chargers]) => {
    const first = chargers[0];
    const latitude = numberOrNull(first.lat);
    const longitude = numberOrNull(first.lng);
    const name = clean(first.statNm);
    if (latitude == null || longitude == null || !name) return [];
    const types = chargers.map((item) => clean(item.chgerType)).filter(Boolean) as string[];
    const slowTypes = new Set(["02", "07", "08"]);
    const dates = chargers.map((item) => dateFromUpdate(item.statUpdDt)).filter(Boolean).sort() as string[];
    const sanitizedPayload = chargers.map((item) => ({
      statId: clean(item.statId), statNm: clean(item.statNm), addr: clean(item.addr), lat: numberOrNull(item.lat), lng: numberOrNull(item.lng),
      chgerType: clean(item.chgerType), useTime: clean(item.useTime), parkingFree: clean(item.parkingFree), limitYn: clean(item.limitYn), delYn: clean(item.delYn),
    }));
    return [{
      sourceStationId, name, address: clean(first.addr), latitude, longitude,
      fastChargerCount: types.filter((type) => !slowTypes.has(type)).length,
      slowChargerCount: types.filter((type) => slowTypes.has(type)).length,
      connectorSummary: [...new Set(types)].sort().join(",") || null,
      availableHours: clean(first.useTime), userRestriction: clean(first.limitDetail) ?? clean(first.limitYn),
      parkingFeeFree: clean(first.parkingFree) === "Y" ? true : clean(first.parkingFree) === "N" ? false : null,
      isDeleted: chargers.every((item) => clean(item.delYn) === "Y"),
      referenceDate: dates.at(-1) ?? new Date().toISOString().slice(0, 10),
      rawPayload: JSON.stringify(sanitizedPayload),
    }];
  });
}

export function parseEvResponse(payload: unknown) {
  const value = payload as { items?: { item?: unknown[] | unknown }; totalCount?: number; response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: unknown[] | unknown }; totalCount?: number } } };
  const code = value.response?.header?.resultCode;
  if (code != null && code !== "0" && code !== "00") throw new Error(value.response?.header?.resultMsg || "EV_DATA_RESPONSE_ERROR");
  const raw = value.response?.body?.items?.item ?? value.items?.item;
  const items = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  return { totalCount: Number(value.response?.body?.totalCount ?? value.totalCount ?? 0), items: items as Record<string, unknown>[] };
}
