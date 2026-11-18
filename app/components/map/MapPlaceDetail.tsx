import { useRef } from "react";
import { Link } from "react-router";
import { formatPublicRatingSummary } from "../../features/places/place-discovery";
import { publicRatingFromPlace } from "../../features/ratings/public-rating";
import { PublicRatingMeta } from "../ratings/PublicRatingMeta";
import type { PlaceSummary } from "../../features/places/place.types";
import { useDialogFocusTrap } from "../a11y/useDialogFocusTrap";

export function MapPlaceDetail({ place, onBack, onOpenDetail }: { place: PlaceSummary; onBack: () => void; onOpenDetail: (slug: string) => void }) {
  const sheetRef = useRef<HTMLElement>(null);
  const rating = publicRatingFromPlace(place);
  const score = rating.overallScore;
  const isVisible = score != null;
  const voteCount = rating.overallSampleCount;
  const progressValue = score ?? Math.min(voteCount, 8);
  const progressMax = isVisible ? 100 : 8;
  const progressPercent = (progressValue / progressMax) * 100;
  const naverUrl = `https://map.naver.com/p/search/${encodeURIComponent(place.address || place.name)}`;
  useDialogFocusTrap(sheetRef, { active: true, onClose: onBack });

  return <aside ref={sheetRef} className="map-place-sheet" role="dialog" aria-modal="true" tabIndex={-1} aria-label={`${place.name} 빠른 정보`}>
    <div className="map-place-sheet__handle" aria-hidden="true" />
    <button type="button" className="map-place-sheet__close" aria-label="빠른 정보 닫기" onClick={onBack}>×</button>
    <div className="map-place-sheet__image">
      {place.heroImageUrl ? <img src={place.heroImageUrl} alt="" /> : <span>{place.primaryCategory.emoji}</span>}
    </div>
    <div className="map-place-sheet__identity">
      <div className="map-place-sheet__meta"><p>{place.primaryCategory.emoji} {place.primaryCategory.name} · {place.neighborhood || "지역 확인 중"}</p><span className="place-verified-badge">검수 완료</span></div>
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
      <Link className="map-place-sheet__more" to={`/places/${place.slug}`} onClick={(event) => { if (window.matchMedia("(max-width: 760px)").matches) { event.preventDefault(); onOpenDetail(place.slug); } }}>상세 보기</Link>
    </div>
  </aside>;
}
