import { describe, expect, it } from "vitest";
import { buildEvDataUrl, classifyParkingEvLink, normalizeEvStations, parseEvResponse } from "../../app/features/parking/ev-data";

describe("EV installation data", () => {
  it("builds a regional URL without double encoding the key", () => {
    const url = buildEvDataUrl({ serviceKey: "abc%2Bdef%3D", regionCode: "29" });
    expect(url.searchParams.get("serviceKey")).toBe("abc+def=");
    expect(url.searchParams.get("zcode")).toBe("29");
    expect(url.searchParams.get("dataType")).toBe("JSON");
  });

  it("groups chargers by station and stores installation facts only", () => {
    const stations = normalizeEvStations([
      { statId: "ST1", statNm: "동명 주차장", addr: "광주광역시 동구", lat: "35.15", lng: "126.85", chgerType: "04", useTime: "24시간", parkingFree: "N", delYn: "N", statUpdDt: "20260701090000" },
      { statId: "ST1", statNm: "동명 주차장", addr: "광주광역시 동구", lat: "35.15", lng: "126.85", chgerType: "02", useTime: "24시간", parkingFree: "N", delYn: "N", statUpdDt: "20260702090000" },
      { statId: "SEOUL", statNm: "서울", addr: "서울특별시", lat: "37.5", lng: "127", chgerType: "04", delYn: "N" },
    ]);
    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({ sourceStationId: "ST1", fastChargerCount: 1, slowChargerCount: 1, parkingFeeFree: false, isDeleted: false, referenceDate: "2026-07-02" });
    expect(JSON.stringify(stations[0])).not.toContain("충전중");
  });

  it("parses the public response wrapper", () => {
    expect(parseEvResponse({ items: { item: [{ statId: "A" }] }, totalCount: 1 })).toMatchObject({ totalCount: 1, items: [{ statId: "A" }] });
  });

  it("confirms onsite charging only for a very close facility with matching address evidence", () => {
    expect(classifyParkingEvLink(
      { name: "동명동 공영주차장", roadAddress: "광주광역시 동구 동명로 12", lotAddress: null, latitude: 35.15, longitude: 126.85 },
      { name: "동명동 공영주차장 전기차충전소", address: "광주광역시 동구 동명로 12", latitude: 35.1501, longitude: 126.8501 },
    )).toMatchObject({ relationship: "ONSITE_CONFIRMED", matchMethod: "ADDRESS_AND_DISTANCE" });
  });

  it("keeps a nearby charger separate when onsite evidence is missing", () => {
    expect(classifyParkingEvLink(
      { name: "동명동 공영주차장", roadAddress: "광주광역시 동구 동명로 12", lotAddress: null, latitude: 35.15, longitude: 126.85 },
      { name: "주민센터 충전소", address: "광주광역시 동구 동명로 40", latitude: 35.151, longitude: 126.851 },
    )).toMatchObject({ relationship: "NEARBY_ONLY" });
  });

  it("does not treat a different facility at the same address as onsite charging", () => {
    expect(classifyParkingEvLink(
      { name: "동명동 공영주차장", roadAddress: "광주광역시 동구 동명로 12", lotAddress: null, latitude: 35.15, longitude: 126.85 },
      { name: "동명 주민센터 충전소", address: "광주광역시 동구 동명로 12", latitude: 35.1501, longitude: 126.8501 },
    )).toMatchObject({ relationship: "NEARBY_ONLY" });
  });

  it("does not create a relationship beyond the nearby radius", () => {
    expect(classifyParkingEvLink(
      { name: "동명동 공영주차장", roadAddress: null, lotAddress: null, latitude: 35.15, longitude: 126.85 },
      { name: "먼 충전소", address: null, latitude: 35.16, longitude: 126.86 },
    )).toBeNull();
  });
});
