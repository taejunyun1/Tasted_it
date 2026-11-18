import { useEffect, useRef } from "react";
import { Link, useFetcher } from "react-router";
import type { MemberSaveResult } from "../../features/saves/member-save-feedback";

type SavedPlace = { id: string; slug: string; name: string; categoryEmoji: string; categoryName: string; neighborhood: string };

export function MemberSavedPlaces({ places }: { places: SavedPlace[] }) {
  const fetcher = useFetcher<MemberSaveResult>();
  const pending = fetcher.state !== "idle";
  const pendingPlaceId = String(fetcher.formData?.get("placeId") ?? "");
  const result = fetcher.data?.kind === "member-save" ? fetcher.data : null;
  const unknown = result?.outcome === "UNKNOWN";
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (!pending && result) notice.current?.focus(); }, [pending, result]);

  return <section className="member-activity-card" aria-labelledby="member-saved-title" aria-busy={pending}>
    <header><h2 id="member-saved-title">저장한 장소</h2><span>{places.length}곳</span></header>
    {!pending && result && <p ref={notice} id="member-save-feedback" role={result.ok ? "status" : "alert"} tabIndex={-1}
      className={`member-notice${result.ok ? "" : " member-notice--error"}`}>{result.message}
      {unknown && <> <Link to="/me" reloadDocument>현재 목록 다시 확인</Link></>}
    </p>}
    {pending && <p role="status">저장 목록을 갱신하고 있습니다.</p>}
    {places.length ? <div className="member-place-list">{places.map(place => <article className="member-place-row" key={place.id}>
      <div><p>{place.categoryEmoji} {place.categoryName} · {place.neighborhood}</p><h3><Link to={`/places/${place.slug}`}>{place.name}</Link></h3></div>
      <fetcher.Form method="post" action="/me" onSubmit={(event) => { if (pending || unknown) event.preventDefault(); }}>
        <input type="hidden" name="intent" value="unsave" />
        <input type="hidden" name="placeId" value={place.id} />
        <button type="submit" disabled={pending || unknown} aria-describedby={unknown ? "member-save-feedback" : undefined}>{pending && pendingPlaceId === place.id ? "저장 해제 중…" : "저장 해제"}</button>
      </fetcher.Form>
    </article>)}</div> : <div className="member-empty"><p>지도에서 다시 보고 싶은 장소를 저장해 보세요.</p><Link to="/places">맛집 둘러보기</Link></div>}
  </section>;
}
