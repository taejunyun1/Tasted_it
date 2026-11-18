import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { MapExplorerPanel } from "../../app/components/map/MapExplorerPanel";
import type { PlaceSummary } from "../../app/features/places/place.types";

const noOp = () => undefined;
const base = {
  places: [] as PlaceSummary[], groups: [{ id: "parent", slug: "parent", name: "한식", emoji: "🍚", children: [{ id: "child", slug: "child", name: "국밥", emoji: "🍲", count: 0, overallCount: 2 }] }],
  regionGroups: [], clusterLevel: "PLACE" as const, query: "국밥", category: "child", hasSelectedPlace: false,
  onSelect: noOp, onSearch: noOp, onCategory: noOp, onLocate: noOp, onGroupSelect: noOp,
};

it("renders both viewport and overall counts without invoking the expansion callback", () => {
  const onExpandBounds = vi.fn();
  const html = renderToStaticMarkup(createElement(MapExplorerPanel, { ...base, counts: { count: 0, overallCount: 2, overallBounds: [126.8, 35.1, 127, 35.3] }, onExpandBounds }));
  expect(html).toContain("국밥, 현재 범위 0곳, 전체 검색 결과 2곳");
  expect(html).toContain("전체 결과 2곳 보기");
  expect(onExpandBounds).not.toHaveBeenCalled();
});

it("discloses the display cap separately from the actual total", () => {
  const places = Array.from({ length: 5 }, (_, index) => ({
    id: `place-${index}`, slug: `place-${index}`, name: "합성 국밥", address: "합성 주소", neighborhood: "합성", latitude: 35.15, longitude: 126.9,
    heroImageUrl: null, primaryCategory: { slug: "child", name: "국밥", emoji: "🍲" }, positive: 0, negative: 0,
  }));
  const html = renderToStaticMarkup(createElement(MapExplorerPanel, { ...base, places, counts: { count: 125, overallCount: 125, overallBounds: null } }));
  expect(html).toContain("<strong>125</strong>");
  expect(html).toContain("전체 125곳 중 이름순 첫 5곳을 표시합니다.");
});
