import { Form, Link } from "react-router";
import { readPlaceSearchContext, type PlaceSearchContext } from "../../features/places/place-search-feedback";
import { publicPlaceBrowseHref } from "../../features/places/public-place-browse";

export function PlaceSearchForm({ context, pending = false, retry = false }: { context: PlaceSearchContext; pending?: boolean; retry?: boolean }) {
  return <Form method="get" action="/places" className="discovery-search" reloadDocument={retry}>
    <label htmlFor="place-query">장소 검색</label>
    <input key={context.query} id="place-query" name="q" defaultValue={context.query} readOnly={pending} placeholder="장소 이름이나 주소 검색" />
    <input type="hidden" name="category" value={context.categorySlug} />
    <input type="hidden" name="bbox" value={context.bbox.join(",")} />
    {context.tempOnly && <input type="hidden" name="temp" value="1" />}
    {context.badges.map((badge, index) => <input key={`${badge}-${index}`} type="hidden" name="badge" value={badge} />)}
    <button disabled={pending}>{pending ? "찾는 중…" : retry ? "다시 검색" : "찾기"}</button>
  </Form>;
}

export function PlaceSearchError({ search, status = 500 }: { search: string; status?: number }) {
  const context = readPlaceSearchContext(search);
  const heading = status === 400 ? "검색 페이지를 확인해 주세요" : status === 403 ? "이 화면에 접근할 수 없어요" : status === 404 ? "요청한 장소 목록을 찾지 못했어요" : "장소를 불러오지 못했어요";
  return <main id="main" className="shell discovery-page">
    <h1>{heading}</h1>
    <p role="alert">{status === 400 ? "페이지 번호가 올바르지 않습니다. 검색 조건을 유지하고 첫 페이지부터 다시 찾을 수 있어요." : "검색 조건은 남겨 두었습니다. 연결을 확인한 뒤 다시 검색해 주세요."}</p>
    <PlaceSearchForm context={context} retry />
    <nav className="flex flex-wrap gap-4" aria-label="검색 복구">
      <Link className="inline-flex min-h-11 items-center underline!" to="/places">전체 목록에서 다시 시작</Link>
      <Link className="inline-flex min-h-11 items-center underline!" to={publicPlaceBrowseHref("map", search)}>지도에서 보기</Link>
    </nav>
  </main>;
}
