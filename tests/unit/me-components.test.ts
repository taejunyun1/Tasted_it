import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { ActivityCollection } from "../../app/components/me/ActivityCollection";
import { TasteSignals } from "../../app/components/me/TasteSignals";

function render(node: ReactNode) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node));
}

describe("me components", () => {
  it("대표 취향은 목록과 첫 번째 강조 상태로 렌더링한다", () => {
    const html = render(createElement(TasteSignals, { graph: {
      status: "VISIBLE",
      placeCount: 6,
      dimensions: [{ key: "감칠맛", value: 4.4 }, { key: "식감", value: 4.1 }],
    } }));

    expect(html).toContain("나의 취향 신호");
    expect(html).toContain("감칠맛 4.4");
    expect(html).toContain('data-primary="true"');
    expect(html).toContain("<meter");
  });

  it("학습 중에는 진행도와 다음 행동을 렌더링한다", () => {
    const html = render(createElement(TasteSignals, { graph: { status: "LEARNING", placeCount: 2, dimensions: [] } }));

    expect(html).toContain("취향 학습 중 2/5");
    expect(html).toContain("맛집 둘러보기");
    expect(html).not.toContain("data-primary");
  });

  it("활동이 없으면 개수와 다음 행동을 함께 안내한다", () => {
    const html = render(createElement(ActivityCollection, {
      title: "저장한 장소",
      count: 0,
      emptyText: "다시 보고 싶은 장소를 저장해 보세요.",
      emptyHref: "/places",
      children: null,
    }));

    expect(html).toContain("저장한 장소");
    expect(html).toContain("0곳");
    expect(html).toContain('href="/places"');
  });
});
