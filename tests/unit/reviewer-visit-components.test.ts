import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ReviewerVisitFlow } from "../../app/components/reviewer-visit-flow";

vi.mock("react-router", () => ({
  useFetcher: () => ({ data: null, state: "idle", submit: () => {}, Form: "form" }),
  Link: ({ to, children, className }: { to: string; children?: unknown; className?: string }) =>
    createElement("a", { href: to, className }, children),
}));

const props = {
  places: [{
    placeId: "sample-place-1",
    placeName: "Re:Taste 샘플 라멘 동명",
    neighborhood: "동명동",
    categoryId: "cat-ramen",
    categoryName: "라멘",
    categoryEmoji: "🍜",
  }],
  categories: [{ id: "cat-ramen", name: "라멘", emoji: "🍜" }],
  history: [],
  goldenQuota: { used: 1, limit: 3, remaining: 2 },
  publishedReviewId: null,
  photoUploadEnabled: true,
  notice: null,
};

describe("ReviewerVisitFlow", () => {
  it("renders the current app-first publishing contract", () => {
    const html = renderToStaticMarkup(createElement(ReviewerVisitFlow, props));
    expect(html).toContain("방문 리뷰 발행");
    expect(html).toContain("1. 장소");
    expect(html).toContain("2. 평가");
    expect(html).toContain("3. 맛 배지");
    expect(html).toContain("4. 사진·Golden");
    expect(html).toContain("5. 확인");
    expect(html).toContain("추천");
    expect(html).toContain("보류");
    expect(html).toContain("비추천");
    expect(html).toContain("서술형 후기 없이");
    expect(html).toContain('name="photos"');
    expect(html).toContain("발행 후 모든 사용자에게 공개됩니다");
    expect(html).toContain("Golden Pick 선택");
    expect(html).toContain("이번 달 1/3 사용");
  });

  it("renders recent published review history without peer identities", () => {
    const html = renderToStaticMarkup(createElement(ReviewerVisitFlow, { ...props, history: [{
      id: "visit-1",
      placeId: "sample-place-1",
      placeSlug: "sample-dongmyeong-ramen",
      placeName: "Re:Taste 샘플 라멘 동명",
      categoryId: "cat-ramen",
      categoryName: "라멘",
      evaluation: "RECOMMEND",
      badgesJson: '["육수 농도 선명"]',
      photoCount: 0,
      goldenPickEventId: null,
      version: 1,
      publishedAt: "2026-08-12T00:00:00Z",
      photos: [],
    }] }));
    expect(html).toContain("최근 발행");
    expect(html).toContain('href="/places/sample-dongmyeong-ramen"');
    expect(html).toContain("육수 농도 선명");
    expect(html).not.toContain("동료 리뷰어 이름");
    expect(html).not.toContain("peerUserId");
  });

  it("renders public photo URLs in the reviewer’s own published history", () => {
    const html = renderToStaticMarkup(createElement(ReviewerVisitFlow, { ...props, history: [{
      id: "visit-photo-1",
      placeId: "sample-place-1",
      placeSlug: "sample-dongmyeong-ramen",
      placeName: "Re:Taste 샘플 라멘 동명",
      categoryId: "cat-ramen",
      categoryName: "라멘",
      evaluation: "RECOMMEND",
      badgesJson: "[]",
      photoCount: 1,
      goldenPickEventId: null,
      version: 1,
      publishedAt: "2026-08-13T00:00:00Z",
      photos: [{ id: "public-photo-1", url: "/review-photos/public-photo-1" }],
    }] }));
    expect(html).toContain('src="/review-photos/public-photo-1"');
    expect(html).not.toContain("reviews/visit-photo-1");
  });
});
