import { Link } from "react-router";

import { buildPlaceReviewPageHref, type PlaceReviewQuery } from "../../features/places/place-review-pagination";

export function PlaceSuggestionPagination({ query, pagination }: {
  query: PlaceReviewQuery;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}) {
  function href(page: number) {
    const params = new URLSearchParams(buildPlaceReviewPageHref(query, query.page).slice(1));
    params.set("suggestionPage", String(page));
    return `?${params.toString()}`;
  }
  return <nav className="place-review-pagination" aria-label="회원 장소 제안 페이지">
    <p><strong>총 {pagination.total}건</strong> · {pagination.page}/{pagination.totalPages} 페이지 · 페이지당 {pagination.pageSize}건</p>
    <div>
      {pagination.page > 1 ? <Link to={href(pagination.page - 1)}>이전</Link> : <span aria-disabled="true">이전</span>}
      {pagination.page < pagination.totalPages ? <Link to={href(pagination.page + 1)}>다음</Link> : <span aria-disabled="true">다음</span>}
    </div>
  </nav>;
}
