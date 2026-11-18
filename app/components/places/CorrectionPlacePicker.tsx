import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { correctionPlaceSearchHref, type CorrectionPlaceOption, type CorrectionPlacePage, type CorrectionPlaceResponse } from "../../features/places/correction-place-search";
import "../../styles/reviewer-place-picker.css";

type SearchRequest = { key: string; query: string; cursor: string | null; cursors: Array<string | null>; index: number };
export function CorrectionPlacePicker({ initialPage, selectedPlace, onChoose, disabled = false }: {
  initialPage: CorrectionPlacePage; selectedPlace: CorrectionPlaceOption | null;
  onChoose: (place: CorrectionPlaceOption | null) => void; disabled?: boolean;
}) {
  const fetcher = useFetcher<CorrectionPlaceResponse>();
  const [query, setQuery] = useState(initialPage.query), [page, setPage] = useState(initialPage);
  const [cursors, setCursors] = useState<Array<string | null>>([null]), [pageIndex, setPageIndex] = useState(0);
  const [error, setError] = useState("");
  const sequence = useRef(0), pending = useRef<SearchRequest | null>(null), lastRequest = useRef<SearchRequest | null>(null);
  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle" || fetcher.data.requestKey !== pending.current?.key) return;
    if (fetcher.data.ok) { setPage(fetcher.data.page); setCursors(pending.current.cursors); setPageIndex(pending.current.index); setError(""); }
    else setError(fetcher.data.message);
    pending.current = null;
  }, [fetcher.data, fetcher.state]);
  function request(nextQuery: string, cursor: string | null, nextCursors: Array<string | null>, index: number) {
    if (pending.current || disabled) return;
    const key = `correction-${++sequence.current}`;
    pending.current = { key, query: nextQuery, cursor, cursors: nextCursors, index };
    lastRequest.current = pending.current;
    setError("");
    void fetcher.load(correctionPlaceSearchHref(nextQuery, key, cursor));
  }
  const busy = fetcher.state !== "idle";
  return <fieldset className="reviewer-place-picker" disabled={disabled}>
    <legend>정정할 장소</legend>
    <p>상호명이나 주소로 찾으세요. 검색·페이지를 바꿔도 선택한 장소와 작성 내용은 유지됩니다.</p>
    <div className="reviewer-place-search-controls" role="search" aria-label="정정할 장소 검색">
      <label className="reviewer-search"><span>장소 검색</span><input value={query} maxLength={100} placeholder="상호명 또는 주소로 검색" onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        event.preventDefault(); if (!busy) request(query.trim(), null, [null], 0);
      }}/></label>
      <button type="button" className="reviewer-secondary" style={{ width: "auto" }} disabled={busy} onClick={() => request(query.trim(), null, [null], 0)}>{busy ? "장소 검색 중…" : "장소 찾기"}</button>
    </div>
    {error && <p role="alert">{error} <button type="button" className="reviewer-secondary" disabled={busy} onClick={() => { const previous = lastRequest.current; if (previous) request(previous.query, previous.cursor, previous.cursors, previous.index); }}>검색 다시 시도</button></p>}
    <p role="status">{busy ? "기존 결과를 유지하며 장소를 찾고 있어요." : `${page.query ? `“${page.query}” 검색 결과` : "전체 정정 가능 장소"} · ${pageIndex + 1}페이지 · ${page.places.length}곳${page.nextCursor ? " · 다음 페이지 있음" : ""}`} · 한 번에 최대 20곳</p>
    <p aria-live="polite">선택한 장소: {selectedPlace ? <><strong>{selectedPlace.name}</strong> · {selectedPlace.address}</> : "목록에 없는 장소"}</p>
    <button type="button" aria-pressed={!selectedPlace} onClick={() => onChoose(null)}>목록에 없는 장소로 요청</button>
    <div className="reviewer-place-grid" role="group" aria-label="정정 장소 검색 결과" aria-busy={busy}>
      {page.places.map(place => <button type="button" className="reviewer-secondary" style={{ color: "var(--text)" }} key={place.id} aria-pressed={selectedPlace?.id === place.id} onClick={() => onChoose(place)}><strong>{place.name}</strong><span>{place.address}</span><small>{selectedPlace?.id === place.id ? "선택됨" : "이 장소 선택"}</small></button>)}
      {!page.places.length && <p>일치하는 장소가 없습니다. 다른 검색어를 사용하거나 목록에 없는 장소로 요청해 주세요.</p>}
    </div>
    <nav className="reviewer-place-search-controls" aria-label="정정 장소 검색 페이지">
      <button type="button" className="reviewer-secondary" disabled={busy || pageIndex === 0} onClick={() => request(page.query, cursors[pageIndex - 1], cursors, pageIndex - 1)}>이전 장소</button>
      <button type="button" className="reviewer-secondary" disabled={busy || !page.nextCursor} onClick={() => request(page.query, page.nextCursor, [...cursors.slice(0, pageIndex + 1), page.nextCursor], pageIndex + 1)}>다음 장소</button>
    </nav>
  </fieldset>;
}
