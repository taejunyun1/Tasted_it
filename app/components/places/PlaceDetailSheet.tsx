import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { loader as placeDetailLoader } from "../../routes/place-detail";

type DetailData = Awaited<ReturnType<typeof placeDetailLoader>>;

export function PlaceDetailSheet({ slug, onClose }: { slug: string | null; onClose: () => void }) {
  const detail = useFetcher<DetailData>();
  useEffect(() => { if (slug) detail.load(`/places/${slug}`); }, [slug]);
  useEffect(() => {
    if (!slug) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", close); };
  }, [slug, onClose]);
  if (!slug) return null;
  const data = detail.data;
  return <div className="place-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="place-detail-sheet" role="dialog" aria-modal="true" aria-label={data ? `${data.place.name} 상세 정보` : "장소 상세 불러오는 중"}>
      <div className="place-detail-sheet__handle" aria-hidden="true" />
      <button type="button" className="place-detail-sheet__close" aria-label="상세 정보 닫기" onClick={onClose}>×</button>
      {!data ? <p className="place-detail-sheet__loading">장소 정보를 불러오는 중…</p> : <>
        <div className="place-detail-sheet__hero">{data.place.heroImageUrl ? <img src={data.place.heroImageUrl} alt="" /> : <span>{data.place.primaryCategory.emoji}</span>}</div>
        <div className="place-detail-sheet__body">
          <div className="place-detail-sheet__meta"><p className="eyebrow">{data.place.primaryCategory.emoji} {data.place.primaryCategory.name} · {data.place.neighborhood}</p><span className="place-verified-badge">검수 완료</span></div>
          <h2>{data.place.name}</h2>
          <address>{data.place.address}</address>
          <div className="place-detail-sheet__score"><strong>{data.rating.overallScore === null ? `${data.rating.overallSampleCount}/8` : `${data.rating.overallScore}%`}</strong><span>{data.rating.overallScore === null ? "평가 공개까지" : "추천 지표"}</span></div>
          <div className="place-detail-sheet__breakdown"><span>일반 회원 <b>{data.rating.userScore ?? `${data.rating.userSampleCount}/8`}</b></span><span>리뷰어 <b>{data.rating.reviewerScore ?? `${data.rating.reviewerSampleCount}/8`}</b></span></div>
          {data.flavorPrint.status === "VISIBLE" && <section><h3>Flavor Print</h3>{data.flavorPrint.dimensions.map((dimension) => <div className="place-detail-sheet__flavor" key={dimension.key}><span>{dimension.key}</span><meter min="1" max="5" value={dimension.median} /><b>{dimension.median}/5</b></div>)}</section>}
          <dl><div><dt>주소</dt><dd>{data.place.address}</dd></div><div><dt>주차</dt><dd>{data.place.parkingSummary ?? "정보 확인 중"}</dd></div>{data.place.phone && <div><dt>전화</dt><dd>{data.place.phone}</dd></div>}</dl>
          <div className="place-detail-sheet__actions">
            {data.user ? <detail.Form method="post" action={`/places/${slug}`}><input type="hidden" name="intent" value="save"/><input type="hidden" name="saved" value={String(!data.saved)}/><button className="place-detail-sheet__save">{data.saved ? "맛집지도에서 빼기" : "맛집지도에 추가"}</button></detail.Form> : <a className="place-detail-sheet__save" href="/login">로그인하고 맛집지도에 추가</a>}
            <a href={`https://map.naver.com/p/search/${encodeURIComponent(data.place.address)}`} target="_blank" rel="noreferrer">네이버 길찾기 ↗</a>
          </div>
        </div>
      </>}
    </aside>
  </div>;
}
