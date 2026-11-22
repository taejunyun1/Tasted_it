import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { VoteControl } from "../../app/components/ratings/VoteControl";
import { selectTasteSignals } from "../../app/features/members/taste-signals";

function renderVoteControl(props: Parameters<typeof VoteControl>[0]) {
  const router = createMemoryRouter([{
    path: "/",
    element: createElement(VoteControl, props),
  }], { initialEntries: ["/"] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("selectTasteSignals", () => {
  it("값이 높은 순으로 최대 세 개의 실제 취향 신호를 고른다", () => {
    expect(selectTasteSignals({
      status: "VISIBLE",
      placeCount: 7,
      dimensions: [
        { key: "식감", value: 3.8 },
        { key: "감칠맛", value: 4.42 },
        { key: "향신료", value: 2.9 },
        { key: "국물 농도", value: 4.1 },
      ],
    })).toMatchObject({
      status: "VISIBLE",
      signals: [
        { key: "감칠맛", value: 4.42, label: "감칠맛 4.4" },
        { key: "국물 농도", value: 4.1, label: "국물 농도 4.1" },
        { key: "식감", value: 3.8, label: "식감 3.8" },
      ],
    });
  });

  it("학습 중에는 추정 취향 대신 진행 상태만 반환한다", () => {
    expect(selectTasteSignals({ status: "LEARNING", placeCount: 3, dimensions: [] })).toEqual({
      status: "LEARNING",
      placeCount: 3,
      requiredPlaceCount: 5,
      signals: [],
    });
  });
});

describe("VoteControl", () => {
  it("로그인 전에는 returnTo를 보존한 로그인 안내만 렌더링한다", () => {
    const html = renderVoteControl({
      placeId: "market-gukbap",
      vote: null,
      saved: false,
      signedIn: false,
      returnTo: "/places/시장-국밥?from=preview",
    });

    expect(html).toContain("로그인하고 취향 남기기");
    expect(html).toContain("returnTo=%2Fplaces%2F%EC%8B%9C%EC%9E%A5-%EA%B5%AD%EB%B0%A5%3Ffrom%3Dpreview");
    expect(html).not.toContain("비추천 이유");
  });

  it("비추천 상태에서 다섯 이유를 하나만 고르는 접근 가능한 그룹을 렌더링한다", () => {
    const html = renderVoteControl({ placeId: "gukbap", vote: -1, saved: false, signedIn: true, returnTo: "/places/gukbap" });
    const visibleText = html.replace(/<[^>]+>/g, " ");

    expect(html).toContain("<fieldset");
    expect(html).toContain("비추천 이유를 하나 선택해 주세요");
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html.match(/name="reason"/g)).toHaveLength(5);
    expect(html).toContain("메뉴");
    expect(html).toContain("거리");
    expect(html).toContain("가격");
    expect(html).toContain("분위기");
    expect(html).toContain("이미 가본 곳");
    expect(visibleText).not.toMatch(/(?:^|\s)-?\d+(?:\.\d+)?(?:\s|$)/);
  });

  it("상세 시트의 평가·취소·저장 요청에 같은 추천 진입 경로를 사용한다", () => {
    const action = "/places/gukbap?sourceRail=TRUSTED&discoveryMode=QUALITY&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f";
    const html = renderVoteControl({
      action,
      directions: createElement("a", { href: "/directions" }),
      placeId: "gukbap",
      vote: -1,
      voteEventId: "confirmed-event",
      saved: true,
      signedIn: true,
      returnTo: "/places?place=gukbap",
    });
    expect([...html.matchAll(/<form[^>]+action="([^"]+)"/g)].map(match => match[1])).toEqual(
      Array.from({ length: 4 }, () => action.replaceAll("&", "&amp;")),
    );
    expect(html).toContain('name="expectedEventId" value="confirmed-event"');
    expect(html).toContain('name="saved" value="false"');
  });

  it("추천 상태에서는 부정 이유 그룹을 숨긴다", () => {
    const html = renderVoteControl({ placeId: "gukbap", vote: 1, saved: true, signedIn: true, returnTo: "/places/gukbap" });

    expect(html).not.toContain("비추천 이유를 하나 선택해 주세요");
    expect(html).not.toContain("name=\"reason\"");
  });
});
