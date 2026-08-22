import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  HomeCurationCards,
  type HomeCurationPresentationProps,
} from "../../app/components/map/HomeCurationCards";
import { HomeCurationPanel } from "../../app/components/map/HomeCurationPanel";
import {
  homeSheetSnapAfterDrag,
  homeSheetSnapAfterPlaceSelect,
  HomeCurationSheet,
} from "../../app/components/map/HomeCurationSheet";
import type { HomeCurationPage } from "../../app/features/places/home-curation";

const page: HomeCurationPage = {
  algorithmVersion: "home-curation-v2",
  status: "READY",
  mode: "now",
  timeSlot: "lunch",
  radiusMeters: 3_000,
  candidateCount: 5,
  goldenFallback: false,
  notice: null,
  places: Array.from({ length: 5 }, (_, index) => ({
    id: `place-${index}`,
    slug: `place-${index}`,
    name: `추천 장소 ${index + 1}`,
    address: "광주광역시",
    neighborhood: `테스트동 ${index}`,
    latitude: 35.15 + index * 0.001,
    longitude: 126.92,
    phone: null,
    parkingSummary: null,
    heroImageUrl: null,
    searchText: "점심 국밥",
    kakaoPlaceId: null,
    primaryCategory: { slug: `category-${index}`, name: "국밥", emoji: "🍲" },
    positive: 18,
    negative: 2,
    ratingScore: 88,
    ratingSampleCount: 20,
    distanceMeters: 250 + index * 100,
    slot: index === 3 ? "TRUSTED_PICK" : index === 4 ? "DISCOVERY" : "BEST_NOW",
    rank: index + 1,
    recommendationReasons: index === 3
      ? ["리뷰어 Golden Pick", "평가 신뢰도 상위"]
      : ["현재 위치에서 가까움", "현재 시간대에 어울림", "표시하면 안 되는 이유"],
    isGoldenPick: index === 3,
  })),
};

const props: HomeCurationPresentationProps = {
  page,
  selectedPlaceId: "place-0",
  mode: "now",
  pending: false,
  error: null,
  onModeChange: vi.fn(),
  onSelect: vi.fn(),
  onLocate: vi.fn(),
  onRetry: vi.fn(),
};

const sheetProps = {
  ...props,
  snap: "half" as const,
  onSnapChange: vi.fn(),
};

const GOLDEN_FALLBACK_NOTICE = "현재 주변 Golden Pick이 없어 과거 선정 이력과 평가 기록을 바탕으로 추천합니다.";

describe("home curation presentation", () => {
  it("번호·거리·평가·실제 근거 두 개와 Golden Pick만 표시한다", () => {
    const html = renderToStaticMarkup(createElement(HomeCurationCards, props));

    expect(html).toContain("01");
    expect(html).toContain("250m");
    expect(html).toContain("추천 88% · 20명 평가");
    expect(html).toContain("현재 위치에서 가까움");
    expect(html).toContain("현재 시간대에 어울림");
    expect(html).not.toContain("표시하면 안 되는 이유");
    expect(html.match(/Golden Pick/g)).toHaveLength(1);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-place-id="place-0"');
  });

  it("데스크톱 패널과 모바일 시트는 추천 내용만 공유하고 지도 전환 버튼을 갖지 않는다", () => {
    const panel = renderToStaticMarkup(createElement(HomeCurationPanel, props));
    const sheet = renderToStaticMarkup(createElement(HomeCurationSheet, sheetProps));

    expect(panel).toContain("<h1>지금 갈 만한 5곳</h1>");
    expect(sheet).toContain("지금 갈 만한 5곳");
    expect(sheet).not.toContain("<h1>지금 갈 만한 5곳</h1>");
    expect(panel).toContain("내 취향");
    expect(panel).not.toContain("전체 지도");
    expect(sheet).not.toContain("전체 지도");
    expect(sheet).toContain('data-snap="half"');
  });

  it("Golden fallback 안내를 데스크톱 패널과 모바일 시트에 모두 표시한다", () => {
    const fallbackProps: HomeCurationPresentationProps = {
      ...props,
      page: {
        ...page,
        mode: "golden",
        radiusMeters: 5_000,
        candidateCount: 12,
        goldenFallback: true,
        notice: GOLDEN_FALLBACK_NOTICE,
        places: page.places.map((place) => ({
          ...place,
          isGoldenPick: false,
          recommendationReasons: ["최근 리뷰어 평가 기록이 있어요", "평가 신뢰도 상위"],
        })),
      },
    };
    const panel = renderToStaticMarkup(createElement(HomeCurationPanel, fallbackProps));
    const sheet = renderToStaticMarkup(createElement(HomeCurationSheet, {
      ...fallbackProps,
      snap: "half",
      onSnapChange: vi.fn(),
    }));

    expect(panel).toContain(GOLDEN_FALLBACK_NOTICE);
    expect(sheet).toContain(GOLDEN_FALLBACK_NOTICE);
    expect(panel).toContain("5km 안에서 추천");
    expect(sheet).toContain("5km 안에서 추천");
    expect(panel).not.toContain('data-kind="golden"');
    expect(sheet).not.toContain('data-kind="golden"');
  });

  it("36px 이상 위아래 드래그만 시트 스냅을 한 단계 바꾼다", () => {
    expect(homeSheetSnapAfterDrag("half", -35)).toBe("half");
    expect(homeSheetSnapAfterDrag("half", -36)).toBe("full");
    expect(homeSheetSnapAfterDrag("half", 36)).toBe("peek");
    expect(homeSheetSnapAfterDrag("peek", 100)).toBe("peek");
  });

  it("추천 행을 선택하면 지도 확인용 peek 상태로 접는다", () => {
    expect(homeSheetSnapAfterPlaceSelect()).toBe("peek");
  });

  it("시트는 라우트가 전달한 현재 스냅을 렌더한다", () => {
    const html = renderToStaticMarkup(createElement(HomeCurationSheet, {
      ...props,
      snap: "peek",
      onSnapChange: vi.fn(),
    }));

    expect(html).toContain('data-snap="peek"');
  });

  it("peek 시트는 선택 장소의 순위와 이름을 위치 확인 정보로 표시한다", () => {
    const html = renderToStaticMarkup(createElement(HomeCurationSheet, {
      ...props,
      snap: "peek",
      onSnapChange: vi.fn(),
    }));

    expect(html).toContain('class="home-curation-sheet__selection"');
    expect(html).toContain('class="home-curation-sheet__selection-rank">01</span>');
    expect(html).toContain('class="home-curation-sheet__selection-name">추천 장소 1</strong>');
  });
});
