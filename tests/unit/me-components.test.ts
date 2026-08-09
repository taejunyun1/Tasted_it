import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { ActivityCollection } from "../../app/components/me/ActivityCollection";
import { AccountConnections } from "../../app/components/me/AccountConnections";
import { TasteSignals } from "../../app/components/me/TasteSignals";

function render(node: ReactNode) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node));
}

describe("me components", () => {
  it("대표 문구와 FOOD/TASTE/STYLE 배지를 첫 번째 강조 상태로 렌더링한다", () => {
    const html = render(createElement(TasteSignals, {
      profile: {
        headline: "떡볶이와 국밥을 좋아하는 태준",
        badges: [
          { id: "food-gukbap", badgeId: "food-gukbap", category: "FOOD", label: "국밥러", headlineNoun: "국밥", score: 0.9, sources: ["USER"] },
          { id: "taste-spicy", badgeId: "taste-spicy", category: "TASTE", label: "맵부심", headlineNoun: "매운맛", score: 0.8, sources: ["INFERRED"] },
          { id: "style-old-school", badgeId: "style-old-school", category: "STYLE", label: "노포파", headlineNoun: "노포", score: 0.7, sources: ["INFERRED"] },
        ],
      },
      placeCount: 6,
    }));

    expect(html).toContain("떡볶이와 국밥을 좋아하는 태준");
    expect(html).toContain("국밥러");
    expect(html).toContain('data-category="FOOD"');
    expect(html).toContain('data-category="TASTE"');
    expect(html).toContain('data-category="STYLE"');
    expect(html).toContain('data-primary="true"');
    expect(html).not.toContain("0.9");
  });

  it("학습 중에는 진행도와 다음 행동을 렌더링한다", () => {
    const html = render(createElement(TasteSignals, {
      profile: { headline: "태준님의 취향을 알아가는 중", badges: [] },
      placeCount: 2,
    }));

    expect(html).toContain("취향 학습 중 2/5");
    expect(html).toContain("맛집 둘러보기");
    expect(html).not.toContain("data-primary");
  });

  it("외부 연결은 하단용 소형 상태 배지만 렌더링한다", () => {
    const html = render(createElement(AccountConnections, { naverConnected: true, googleConnected: false }));
    expect(html).toContain("N 네이버 연결됨");
    expect(html).toContain("G Google 미연결");
    expect(html).toContain('class="member-connection-badges"');
    expect(html).not.toContain("LOGIN CONNECTIONS");
    expect(html).not.toContain("네이버 연결</a>");
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
