import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  mapBoundsDeliveryTarget,
  PlaceMap,
} from "../../app/components/map/PlaceMap";
import type { PlaceSummary } from "../../app/features/places/place.types";

const place: PlaceSummary = {
  id: "place-1",
  slug: "place-1",
  name: "테스트 국밥",
  address: "광주광역시",
  neighborhood: "충장동",
  latitude: 35.15,
  longitude: 126.92,
  phone: null,
  parkingSummary: null,
  heroImageUrl: null,
  searchText: "국밥",
  kakaoPlaceId: null,
  primaryCategory: { slug: "gukbap", name: "국밥", emoji: "🍲" },
  positive: 10,
  negative: 1,
};

describe("curated place map", () => {
  it("큐레이션 QA 지도는 이모지 대신 추천 순번을 표시한다", () => {
    const html = renderToStaticMarkup(createElement(PlaceMap, {
      places: [place],
      selected: "place-1",
      clientId: "",
      qaMode: true,
      markerRanks: { "place-1": 1 },
      onSelect: vi.fn(),
      onBounds: vi.fn(),
    }));

    expect(html).toContain("1번 테스트 국밥 지도 핀");
    expect(html).toContain('data-place-id="place-1"');
    expect(html).toContain(">1</button>");
    expect(html).not.toContain("🍲");
  });

  it("큐레이션 지도는 사용자 이동 뒤에만 pending bounds를 보낸다", () => {
    expect(mapBoundsDeliveryTarget({ deferBounds: true, viewportDirty: false })).toBe("ignore");
    expect(mapBoundsDeliveryTarget({ deferBounds: true, viewportDirty: true })).toBe("pending");
    expect(mapBoundsDeliveryTarget({ deferBounds: false, viewportDirty: false })).toBe("committed");
  });
});
