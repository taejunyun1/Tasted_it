import { describe, expect, it } from "vitest";
import { buildNaverMapsScriptUrl, toBoundsTuple } from "../../app/features/maps/naver-map-sdk";

describe("NAVER Maps SDK helpers", () => {
  it("builds the current Web Dynamic Map script URL", () => {
    expect(buildNaverMapsScriptUrl("client id/+"))
      .toBe("https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=client%20id%2F%2B");
  });

  it("converts NAVER southwest/northeast bounds to the URL bbox order", () => {
    expect(toBoundsTuple({ lat: 35.1, lng: 126.8 }, { lat: 35.2, lng: 126.9 }))
      .toEqual([126.8, 35.1, 126.9, 35.2]);
  });
});
