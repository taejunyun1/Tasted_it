import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  getGwangjuOverviewPoint,
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
  it("선택 장소 좌표를 광주시 미니맵 비율로 변환한다", () => {
    expect(getGwangjuOverviewPoint({ latitude: 35.15, longitude: 126.92 }))
      .toEqual({ x: 61.1, y: 50 });
    expect(getGwangjuOverviewPoint({ latitude: 34, longitude: 125 }))
      .toEqual({ x: 6, y: 94 });
  });

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

  it("선택된 장소가 있으면 축소된 광주시 벨트라인 미니맵을 표시한다", () => {
    const html = renderToStaticMarkup(createElement(PlaceMap, {
      places: [place],
      selected: "place-1",
      clientId: "",
      qaMode: true,
      onSelect: vi.fn(),
      onBounds: vi.fn(),
    }));

    expect(html).toContain("map-location-overview");
    expect(html).toContain("광주시 벨트라인, 무등산, 영산강 기준 테스트 국밥 위치 미니맵");
    expect(html).toContain("map-location-overview__beltline");
    expect(html).toContain('x="12"');
    expect(html).toContain('y="22"');
    expect(html).toContain('width="76"');
    expect(html).toContain('height="56"');
    expect(html).toContain('rx="16"');
    expect(html).toContain("map-location-overview__river");
    expect(html).toContain('points="44,3 35,24 22,41 16,62 12,88"');
    expect(html).not.toContain("map-location-overview__river-icon");
    expect(html).toContain("map-location-overview__mountain-icon");
    expect(html).toContain('transform="translate(95 63)"');
    expect(html).toContain('d="M-5 6 L0 -6 L5 6 Z"');
    expect(html).not.toContain('d="M-1 -7 L1 -2 L4 1"');
    expect(html).toContain('class="map-location-overview__dot"');
    expect(html).toContain('cx="61.1"');
    expect(html).toContain('cy="50"');
  });

  it("지도 에러 메시지가 있으면 미니맵을 아래 위치로 전환한다", () => {
    const html = renderToStaticMarkup(createElement(PlaceMap, {
      places: [place],
      selected: "place-1",
      clientId: "",
      qaMode: true,
      locationNotice: "NAVER Maps Client ID가 설정되지 않았습니다.",
      onSelect: vi.fn(),
      onBounds: vi.fn(),
    }));

    expect(html).toContain("map-location-overview--below-message");
    expect(html).toContain("NAVER Maps Client ID가 설정되지 않았습니다.");
  });

  it("실제 지도 host와 미니맵 overlay를 분리해 SDK 초기화 뒤에도 overlay를 유지한다", () => {
    const html = renderToStaticMarkup(createElement(PlaceMap, {
      places: [place],
      selected: "place-1",
      clientId: "naver-client-id",
      onSelect: vi.fn(),
      onBounds: vi.fn(),
    }));

    expect(html).toContain('class="map-canvas__host"');
    expect(html).toContain("map-location-overview");
    expect(html.indexOf('class="map-canvas__host"')).toBeLessThan(html.indexOf("map-location-overview"));
  });

  it("선택된 장소가 없으면 광주시 미니맵을 숨긴다", () => {
    const html = renderToStaticMarkup(createElement(PlaceMap, {
      places: [place],
      selected: null,
      clientId: "",
      qaMode: true,
      onSelect: vi.fn(),
      onBounds: vi.fn(),
    }));

    expect(html).not.toContain("map-location-overview");
  });

  it("큐레이션 지도는 사용자 이동 뒤에만 pending bounds를 보낸다", () => {
    expect(mapBoundsDeliveryTarget({ deferBounds: true, viewportDirty: false })).toBe("ignore");
    expect(mapBoundsDeliveryTarget({ deferBounds: true, viewportDirty: true })).toBe("pending");
    expect(mapBoundsDeliveryTarget({ deferBounds: false, viewportDirty: false })).toBe("committed");
  });
});
