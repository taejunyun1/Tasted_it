import { describe, expect, it } from "vitest";

import {
  buildPublicDataUrl,
  normalizeBusinessStatus,
  normalizePublicDataItem,
} from "../../app/features/candidates/public-data";

describe("public food-license data", () => {
  it("encodes an already encoded service key exactly once", () => {
    const url = buildPublicDataUrl({
      baseUrl: "https://example.test/info",
      serviceKey: "abc%2Bdef%3D%3D",
      pageNo: 2,
      addressField: "ROAD_NM_ADDR",
      addressPrefix: "광주광역시",
    });

    expect(url.searchParams.get("serviceKey")).toBe("abc+def==");
    expect(url.searchParams.get("cond[ROAD_NM_ADDR::LIKE]")).toBe("광주광역시%");
    expect(url.searchParams.get("pageNo")).toBe("2");
  });

  it("only considers an explicit normal/open state eligible", () => {
    expect(normalizeBusinessStatus("01", "영업/정상", "01", "영업")).toBe("OPEN");
    expect(normalizeBusinessStatus("03", "폐업", "02", "폐업")).toBe("CLOSED");
    expect(normalizeBusinessStatus("01", "영업", "03", "휴업")).toBe("TEMPORARILY_CLOSED");
    expect(normalizeBusinessStatus("", "", "", "")).toBe("UNKNOWN");
  });

  it("normalizes only Gwangju and Jeonnam records", () => {
    const item = normalizePublicDataItem("GENERAL_RESTAURANT", {
      MNG_NO: "m-1",
      BPLC_NM: "테스트식당",
      BZSTAT_SE_NM: "한식",
      SALS_STTS_CD: "01",
      SALS_STTS_NM: "영업/정상",
      DTL_SALS_STTS_CD: "01",
      DTL_SALS_STTS_NM: "영업",
      ROAD_NM_ADDR: "광주광역시 동구 예술길 1",
      LOTNO_ADDR: "",
      TELNO: "062-000-0000",
      CRD_INFO_X: "",
      CRD_INFO_Y: "",
    });

    expect(item?.regionCode).toBe("GWANGJU");
    expect(item?.normalizedStatus).toBe("OPEN");
    expect(normalizePublicDataItem("GENERAL_RESTAURANT", {
      MNG_NO: "m-unified", BPLC_NM: "통합주소식당", ROAD_NM_ADDR: "전남광주통합특별시 광산구 풍영로 1",
      SALS_STTS_CD: "01", SALS_STTS_NM: "영업/정상",
    })?.regionCode).toBe("GWANGJU");
    expect(normalizePublicDataItem("GENERAL_RESTAURANT", {
      MNG_NO: "m-2",
      BPLC_NM: "제외식당",
      ROAD_NM_ADDR: "서울특별시 중구 세종대로 1",
    })).toBeNull();
  });
});
