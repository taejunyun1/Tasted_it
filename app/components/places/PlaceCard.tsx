import { Link } from "react-router";
import { formatDistance, formatPublicRatingSummary, type DiscoveryPlace } from "../../features/places/place-discovery";
import { shouldOpenPlaceDetailSheet } from "../../features/places/place-detail-sheet";

export const RECOMMENDATION_SOURCE_RAILS = ["PERSONAL", "TRUSTED", "GOLDEN"] as const;
export const RECOMMENDATION_DISCOVERY_MODES = [
  "FAMILIAR",
  "ADJACENT",
  "EXPLORATION",
  "ONBOARDING",
  "QUALITY",
  "REVIEWER",
] as const;

export type RecommendationSourceRail = (typeof RECOMMENDATION_SOURCE_RAILS)[number];
export type RecommendationDiscoveryMode = (typeof RECOMMENDATION_DISCOVERY_MODES)[number];
export type PlaceCardVariant = "default" | "featured" | "personal" | "trusted" | "golden";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasAllowedRecommendationPair(sourceRail: string | null, discoveryMode: string | null) {
  if (sourceRail === "TRUSTED") return discoveryMode === "QUALITY";
  if (sourceRail === "GOLDEN") return discoveryMode === "REVIEWER";
  return sourceRail === "PERSONAL" && ["FAMILIAR", "ADJACENT", "EXPLORATION", "ONBOARDING"].includes(discoveryMode ?? "");
}

function parsedPlaceDetailPath(path: string, requestId: "required" | "forbidden") {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("#")) return null;
  let destination: URL;
  try {
    destination = new URL(path, "https://retaste.invalid");
  } catch {
    return null;
  }
  if (destination.origin !== "https://retaste.invalid") return null;
  if (`${destination.pathname}${destination.search}` !== path) return null;
  const encodedSlug = destination.pathname.startsWith("/places/") ? destination.pathname.slice("/places/".length) : "";
  let slug: string;
  try {
    slug = decodeURIComponent(encodedSlug);
  } catch {
    return null;
  }
  if (!slug || slug === "." || slug === ".." || /[\/\\?#\u0000-\u001f\u007f]/u.test(slug)) return null;

  const entries = [...destination.searchParams.entries()];
  if (entries.length === 0) return requestId === "required" ? null : `${destination.pathname}`;
  const expectedKeys = requestId === "required"
    ? ["sourceRail", "discoveryMode", "recommendationRequestId"]
    : ["sourceRail", "discoveryMode"];
  if (entries.length !== expectedKeys.length || expectedKeys.some((key) => destination.searchParams.getAll(key).length !== 1)) return null;
  if (entries.some(([key]) => !expectedKeys.includes(key))) return null;
  if (!hasAllowedRecommendationPair(destination.searchParams.get("sourceRail"), destination.searchParams.get("discoveryMode"))) return null;
  const recommendationRequestId = destination.searchParams.get("recommendationRequestId");
  if (requestId === "required" && (!recommendationRequestId || !uuidPattern.test(recommendationRequestId))) return null;
  if (requestId === "forbidden" && recommendationRequestId) return null;
  return `${destination.pathname}${destination.search}`;
}

export function safePlaceDetailRequestPath(path: string | null) {
  if (!path) return null;
  const directPath = parsedPlaceDetailPath(path, "forbidden");
  if (directPath && !directPath.includes("?")) return directPath;
  return parsedPlaceDetailPath(path, "required");
}

function recommendationProvenance(input: {
  variant: PlaceCardVariant;
  discoveryMode?: RecommendationDiscoveryMode;
}): { sourceRail: RecommendationSourceRail; discoveryMode: RecommendationDiscoveryMode } | null {
  if (input.variant === "default") return null;
  if (input.variant === "trusted") return { sourceRail: "TRUSTED", discoveryMode: "QUALITY" };
  if (input.variant === "golden") return { sourceRail: "GOLDEN", discoveryMode: "REVIEWER" };
  const discoveryMode = input.discoveryMode && RECOMMENDATION_DISCOVERY_MODES.includes(input.discoveryMode)
    ? input.discoveryMode
    : "FAMILIAR";
  return { sourceRail: "PERSONAL", discoveryMode };
}

export function recommendationPlacePath(slug: string, input: {
  variant: PlaceCardVariant;
  discoveryMode?: RecommendationDiscoveryMode;
}) {
  const pathname = `/places/${slug}`;
  const provenance = recommendationProvenance(input);
  if (!provenance) return pathname;
  const search = new URLSearchParams(provenance);
  return `${pathname}?${search}`;
}

export function recommendationRequestPath(path: string, requestId: string) {
  if (!uuidPattern.test(requestId)) throw new Error("RECOMMENDATION_REQUEST_ID_NOT_ALLOWED");
  const recommendationPath = parsedPlaceDetailPath(path, "forbidden");
  if (!recommendationPath || !recommendationPath.includes("?")) throw new Error("RECOMMENDATION_PATH_NOT_ALLOWED");
  const destination = new URL(recommendationPath, "https://retaste.invalid");
  destination.searchParams.set("recommendationRequestId", requestId);
  const requestPath = safePlaceDetailRequestPath(`${destination.pathname}${destination.search}`);
  if (!requestPath) throw new Error("RECOMMENDATION_PATH_NOT_ALLOWED");
  return requestPath;
}

export function PlaceCard({ place, selected = false, distanceMeters, goldenPickAt, recommendationLabel, variant = "default", recommendationDiscoveryMode, relayIndex, onOpenDetail }: { place: DiscoveryPlace; selected?: boolean; distanceMeters?: number; goldenPickAt?: string; recommendationLabel?: string; variant?: PlaceCardVariant; recommendationDiscoveryMode?: RecommendationDiscoveryMode; relayIndex?: number; onOpenDetail?: (detailPath: string) => void }) {
  const ratingSummary = formatPublicRatingSummary(place);
  const detailPath = recommendationPlacePath(place.slug, {
    variant,
    discoveryMode: recommendationDiscoveryMode ?? place.discoveryMode,
  });
  const isRecommendation = detailPath.includes("sourceRail=");
  return (
    <article className="place-card" data-selected={selected || undefined} data-variant={variant} id={`place-${place.id}`}>
      <Link to={detailPath} reloadDocument={isRecommendation} aria-label={`${place.name} 상세 보기`} onClick={(event) => {
        let requestPath = detailPath;
        if (isRecommendation) {
          requestPath = recommendationRequestPath(detailPath, crypto.randomUUID());
          event.currentTarget.href = new URL(requestPath, window.location.origin).href;
        }
        if (onOpenDetail && shouldOpenPlaceDetailSheet({ mobile: window.matchMedia("(max-width: 760px)").matches, button: event.button, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey })) {
          const safeRequestPath = safePlaceDetailRequestPath(requestPath);
          if (!safeRequestPath) return;
          event.preventDefault();
          onOpenDetail(safeRequestPath);
        }
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
