import { describe, expect, it } from "vitest";
import { buildParkingDataUrl, normalizeParkingItem, parseParkingResponse } from "../../app/features/parking/parking-data";

describe("parking public data", () => {
  it("does not double encode a service key", () => {
    const url = buildParkingDataUrl({ serviceKey: "abc%2Bdef%3D", page: 2, rows: 100 });
    expect(url.searchParams.get("serviceKey")).toBe("abc+def=");
    expect(url.searchParams.get("pageNo")).toBe("2");
  });

  it("normalizes only Gwangju and Jeonnam facilities without inventing fee data", () => {
    const normalized = normalizeParkingItem({
      prkplceNo: "P-1", prkplceNm: "동구 공영", prkplceSe: "공영", prkplceType: "노외", rdnmadr: "광주광역시 동구 테스트로 1",
      latitude: "35.15", longitude: "126.85", prkcmprt: "120", parkingchrgeInfo: "유료", referenceDate: "2026-07-01",
      weekdayOperOpenHhmm: "0900", weekdayOperColseHhmm: "2200",
    }, new Date("2026-08-08T00:00:00Z"));
    expect(normalized).toMatchObject({ sourceManagementNo: "P-1", regionCode: "GWANGJU", capacity: 120, feeStatus: "PAID", baseFee: null, reliabilityGrade: "B" });
    expect(normalizeParkingItem({ ...normalized, rdnmadr: "서울특별시 중구", roadAddress: undefined }, new Date())).toBeNull();
    expect(normalizeParkingItem({
      prkplceNo: "P-bad", prkplceNm: "좌표 오류", rdnmadr: "광주광역시 동구 테스트로 1", latitude: "37.5", longitude: "127.0", referenceDate: "2026-07-01",
    }, new Date())).toBeNull();
  });

  it("parses standard response wrappers", () => {
    expect(parseParkingResponse({ response: { header: { resultCode: "00" }, body: { totalCount: 1, items: [{ prkplceNo: "1" }] } } })).toMatchObject({ totalCount: 1, items: [{ prkplceNo: "1" }] });
  });

  it("preserves unknown hours and accepts explicit midnight and existing clock formats", () => {
    const fixture = {
      prkplceNo: "P-hours", prkplceNm: "합성 주차장", rdnmadr: "광주광역시 동구 테스트로 1",
      latitude: "35.15", longitude: "126.85", prkcmprt: "100",
      parkingchrgeInfo: "무료", referenceDate: "2026-11-01",
    };
    const now = new Date("2026-11-22T00:00:00Z");
    expect(normalizeParkingItem({
      ...fixture, weekdayOperColseHhmm: "정보 없음", satOperOpenHhmm: " ", satOperCloseHhmm: "18:00 출차",
      holidayOperOpenHhmm: "  ", holidayOperCloseHhmm: "09:75",
    }, now)).toMatchObject({
      weekdayOpen: null, weekdayClose: null, saturdayOpen: null, saturdayClose: null,
      holidayOpen: null, holidayClose: null, reliabilityGrade: "B",
    });
    expect(normalizeParkingItem({
      ...fixture, weekdayOperOpenHhmm: 0, weekdayOperColseHhmm: "0000",
      satOperOpenHhmm: "9:30", satOperCloseHhmm: 1815,
      holidayOperOpenHhmm: " 0900 ", holidayOperCloseHhmm: "21:30",
    }, now)).toMatchObject({
      weekdayOpen: "00:00", weekdayClose: "00:00", saturdayOpen: "09:30", saturdayClose: "18:15",
      holidayOpen: "09:00", holidayClose: "21:30", reliabilityGrade: "A",
    });
  });
});
