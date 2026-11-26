import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("react-router", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-router")>(),
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...props }, children),
  Form: ({ children, ...props }: { children?: ReactNode }) => createElement("form", props, children),
  useNavigation: () => ({ state: "idle" }),
}));

import AdminPlaces from "../../app/routes/admin-places";
import { ErrorBoundary as SyncErrorBoundary } from "../../app/routes/admin-data-sync";
import { PlaceReviewToolbar } from "../../app/components/admin/PlaceReviewToolbar";
import { parsePlaceReviewQuery } from "../../app/features/places/place-review-pagination";
import type { AdminPlaceSummary } from "../../app/features/places/place.types";

const query = parsePlaceReviewQuery(new URL("https://example.com/?step=1&q=국밥&region=GWANGJU&page=2"));

describe("admin review results and navigation", () => {
  it("renders every skipped ID with Korean reasons and never exposes unknown raw errors", async () => {
    const { PlaceReviewSkippedResults } = await import("../../app/components/admin/PlaceReviewSkippedResults");
    const html = renderToStaticMarkup(createElement(PlaceReviewSkippedResults, { skipped: [
      { workItemId: "stale-item", code: "STALE_WORK_ITEM" },
      { candidatePlaceId: "duplicate-place", code: "DUPLICATE_CANDIDATE_STALE" },
      { workItemId: "unknown-item", code: "internal-provider-secret-error" },
    ] }));
    expect(html).toContain('role="status"');
    expect(html).toContain("건너뛴 항목 3건");
    expect(html).toContain("stale-item");
    expect(html).toContain("다른 작업자가 먼저 처리");
    expect(html).toContain("duplicate-place");
    expect(html).toContain("중복 후보");
    expect(html).toContain("unknown-item");
    expect(html).toContain("검수 요청을 완료하지 못했습니다");
    expect(html).not.toContain("internal-provider-secret-error");
  });

  it("makes unavailable review-page controls noninteractive", () => {
    const html = renderToStaticMarkup(createElement(PlaceReviewToolbar, {
      query, page: { rows: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } },
    }));
    expect(html).not.toMatch(/<a[^>]*>이전<\/a>/);
    expect(html).not.toMatch(/<a[^>]*>다음<\/a>/);
    expect(html).toContain('<span aria-disabled="true">이전</span>');
    expect(html).toContain('<span aria-disabled="true">다음</span>');
  });

  it("keeps active review-page controls and filters", () => {
    const html = renderToStaticMarkup(createElement(PlaceReviewToolbar, {
      query, suggestionPage: 8, page: { rows: [], pagination: { page: 2, pageSize: 25, total: 51, totalPages: 3 } },
    }));
    expect(html).toMatch(/<a[^>]*page=1[^>]*region=GWANGJU[^>]*>이전<\/a>/);
    expect(html).toMatch(/<a[^>]*page=3[^>]*region=GWANGJU[^>]*>다음<\/a>/);
    expect(html).toMatch(/<a[^>]*page=3[^>]*suggestionPage=8[^>]*>다음<\/a>/);
  });

  it("shows suggestion totals and an independent final-page link", async () => {
    const { PlaceSuggestionPagination } = await import("../../app/components/admin/PlaceSuggestionPagination");
    const html = renderToStaticMarkup(createElement(PlaceSuggestionPagination, {
      query, pagination: { page: 8, pageSize: 25, total: 201, totalPages: 9 },
    }));
    expect(html).toContain("총 201건");
    expect(html).toContain("8/9 페이지");
    expect(html).toMatch(/<a[^>]*page=2[^>]*suggestionPage=9[^>]*>다음<\/a>/);
  });

  it("names the places table and column headers when there are places", () => {
    const places: AdminPlaceSummary[] = [{
      id: "place-1",
      slug: "sample-place",
      name: "합성 장소",
      status: "DRAFT",
      categoryName: "분식",
      updatedAt: "2026-11-22T00:00:00Z",
    }];
    const html = renderToStaticMarkup(createElement(AdminPlaces, { loaderData: { places } } as never));
    expect(html).toContain("<caption");
    expect(html).toContain("등록된 장소 목록 · 총 1곳");
    expect(html).toContain('aria-label="장소 목록 가로 스크롤" tabindex="0"');
    expect(html).toMatch(/<th[^>]*>장소<\/th>/);
  });

  it("explains the empty places list with direct management links", () => {
    const html = renderToStaticMarkup(createElement(AdminPlaces, { loaderData: { places: [] } } as never));
    expect(html).toContain("등록된 장소가 없습니다");
    expect(html).toContain('href="/admin/place-operations?step=1"');
    expect(html).toContain('href="/admin/import"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain('aria-label="장소 목록 가로 스크롤"');
  });

  it("distinguishes forbidden sync access from a loading failure", () => {
    const forbidden = renderToStaticMarkup(createElement(SyncErrorBoundary, {
      error: { status: 403, statusText: "Forbidden", internal: false, data: "Forbidden" },
    } as never));
    const unavailable = renderToStaticMarkup(createElement(SyncErrorBoundary, { error: new Error("upstream error") } as never));
    expect(forbidden).toContain("관리자만 조회할 수 있습니다");
    expect(forbidden).not.toContain("동기화 작업을 읽을 수 없습니다");
    expect(unavailable).toContain("동기화 작업을 읽을 수 없습니다");
    expect(unavailable).not.toContain("upstream error");
  });
});
