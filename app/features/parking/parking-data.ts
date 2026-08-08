export const PARKING_DATA_URL = "https://api.data.go.kr/openapi/tn_pubr_prkplce_info_api";

function decodeServiceKey(value: string) {
  try { return /%[0-9a-f]{2}/i.test(value) ? decodeURIComponent(value) : value; } catch { return value; }
}

export function buildParkingDataUrl(input: { serviceKey: string; page: number; rows?: number }) {
  const url = new URL(PARKING_DATA_URL);
  url.searchParams.set("serviceKey", decodeServiceKey(input.serviceKey.trim()));
  url.searchParams.set("pageNo", String(input.page));
  url.searchParams.set("numOfRows", String(input.rows ?? 100));
  url.searchParams.set("type", "json");
  return url;
}

const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const numberOrNull = (value: unknown) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const clock = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "").padStart(4, "0");
  return /^([01]\d|2[0-3])[0-5]\d$/.test(digits) ? `${digits.slice(0, 2)}:${digits.slice(2)}` : null;
};

function region(address: string | null) {
  if (address?.startsWith("광주광역시")) return "GWANGJU" as const;
  if (address?.startsWith("전라남도")) return "JEONNAM" as const;
  if (address?.startsWith("전남광주통합특별시")) return ["동구", "서구", "남구", "북구", "광산구"].includes(address.split(/\s+/)[1] ?? "") ? "GWANGJU" as const : "JEONNAM" as const;
  return null;
}

function monthsOld(referenceDate: string, now: Date) {
  const parsed = new Date(`${referenceDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? Number.POSITIVE_INFINITY : (now.getTime() - parsed.getTime()) / (30.44 * 86_400_000);
}

function coordinatesMatchRegion(regionCode: "GWANGJU" | "JEONNAM", latitude: number, longitude: number) {
  if (regionCode === "GWANGJU") return latitude >= 34.9 && latitude <= 35.35 && longitude >= 126.5 && longitude <= 127.1;
  return latitude >= 33.0 && latitude <= 35.6 && longitude >= 125.0 && longitude <= 127.8;
}

export function normalizeParkingItem(item: Record<string, unknown>, now = new Date()) {
  const sourceManagementNo = clean(item.prkplceNo) ?? clean(item.parkingLotNo) ?? clean(item.mngNo);
  const name = clean(item.prkplceNm) ?? clean(item.parkingLotNm);
  const roadAddress = clean(item.rdnmadr) ?? clean(item.roadAddress);
  const lotAddress = clean(item.lnmadr) ?? clean(item.lotAddress);
  const regionCode = region(roadAddress) ?? region(lotAddress);
  const latitude = numberOrNull(item.latitude);
  const longitude = numberOrNull(item.longitude);
  const referenceDate = clean(item.referenceDate);
  if (!sourceManagementNo || !name || !regionCode || latitude == null || longitude == null || !referenceDate) return null;
  if (latitude < 33 || latitude > 39 || longitude < 124 || longitude > 132) return null;
  if (!coordinatesMatchRegion(regionCode, latitude, longitude)) return null;
  const capacity = numberOrNull(item.prkcmprt);
  const feeText = clean(item.parkingchrgeInfo) ?? "";
  const feeStatus = /무료/.test(feeText) ? "FREE" as const : /유료/.test(feeText) ? "PAID" as const : /혼합|일부/.test(feeText) ? "MIXED" as const : "UNKNOWN" as const;
  const ownershipText = clean(item.prkplceSe) ?? "";
  const ownershipType = /공영/.test(ownershipText) ? "PUBLIC" as const : /민영/.test(ownershipText) ? "PRIVATE" as const : "UNKNOWN" as const;
  const facilityText = clean(item.prkplceType) ?? "";
  const facilityType = /노상/.test(facilityText) ? "ON_STREET" as const : /노외/.test(facilityText) ? "OFF_STREET" as const : /부설/.test(facilityText) ? "ATTACHED" as const : "UNKNOWN" as const;
  const note = `${clean(item.spcmnt) ?? ""} ${clean(item.enforceSe) ?? ""}`;
  const publicAccessStatus = /전용|거주자|입주자|직원/.test(note) ? "RESTRICTED" as const : "PUBLIC" as const;
  const baseMinutes = numberOrNull(item.basicTime);
  const baseFee = numberOrNull(item.basicCharge);
  const additionalMinutes = numberOrNull(item.addUnitTime);
  const additionalFee = numberOrNull(item.addUnitCharge);
  const dailyMaxFee = numberOrNull(item.dayCmmtkt);
  const age = monthsOld(referenceDate, now);
  const complete = capacity != null && feeStatus !== "UNKNOWN" && (feeStatus === "FREE" || baseFee != null) && clock(item.weekdayOperOpenHhmm) && clock(item.weekdayOperColseHhmm);
  const reliabilityGrade = age > 18 ? "C" as const : age > 12 || !complete ? "B" as const : "A" as const;
  return {
    sourceManagementNo, name, ownershipType, facilityType, roadAddress, lotAddress, regionCode, latitude, longitude,
    capacity, disabledSpaces: numberOrNull(item.hndicapPrkcmprt),
    weekdayOpen: clock(item.weekdayOperOpenHhmm), weekdayClose: clock(item.weekdayOperColseHhmm),
    saturdayOpen: clock(item.satOperOperOpenHhmm ?? item.satOperOpenHhmm), saturdayClose: clock(item.satOperCloseHhmm),
    holidayOpen: clock(item.holidayOperOpenHhmm), holidayClose: clock(item.holidayCloseOpenHhmm ?? item.holidayOperCloseHhmm),
    feeStatus, baseMinutes, baseFee, additionalMinutes, additionalFee, dailyMaxFee,
    paymentMethods: clean(item.metpay), publicAccessStatus, reliabilityGrade, referenceDate, rawPayload: JSON.stringify(item),
  };
}

export function parseParkingResponse(payload: unknown) {
  const value = payload as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { totalCount?: number; items?: unknown[] | { item?: unknown[] | unknown } } } };
  const code = value.response?.header?.resultCode;
  if (code != null && code !== "0" && code !== "00") throw new Error(value.response?.header?.resultMsg || "PARKING_DATA_RESPONSE_ERROR");
  const raw = value.response?.body?.items;
  const nested = raw && !Array.isArray(raw) && "item" in raw ? raw.item : raw;
  const items = nested == null ? [] : Array.isArray(nested) ? nested : [nested];
  return { totalCount: Number(value.response?.body?.totalCount ?? 0), items: items as Record<string, unknown>[] };
}
