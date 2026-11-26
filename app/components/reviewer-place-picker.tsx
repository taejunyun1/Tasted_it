import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { reviewerPlaceSearchHref, type ReviewerPlaceOption, type ReviewerPlacePage, type ReviewerPlaceResponse } from "../features/ratings/reviewer-place-search";
import "../styles/reviewer-place-picker.css";

export function ReviewerPlacePicker({ initialPage, selectedPlace, onChoose }: { initialPage: ReviewerPlacePage; selectedPlace: ReviewerPlaceOption | null; onChoose: (place: ReviewerPlaceOption) => void }) {
  const fetcher = useFetcher<ReviewerPlaceResponse>();
  const [query, setQuery] = useState(initialPage.query);
  const [page, setPage] = useState(initialPage);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [error, setError] = useState<Extract<ReviewerPlaceResponse, { ok: false }> | null>(null);
  const sequence = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ key: string; query: string; cursor: string | null; cursors: Array<string | null>; index: number } | null>(null);
  const lastRequest = useRef<typeof pending.current>(null);

  useEffect(() => {
    setQuery(initialPage.query); setPage(initialPage); setCursors([null]); setPageIndex(0); setError(null); pending.current = null;
  }, [initialPage]);
  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle" || fetcher.data.requestKey !== pending.current?.key) return;
    if (fetcher.data.ok) { setPage(fetcher.data.page); setCursors(pending.current.cursors); setPageIndex(pending.current.index); setError(null); }
    else setError(fetcher.data);
    pending.current = null;
  }, [fetcher.data, fetcher.state]);
  useEffect(() => {
    if (query.trim() === page.query) return;
    const timer = setTimeout(() => request(query.trim(), null, [null], 0), 250);
    debounce.current = timer;
    return () => { clearTimeout(timer); if (debounce.current === timer) debounce.current = null; };
  }, [query]);

  function request(nextQuery: string, cursor: string | null, nextCursors: Array<string | null>, index: number) {
    if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
    const key = `place-${++sequence.current}`;
    pending.current = { key, query: nextQuery, cursor, cursors: nextCursors, index };
    lastRequest.current = pending.current;
    setError(null);
    void fetcher.load(reviewerPlaceSearchHref(nextQuery, key, cursor));
  }

  function retry() {
    const previous = lastRequest.current;
    if (!previous) return;
    if (error?.restartSearch) request(previous.query, null, [null], 0);
    else request(previous.query, previous.cursor, previous.cursors, previous.index);
  }

  const busy = fetcher.state !== "idle";
  return <div className="reviewer-place-picker">
    <div className="reviewer-place-search-controls" role="search" aria-label="평가할 장소 검색">
      <label className="reviewer-search"><span>장소 검색</span><input value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); if (!event.nativeEvent.isComposing && !busy) request(query.trim(), null, [null], 0); }
      }} placeholder="다녀온 장소 검색" /></label>
      <button type="button" className="reviewer-secondary" disabled={busy} onClick={() => request(query.trim(), null, [null], 0)}>{busy ? "장소 검색 중…" : "장소 찾기"}</button>
    </div>
    {error && <p role="alert">{error.message} <button type="button" className="reviewer-secondary" disabled={busy} onClick={retry}>{error.restartSearch ? "첫 페이지 다시 확인" : "다시 시도"}</button></p>}
    <p role="status" aria-live="polite">{page.query ? `“${page.query}” 검색 결과 · ` : "전체 검수 장소 · "}{busy ? "기존 결과를 유지하며 장소를 확인하고 있어요." : `${pageIndex + 1}페이지 · ${page.places.length}곳${page.nextCursor ? " · 다음 페이지 있음" : ""}`} · 한 번에 최대 20곳</p>
    {selectedPlace && !page.places.some((place) => place.placeId === selectedPlace.placeId) && (
      <p className="reviewer-place-selection">선택한 장소 <strong>{selectedPlace.placeName}</strong> · {selectedPlace.address}</p>
    )}
    <div className="reviewer-place-grid" aria-label="장소 검색 결과" aria-busy={busy}>
      {page.places.map((place) => (
        <button key={place.placeId} type="button" aria-pressed={selectedPlace?.placeId === place.placeId} onClick={() => onChoose(place)}>
          <span>{place.categoryEmoji} {place.categoryName}{place.neighborhood && ` · ${place.neighborhood}`}</span>
          <strong>{place.placeName}</strong>
          <span>{place.address}</span>
          <small>{selectedPlace?.placeId === place.placeId ? "선택됨" : "이 장소 선택"}</small>
        </button>
      ))}
      {!page.places.length && <p className="reviewer-empty">일치하는 검수 장소가 없어요. 다른 검색어를 사용하거나 장소 제안에서 먼저 알려주세요.</p>}
    </div>
    <nav className="reviewer-place-search-controls" aria-label="장소 검색 결과 페이지">
      <button type="button" className="reviewer-secondary" disabled={busy || pageIndex === 0} onClick={() => request(page.query, cursors[pageIndex - 1], cursors, pageIndex - 1)}>이전 장소</button>
      <button type="button" className="reviewer-secondary" disabled={busy || !page.nextCursor} onClick={() => request(page.query, page.nextCursor, [...cursors.slice(0, pageIndex + 1), page.nextCursor], pageIndex + 1)}>다음 장소</button>
    </nav>
  </div>;
}
