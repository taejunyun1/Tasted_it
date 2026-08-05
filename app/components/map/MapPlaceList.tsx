import { calculateRating } from "../../features/ratings/rating-v1";
import type { PlaceSummary } from "../../features/places/place.types";

export function MapPlaceList({ places, onSelect }: {
  places: PlaceSummary[];
  onSelect: (id: string) => void;
}) {
  if (!places.length) return <p className="map-explorer-empty">이 범위에서 공개된 장소를 찾지 못했어요.</p>;

  return <ol className="map-place-list">
    {places.map((place, index) => {
      const rating = calculateRating(place);
      return <li key={place.id}>
        <button type="button" aria-label={`${place.name} 선택`} onClick={() => onSelect(place.id)}>
          <span className="map-place-index">{String(index + 1).padStart(2, "0")}</span>
          <span className="map-place-summary">
            <strong>{place.name}</strong>
            <small>{place.primaryCategory.emoji} {place.primaryCategory.name} · {place.neighborhood || "지역 확인 중"}</small>
          </span>
          <span className="map-place-rating">{rating.sampleStatus === "VISIBLE" ? `${rating.displayScore}%` : "평가 대기"}</span>
        </button>
      </li>;
    })}
  </ol>;
}
