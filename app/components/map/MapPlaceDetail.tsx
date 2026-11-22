import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router";
import { restoreVisibleFocus } from "../../features/a11y/focus-return";
import { formatPublicRatingSummary } from "../../features/places/place-discovery";
import { PLACE_DETAIL_MOBILE_QUERY, shouldOpenPlaceDetailSheet } from "../../features/places/place-detail-sheet";
import { publicRatingFromPlace } from "../../features/ratings/public-rating";
import { PublicRatingMeta } from "../ratings/PublicRatingMeta";
import type { PlaceSummary } from "../../features/places/place.types";
import { safePlaceDetailSearchPath, type OpenPlaceDetail } from "../places/PlaceCard";

export function MapPlaceDetail({ place, onBack, onOpenDetail }: { place: PlaceSummary; onBack: () => void; onOpenDetail: OpenPlaceDetail }) {
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rating = publicRatingFromPlace(place);
  const score = rating.overallScore;
  const isVisible = score != null;
  const voteCount = rating.overallSampleCount;
  const progressValue = score ?? Math.min(voteCount, 8);
  const progressMax = isVisible ? 100 : 8;
  const progressPercent = (progressValue / progressMax) * 100;
  const naverUrl = `https://map.naver.com/p/search/${encodeURIComponent(place.address || place.name)}`;
  const detailPath = safePlaceDetailSearchPath(place.slug);
  useLayoutEffect(() => {
    const opener = document.activeElement;
    const sheet = sheetRef.current;
    const pathname = window.location.pathname;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (window.location.pathname !== pathname || !sheet?.contains(document.activeElement)) return;
      if (restoreVisibleFocus(opener)) return;
      const mobile = window.matchMedia(PLACE_DETAIL_MOBILE_QUERY).matches;
      const fallback = document.querySelector<HTMLElement>(mobile ? ".map-mobile-tabs button[aria-pressed=true]" : "#map-search");
      if (mobile) fallback?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      restoreVisibleFocus(fallback);
    };
  }, []);

  return <aside ref={sheetRef} className="map-place-sheet" role="dialog" aria-label={`${place.name} 빠른 정보`} onKeyDown={(event) => {
    if (event.defaultPrevented || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onBack();
  }}>
    <div className="map-place-sheet__handle" aria-hidden="true" />
    <button ref={closeRef} type="button" className="map-place-sheet__close" aria-label="빠른 정보 닫기" onClick={onBack}>×</button>
    <div className="map-place-sheet__image">
      {place.heroImageUrl ? <img src={place.heroImageUrl} alt="" /> : <span>{place.primaryCategory.emoji}</span>}
    </div>
    <div className="map-place-sheet__identity">
      <div className="map-place-sheet__meta"><p>{place.primaryCategory.emoji} {place.primaryCategory.name} · {place.neighborhood || "지역 확인 중"}</p><span className="place-verified-badge">{place.tempCatalog ? "TEMP · 영업 미확인" : "공개 장소"}</span></div>
      <h2>{place.name}</h2>
      <address>{place.address || "주소 확인 중"}</address>
    </div>
    <div className="map-place-sheet__rating">
      <div className="map-place-sheet__rating-head">
        <span>{isVisible ? "추천 지표" : voteCount < 8 ? "평가 공개까지" : "추천 지표 계산 대기"}</span>
        <strong>{isVisible ? `${score}%` : voteCount < 8 ? `${voteCount}/8` : `${voteCount}명 평가`}</strong>
      </div>
      <div className="map-rating-bar" role="progressbar" aria-label={isVisible ? "추천 지표" : "평가 표본 수"} aria-valuemin={0} aria-valuemax={progressMax} aria-valuenow={progressValue} aria-valuetext={formatPublicRatingSummary(place)}>
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <small>{formatPublicRatingSummary(place)}</small>
      <PublicRatingMeta place={place} />
    </div>
    <div className="map-place-sheet__actions">
      <a className="map-place-sheet__route" href={naverUrl} target="_blank" rel="noreferrer">네이버 길찾기 ↗</a>
      {detailPath && <Link className="map-place-sheet__more" to={detailPath} onClick={(event) => {
        if (!shouldOpenPlaceDetailSheet({ ...event, mobile: window.matchMedia(PLACE_DETAIL_MOBILE_QUERY).matches })) return;
        event.preventDefault();
        onOpenDetail(detailPath, event.currentTarget);
      }}>상세 보기</Link>}
    </div>
  </aside>;
}
