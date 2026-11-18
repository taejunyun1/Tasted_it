import { Form, Link } from "react-router";

import { buildPlaceReviewPageHref, type PlaceReviewQuery } from "../../features/places/place-review-pagination";
import type { PlaceReviewPage } from "../../features/places/place-review-query.server";

export function PlaceReviewToolbar({ query, page, suggestionPage = 1 }: { query: PlaceReviewQuery; page: PlaceReviewPage; suggestionPage?: number }) {
  const { pagination } = page;
  function href(pageNumber: number) {
    const params = new URLSearchParams(buildPlaceReviewPageHref(query, pageNumber).slice(1));
    if (suggestionPage > 1) params.set("suggestionPage", String(suggestionPage));
    return `?${params.toString()}`;
  }
  return <>
    <Form method="get" className="place-review-toolbar">
      <input type="hidden" name="flow" value="review" />
      <input type="hidden" name="step" value={query.step} />
      {suggestionPage > 1 && <input type="hidden" name="suggestionPage" value={suggestionPage} />}
      <label>검색<input name="q" defaultValue={query.query} placeholder="상호명 또는 주소" /></label>
      <label>지역<select name="region" defaultValue={query.region ?? ""}><option value="">전체</option><option value="GWANGJU">광주</option><option value="JEONNAM">전남</option></select></label>
      <label>상태<select name="status" defaultValue={query.status ?? "pending"}><option value="pending">대기</option><option value="ready">이동 가능</option><option value="attention">확인 필요</option><option value="hold">보류</option></select></label>
      <label>페이지 크기<select name="pageSize" defaultValue={String(query.pageSize)}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
      <button>필터 적용</button>
      <Link to={`/admin/place-operations?flow=review&step=${query.step}`}>초기화</Link>
    </Form>
    <div className="place-review-pagination" aria-label="검수 목록 페이지">
      <p><strong>총 {pagination.total}곳</strong> · {pagination.page}/{pagination.totalPages} 페이지</p>
      <div>
        {pagination.page > 1 ? <Link to={href(pagination.page - 1)}>이전</Link> : <span aria-disabled="true">이전</span>}
        {pagination.page < pagination.totalPages ? <Link to={href(pagination.page + 1)}>다음</Link> : <span aria-disabled="true">다음</span>}
      </div>
    </div>
  </>;
}
