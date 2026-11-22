import { Link } from "react-router";
import { formatDistance, formatPublicRatingSummary, type DiscoveryPlace } from "../../features/places/place-discovery";
import { PLACE_DETAIL_MOBILE_QUERY, shouldOpenPlaceDetailSheet } from "../../features/places/place-detail-sheet";
import { recommendationPlacePath, recommendationRequestPath, safePlaceDetailRequestPath, type PlaceCardVariant, type RecommendationDiscoveryMode } from "../../features/places/place-detail-path";
import { PublicRatingMeta } from "../ratings/PublicRatingMeta";

export {
  RECOMMENDATION_DISCOVERY_MODES,
  RECOMMENDATION_SOURCE_RAILS,
  recommendationPlacePath,
  recommendationRequestPath,
  safePlaceDetailRequestPath,
  safePlaceDetailSearchPath,
  type PlaceCardVariant,
  type RecommendationDiscoveryMode,
  type RecommendationSourceRail,
} from "../../features/places/place-detail-path";

export type OpenPlaceDetail = (detailPath: string, opener: HTMLAnchorElement) => void;

export function PlaceCard({ place, selected = false, listItem = false, distanceMeters, goldenPickAt, recommendationLabel, variant = "default", recommendationDiscoveryMode, relayIndex, onOpenDetail }: { place: DiscoveryPlace; selected?: boolean; listItem?: boolean; distanceMeters?: number; goldenPickAt?: string; recommendationLabel?: string; variant?: PlaceCardVariant; recommendationDiscoveryMode?: RecommendationDiscoveryMode; relayIndex?: number; onOpenDetail?: OpenPlaceDetail }) {
  const ratingSummary = formatPublicRatingSummary(place);
  const detailPath = recommendationPlacePath(place.slug, {
    variant,
    discoveryMode: recommendationDiscoveryMode ?? place.discoveryMode,
  });
  const isRecommendation = detailPath.includes("sourceRail=");
  const CardRoot = listItem ? "div" : "article";
  return (
    <CardRoot className="place-card" role={listItem ? "listitem" : undefined} data-selected={selected || undefined} data-variant={variant} id={`place-${place.id}`}>
      <Link to={detailPath} reloadDocument={isRecommendation} aria-label={`${place.name} 상세 보기`} onClick={(event) => {
        let requestPath = detailPath;
        if (isRecommendation) {
          requestPath = recommendationRequestPath(detailPath, crypto.randomUUID());
          event.currentTarget.href = new URL(requestPath, window.location.origin).href;
        }
        if (onOpenDetail && shouldOpenPlaceDetailSheet({ ...event, mobile: window.matchMedia(PLACE_DETAIL_MOBILE_QUERY).matches })) {
          const safeRequestPath = safePlaceDetailRequestPath(requestPath);
          if (!safeRequestPath) return;
          event.preventDefault();
          onOpenDetail(safeRequestPath, event.currentTarget);
        }
      }}>
        <div className="place-image">
          {place.heroImageUrl ? <img src={place.heroImageUrl} alt="" /> : <span className="place-image__fallback"><i>{place.primaryCategory.emoji}</i>{place.tempCatalog ? "TEMP · 사진 미제공" : "RE:TASTE PICK"}</span>}
          <b>{place.primaryCategory.emoji} {place.primaryCategory.name}</b>
          {relayIndex && <em className="place-relay-index">{String(relayIndex).padStart(2, "0")}</em>}
        </div>
        <div className="place-copy">
          <p>{place.tempCatalog && <strong>TEMP · </strong>}{place.neighborhood}</p><h3>{place.name}</h3>
          {place.tempCatalog && <small>공식 출처 기반 임시 정보 · 현재 영업 미확인</small>}
          {(place.recommendationReasons?.length || recommendationLabel) && <div className="place-reason-list">
            {place.recommendationReasons?.slice(0, 2).map((reason) => <small className="place-reason" key={reason}>{reason}</small>)}
            {!place.recommendationReasons?.length && recommendationLabel && <small className="place-reason">{recommendationLabel}</small>}
          </div>}
          <span>{ratingSummary}</span>
          <PublicRatingMeta place={place} />
          {distanceMeters !== undefined && <small>{formatDistance(distanceMeters)}</small>}
          {goldenPickAt && <small>Golden Pick · {new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(goldenPickAt))}</small>}
        </div>
      </Link>
    </CardRoot>
  );
}
