import { useEffect } from "react";
import { Link } from "react-router";
import { calculateRating } from "../../features/ratings/rating-v1";
import type { PlaceSummary } from "../../features/places/place.types";

export function MapPlaceDetail({ place, onBack, onOpenDetail }: { place: PlaceSummary; onBack: () => void; onOpenDetail: (slug: string) => void }) {
  const rating = calculateRating(place);
  const voteCount = place.positive + place.negative;
  const isVisible = rating.sampleStatus === "VISIBLE";
  const progressValue = isVisible ? rating.displayScore : Math.min(voteCount, 8);
  const progressMax = isVisible ? 100 : 8;
  const progressPercent = (progressValue / progressMax) * 100;
  const naverUrl = `https://map.naver.com/p/search/${encodeURIComponent(place.address || place.name)}`;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onBack(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onBack]);

  return <aside className="map-place-sheet" role="dialog" aria-label={`${place.name} 빠른 정보`}>
    <div className="map-place-sheet__handle" aria-hidden="true" />
    <button type="button" className="map-place-sheet__close" aria-label="빠른 정보 닫기" onClick={onBack}>×</button>
    <div className="map-place-sheet__image">
      {place.heroImageUrl ? <img src={place.heroImageUrl} alt="" /> : <span>{place.primaryCategory.emoji}</span>}
    </div>
    <div className="map-place-sheet__identity">
      <p>{place.primaryCategory.emoji} {place.primaryCategory.name} · {place.neighborhood || "지역 확인 중"}</p>
      <h2>{place.name}</h2>
      <address>{place.address || "주소 확인 중"}</address>
    </div>
    <div className="map-place-sheet__rating">
      <div className="map-place-sheet__rating-head">
        <span>{isVisible ? "추천 지표" : "평가 공개까지"}</span>
        <strong>{isVisible ? `${rating.displayScore}%` : `${voteCount}/8`}</strong>
      </div>
      <div className="map-rating-bar" role="progressbar" aria-label="추천 지표" aria-valuemin={0} aria-valuemax={progressMax} aria-valuenow={progressValue}>
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <small>{isVisible ? `추천 ${place.positive} · 비추천 ${place.negative}` : "8표부터 추천률이 공개됩니다."}</small>
    </div>
    <div className="map-place-sheet__actions">
      <a className="map-place-sheet__route" href={naverUrl} target="_blank" rel="noreferrer">네이버 길찾기 ↗</a>
      <Link className="map-place-sheet__more" to={`/places/${place.slug}`} onClick={(event) => { if (window.matchMedia("(max-width: 760px)").matches) { event.preventDefault(); onOpenDetail(place.slug); } }}>상세 보기</Link>
    </div>
  </aside>;
}
