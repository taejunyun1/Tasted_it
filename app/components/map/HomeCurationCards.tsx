import type { HomeCurationMode } from "../../features/maps/home-curation-options";
import type {
  HomeCurationPage,
  HomeCuratedPlace,
} from "../../features/places/home-curation";
import {
  formatDistance,
  formatRatingSummary,
} from "../../features/places/place-discovery";

export type HomeCurationPresentationProps = {
  page: HomeCurationPage;
  selectedPlaceId: string | null;
  mode: HomeCurationMode;
  pending: boolean;
  error: string | null;
  onModeChange: (mode: HomeCurationMode) => void;
  onSelect: (placeId: string) => void;
  onLocate: () => void;
  onRetry: () => void;
};

export const HOME_CURATION_MODE_OPTIONS: Array<{
  id: HomeCurationMode;
  label: string;
}> = [
  { id: "now", label: "지금 갈 만한 곳" },
  { id: "taste", label: "내 취향" },
  { id: "time", label: "시간대 추천" },
  { id: "golden", label: "Golden Pick" },
  { id: "discovery", label: "새로운 발견" },
];

const SLOT_LABELS: Record<HomeCuratedPlace["slot"], string> = {
  BEST_NOW: "지금 추천",
  TASTE_MATCH: "취향 추천",
  TIME_MATCH: "시간대 추천",
  TRUSTED_PICK: "신뢰 추천",
  DISCOVERY: "새로운 발견",
};

export function HomeCurationModeControls({
  mode,
  pending,
  onModeChange,
}: Pick<HomeCurationPresentationProps, "mode" | "pending" | "onModeChange">) {
  return <div className="home-curation-modes" aria-label="지도 추천 방식">
    {HOME_CURATION_MODE_OPTIONS.map((option) => <button
      type="button"
      key={option.id}
      aria-pressed={mode === option.id}
      disabled={pending}
      onClick={() => onModeChange(option.id)}
    >{option.label}</button>)}
  </div>;
}

function ratingSummary(place: HomeCuratedPlace) {
  return place.ratingScore != null && place.ratingSampleCount
    ? `추천 ${place.ratingScore}% · ${place.ratingSampleCount}명 평가`
    : formatRatingSummary(place);
}

export function HomeCurationCards({
  page,
  selectedPlaceId,
  pending,
  onSelect,
}: HomeCurationPresentationProps) {
  if (page.status === "EMPTY") {
    return <p className="home-curation-empty">이 지도 범위에서는 추천할 장소를 찾지 못했어요.</p>;
  }

  return <ol className="home-curation-list" aria-live="polite" aria-busy={pending}>
    {page.places.map((place) => <li key={place.id}>
      <button
        type="button"
        className="home-curation-card"
        data-place-id={place.id}
        aria-pressed={selectedPlaceId === place.id}
        onClick={() => onSelect(place.id)}
      >
        <span className="home-curation-card__rank">{String(place.rank).padStart(2, "0")}</span>
        <span className="home-curation-card__copy">
          <span className="home-curation-card__meta">
            {place.primaryCategory.emoji} {place.primaryCategory.name} · {place.neighborhood}
          </span>
          <strong>{place.name}</strong>
          <span className="home-curation-card__facts">
            {place.distanceMeters !== undefined && <span>{formatDistance(place.distanceMeters)}</span>}
            <span>{ratingSummary(place)}</span>
          </span>
          <span className="home-curation-card__reasons">
            <small>{SLOT_LABELS[place.slot]}</small>
            {place.recommendationReasons
              .filter((reason) => !(place.isGoldenPick && reason === "리뷰어 Golden Pick"))
              .slice(0, 2)
              .map((reason) => <small key={reason}>{reason}</small>)}
            {place.isGoldenPick && <small data-kind="golden">Golden Pick</small>}
          </span>
        </span>
      </button>
    </li>)}
  </ol>;
}
