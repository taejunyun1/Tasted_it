import { Link } from "react-router";
import { formatDistance, formatRatingSummary, type DiscoveryPlace } from "../../features/places/place-discovery";
import { shouldOpenPlaceDetailSheet } from "../../features/places/place-detail-sheet";

export function PlaceCard({ place, selected = false, distanceMeters, goldenPickAt, recommendationLabel, variant = "default", relayIndex, onOpenDetail }: { place: DiscoveryPlace; selected?: boolean; distanceMeters?: number; goldenPickAt?: string; recommendationLabel?: string; variant?: "default" | "featured" | "personal" | "trusted" | "golden"; relayIndex?: number; onOpenDetail?: (slug: string) => void }) {
  const ratingSummary = place.ratingScore != null && place.ratingSampleCount
    ? `추천 ${place.ratingScore}% · ${place.ratingSampleCount}명 평가`
    : formatRatingSummary(place);
  return (
    <article className="place-card" data-selected={selected || undefined} data-variant={variant} id={`place-${place.id}`}>
      <Link to={`/places/${place.slug}`} aria-label={`${place.name} 상세 보기`} onClick={(event) => {
        if (onOpenDetail && shouldOpenPlaceDetailSheet({ mobile: window.matchMedia("(max-width: 760px)").matches, button: event.button, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey })) { event.preventDefault(); onOpenDetail(place.slug); }
      }}>
        <div className="place-image">
          {place.heroImageUrl ? <img src={place.heroImageUrl} alt="" /> : <span className="place-image__fallback"><i>{place.primaryCategory.emoji}</i>RE:TASTE PICK</span>}
          <b>{place.primaryCategory.emoji} {place.primaryCategory.name}</b>
          {relayIndex && <em className="place-relay-index">{String(relayIndex).padStart(2, "0")}</em>}
        </div>
        <div className="place-copy">
          <p>{place.neighborhood}</p><h3>{place.name}</h3>
          {(place.recommendationReasons?.length || recommendationLabel) && <div className="place-reason-list">
            {place.recommendationReasons?.slice(0, 2).map((reason) => <small className="place-reason" key={reason}>{reason}</small>)}
            {!place.recommendationReasons?.length && recommendationLabel && <small className="place-reason">{recommendationLabel}</small>}
          </div>}
          <span>{ratingSummary}</span>
          {distanceMeters !== undefined && <small>{formatDistance(distanceMeters)}</small>}
          {goldenPickAt && <small>Golden Pick · {new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(goldenPickAt))}</small>}
        </div>
      </Link>
    </article>
  );
}
