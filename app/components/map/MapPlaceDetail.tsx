import { Link } from "react-router";
import { calculateRating } from "../../features/ratings/rating-v1";
import type { PlaceSummary } from "../../features/places/place.types";

export function MapPlaceDetail({ place, onBack }: { place: PlaceSummary; onBack: () => void }) {
  const rating = calculateRating(place);
  const naverUrl = `https://map.naver.com/p/search/${encodeURIComponent(place.address || place.name)}`;

  return <article className="map-place-detail">
    <button type="button" className="map-detail-back" onClick={onBack}>← 목록으로</button>
    <div className="map-detail-image">
      {place.heroImageUrl ? <img src={place.heroImageUrl} alt={`${place.name} 대표`} /> : <span>RE:TASTE<br />NO IMAGE</span>}
      <b>{place.primaryCategory.emoji} {place.primaryCategory.name}</b>
    </div>
    <div className="map-detail-copy">
      <p className="map-detail-area">{place.neighborhood || "지역 확인 중"}</p>
      <h1>{place.name}</h1>
      <p className="map-detail-address">{place.address || "주소 확인 중"}</p>
      <div className="map-detail-score">
        <div><span>추천 지표</span><strong>{rating.sampleStatus === "VISIBLE" ? `${rating.displayScore}%` : "평가 수 부족"}</strong></div>
        <p>추천 {place.positive} · 비추천 {place.negative}</p>
      </div>
      <div className="map-detail-actions">
        <Link to={`/places/${place.slug}`}>상세 보기</Link>
        <a href={naverUrl} target="_blank" rel="noreferrer">네이버 길찾기 ↗</a>
      </div>
    </div>
  </article>;
}
