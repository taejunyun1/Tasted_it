import { describe, expect, it } from "vitest";
import {
  isSupportedRegionAddress,
  normalizeGeocodeCandidates,
  validateAdjustedCoordinate,
  validatePlaceCoordinate,
} from "../../app/features/maps/place-location";

describe("place suggestion location contract", () => {
  it("accepts only addresses in Gwangju or Jeonnam", () => {
    expect(isSupportedRegionAddress("광주광역시 동구 서석로 1")).toBe(true);
    expect(isSupportedRegionAddress("전라남도 무안군 삼향읍 남악로 12")).toBe(true);
    expect(isSupportedRegionAddress("전남 목포시 영산로 1")).toBe(true);
    expect(isSupportedRegionAddress("서울특별시 종로구 세종대로 1")).toBe(false);
    expect(isSupportedRegionAddress("부산광역시 중구 중앙대로 1")).toBe(false);
  });

  it("rejects invalid or out-of-region coordinates", () => {
    expect(validatePlaceCoordinate({ latitude: 35.1595, longitude: 126.8526 })).toEqual({
      ok: true,
      coordinate: { latitude: 35.1595, longitude: 126.8526 },
    });
    expect(validatePlaceCoordinate({ latitude: Number.NaN, longitude: 126.8526 })).toEqual({
      ok: false,
      code: "LOCATION_OUT_OF_SCOPE",
    });
    expect(validatePlaceCoordinate({ latitude: 37.5665, longitude: 126.978 })).toEqual({
      ok: false,
      code: "LOCATION_OUT_OF_SCOPE",
    });
  });

  it("allows a map adjustment within 2km and rejects a larger move", () => {
    const origin = { latitude: 35.1595, longitude: 126.8526 };

    expect(validateAdjustedCoordinate(origin, { latitude: 35.1705, longitude: 126.8526 })).toEqual({
      ok: true,
      coordinate: { latitude: 35.1705, longitude: 126.8526 },
    });
    expect(validateAdjustedCoordinate(origin, { latitude: 35.1815, longitude: 126.8526 })).toEqual({
      ok: false,
      code: "LOCATION_TOO_FAR_FROM_ADDRESS",
    });
  });

  it("prioritizes road-address candidates, removes duplicates, and limits results to five", () => {
    const candidates = normalizeGeocodeCandidates([
      { roadAddress: "", jibunAddress: "광주광역시 동구 지산동 1", x: "126.9000", y: "35.1500" },
      { roadAddress: "광주광역시 동구 지산로 2", jibunAddress: "", x: "126.9010", y: "35.1510" },
      { roadAddress: "광주광역시 동구 지산로 3", jibunAddress: "", x: "126.9020", y: "35.1520" },
      { roadAddress: "광주광역시 동구 지산로 3", jibunAddress: "", x: "126.9020", y: "35.1520" },
      { roadAddress: "광주광역시 동구 지산로 4", jibunAddress: "", x: "126.9030", y: "35.1530" },
      { roadAddress: "광주광역시 동구 지산로 5", jibunAddress: "", x: "126.9040", y: "35.1540" },
      { roadAddress: "광주광역시 동구 지산로 6", jibunAddress: "", x: "126.9050", y: "35.1550" },
    ]);

    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toMatchObject({
      address: "광주광역시 동구 지산로 2",
      roadAddress: "광주광역시 동구 지산로 2",
    });
    expect(candidates.map((candidate) => candidate.address)).not.toContain("광주광역시 동구 지산동 1");
  });
});
