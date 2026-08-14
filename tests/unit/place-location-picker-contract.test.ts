import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlaceLocationPicker } from "../../app/components/places/PlaceLocationPicker";

describe("PlaceLocationPicker contract", () => {
  it("renders an address search, empty hidden coordinates, and a non-coordinate member UI", () => {
    const html = renderToStaticMarkup(createElement(PlaceLocationPicker, {
      clientId: "naver-client-id",
      mode: "MEMBER",
      required: true,
    }));

    expect(html).toContain('name="address"');
    expect(html).toContain('name="latitude" value=""');
    expect(html).toContain('name="longitude" value=""');
    expect(html).toContain('name="locationConfirmed" value=""');
    expect(html).toContain('name="originLatitude" value=""');
    expect(html).toContain('name="originLongitude" value=""');
    expect(html).toContain("지도에서 위치 찾기");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("선택 좌표:");
  });

  it("keeps compact coordinate support available only for an admin", () => {
    const html = renderToStaticMarkup(createElement(PlaceLocationPicker, {
      clientId: "naver-client-id",
      mode: "ADMIN",
      defaultAddress: "광주광역시 동구 서석로 1",
      defaultLatitude: 35.146,
      defaultLongitude: 126.923,
    }));

    expect(html).toContain('data-mode="ADMIN"');
    expect(html).toContain("기존 위치 지도에서 확인");
    expect(html).not.toContain("선택 좌표:");
  });
});
