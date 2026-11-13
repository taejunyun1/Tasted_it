import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { loader as placeDetailLoader } from "../../routes/place-detail";
import { useDialogFocusTrap } from "../a11y/useDialogFocusTrap";
import { safePlaceDetailRequestPath } from "./PlaceCard";
import { GuestSaveControl } from "../onboarding/GuestSaveControl";
import { TempCatalogNotice } from "../../features/temp-catalog/TempCatalogNotice";

type DetailData = Awaited<ReturnType<typeof placeDetailLoader>>;

export function PlaceDetailSheet({ detailPath, slug, onClose }: {
  detailPath?: string | null;
  slug?: string | null;
  onClose: () => void;
}) {
  const detail = useFetcher<DetailData>();
  const save = useFetcher<{ ok: true }>();
  const sheetRef = useRef<HTMLElement>(null);
  const requestPath = detailPath === undefined
    ? safePlaceDetailRequestPath(slug ? `/places/${slug}` : null)
    : safePlaceDetailRequestPath(detailPath);
  useEffect(() => { if (requestPath) detail.load(requestPath); }, [requestPath]);
  useEffect(() => {
    if (!requestPath) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [requestPath]);
  useDialogFocusTrap(sheetRef, { active: Boolean(requestPath), onClose });
  if (!requestPath) return null;
  const data = detail.data;
  return <div className="place-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={sheetRef} className="place-detail-sheet" role="dialog" aria-modal="true" tabIndex={-1} aria-label={data ? `${data.place.name} 상세 정보` : "장소 상세 불러오는 중"}>
      <div className="place-detail-sheet__handle" aria-hidden="true" />
      <button type="button" className="place-detail-sheet__close" aria-label="상세 정보 닫기" onClick={onClose}>×</button>
      {!data ? <p className="place-detail-sheet__loading">장소 정보를 불러오는 중…</p> : <>
        <div className="place-detail-sheet__hero">{data.place.heroImageUrl ? <img src={data.place.heroImageUrl} alt="" /> : <span>{data.place.primaryCategory.emoji}</span>}</div>
        <div className="place-detail-sheet__body">
          <div className="place-detail-sheet__meta"><p className="eyebrow">{data.place.primaryCategory.emoji} {data.place.primaryCategory.name} · {data.place.neighborhood}</p><span className="place-verified-badge">{data.place.tempCatalog ? "TEMP · 영업 미확인" : "검수 완료"}</span></div>
          <h2>{data.place.name}</h2>
          {data.place.tempCatalog && <TempCatalogNotice info={data.place.tempCatalog} />}
          <address>{data.place.address}</address>
          <div className="place-detail-sheet__score"><strong>{data.rating.overallScore === null ? `${data.rating.overallSampleCount}/8` : `${data.rating.overallScore}%`}</strong><span>{data.rating.overallScore === null ? "평가 공개까지" : "추천 지표"}</span></div>
          <div className="place-detail-sheet__breakdown"><span>일반 회원 <b>{data.rating.userScore ?? `${data.rating.userSampleCount}/8`}</b></span><span>리뷰어 <b>{data.rating.reviewerScore ?? `${data.rating.reviewerSampleCount}/8`}</b></span></div>
          {data.flavorPrint.status === "VISIBLE" && <section><h3>Flavor Print</h3>{data.flavorPrint.dimensions.map((dimension) => <div className="place-detail-sheet__flavor" key={dimension.key}><span>{dimension.key}</span><meter min="1" max="5" value={dimension.median} /><b>{dimension.median}/5</b></div>)}</section>}
          <dl><div><dt>주소</dt><dd>{data.place.address}</dd></div><div><dt>주차</dt><dd>{data.place.parkingSummary ?? "정보 확인 중"}</dd></div>{data.place.phone && <div><dt>전화</dt><dd>{data.place.phone}</dd></div>}</dl>
          <div className="place-detail-sheet__actions">
            {data.user ? <save.Form method="post" action={requestPath}><input type="hidden" name="intent" value="save"/><input type="hidden" name="saved" value={String(!data.saved)}/><button className="place-detail-sheet__save">{data.saved ? "맛집지도에서 빼기" : "맛집지도에 추가"}</button></save.Form> : <div><a className="place-detail-sheet__save" href={`/login?returnTo=${encodeURIComponent(requestPath)}`}>로그인하고 맛집지도에 추가</a><GuestSaveControl placeId={data.place.id} returnTo={requestPath} showLogin={false}/></div>}
            {data.user && data.voteEventId && <save.Form method="post" action={requestPath}><input type="hidden" name="intent" value="withdraw"/><input type="hidden" name="expectedEventId" value={data.voteEventId}/><button disabled={save.state !== "idle"}>평가 취소</button></save.Form>}
            <a href={`https://map.naver.com/p/search/${encodeURIComponent(data.place.address)}`} target="_blank" rel="noreferrer">네이버 길찾기 ↗</a>
          </div>
        </div>
      </>}
    </aside>
  </div>;
}
