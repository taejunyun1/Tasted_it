import { Link } from "react-router";
import type { PlaceSummary } from "../../features/places/place.types";
import { calculateRating } from "../../features/ratings/rating-v1";

export function PlaceCard({ place, selected = false }: { place: PlaceSummary; selected?: boolean }) {
  const rating = calculateRating(place);
  return (
    <article className="place-card" data-selected={selected || undefined} id={`place-${place.id}`}>
      <Link to={`/places/${place.slug}`} aria-label={`${place.name} 상세 보기`}>
        <div className="place-image">
          {place.heroImageUrl ? <img src={place.heroImageUrl} alt="" /> : <span>RE:TASTE<br />NO IMAGE</span>}
          <b>{place.primaryCategory.emoji} {place.primaryCategory.name}</b>
        </div>
        <div className="place-copy">
          <p>{place.neighborhood}</p><h3>{place.name}</h3>
          <span>{rating.sampleStatus === "VISIBLE" ? `추천 ${rating.displayScore}%` : "평가 수 부족"}</span>
        </div>
      </Link>
    </article>
  );
}
