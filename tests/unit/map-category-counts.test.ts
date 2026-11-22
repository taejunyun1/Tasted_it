import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
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

it("discloses the page range separately from the actual total and keeps the map filters", () => {
  const places = Array.from({ length: 5 }, (_, index) => ({
    id: `place-${index}`, slug: `place-${index}`, name: "합성 국밥", address: "합성 주소", neighborhood: "합성", latitude: 35.15, longitude: 126.9,
    heroImageUrl: null, primaryCategory: { slug: "child", name: "국밥", emoji: "🍲" }, positive: 0, negative: 0,
  }));
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(MapExplorerPanel, { ...base, places,
    pagination: { total: 105, page: 2, totalPages: 2, start: 101, end: 105, outOfRange: false },
    browseSearch: "?view=browse&q=국밥&category=child&page=2", listHref: "/places?q=국밥&category=child&page=2",
  })));
  expect(html).toContain("<strong>105</strong>");
  expect(html).toContain("전체 105곳 중 101–105번째를 표시합니다.");
  expect(html).toContain("view=browse&amp;q=%EA%B5%AD%EB%B0%A5&amp;category=child");
  expect(html).toContain("목록에서 보기");
});
