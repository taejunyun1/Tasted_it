import { Link } from "react-router";
import type { PlaceSummary } from "../../features/places/place.types";
import { formatDistance, formatRatingSummary } from "../../features/places/place-discovery";
import { shouldOpenPlaceDetailSheet } from "../../features/places/place-detail-sheet";

export function PlaceCard({ place, selected = false, distanceMeters, goldenPickAt, recommendationLabel, onOpenDetail }: { place: PlaceSummary; selected?: boolean; distanceMeters?: number; goldenPickAt?: string; recommendationLabel?: string; onOpenDetail?: (slug: string) => void }) {
  return (
    <article className="place-card" data-selected={selected || undefined} id={`place-${place.id}`}>
      <Link to={`/places/${place.slug}`} aria-label={`${place.name} 상세 보기`} onClick={(event) => {
        if (onOpenDetail && shouldOpenPlaceDetailSheet({ mobile: window.matchMedia("(max-width: 760px)").matches, button: event.button, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey })) { event.preventDefault(); onOpenDetail(place.slug); }
      }}>
        <div className="place-image">
          {place.heroImageUrl ? <img src={place.heroImageUrl} alt="" /> : <span>RE:TASTE<br />NO IMAGE</span>}
          <b>{place.primaryCategory.emoji} {place.primaryCategory.name}</b>
        </div>
        <div className="place-copy">
          <p>{place.neighborhood}</p><h3>{place.name}</h3>
          {recommendationLabel && <small className="place-reason">{recommendationLabel}</small>}
          <span>{formatRatingSummary(place)}</span>
          {distanceMeters !== undefined && <small>{formatDistance(distanceMeters)}</small>}
          {goldenPickAt && <small>Golden Pick · {new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(goldenPickAt))}</small>}
        </div>
      </Link>
    </article>
  );
}
