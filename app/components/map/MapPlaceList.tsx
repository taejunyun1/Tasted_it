import { calculateRating } from "../../features/ratings/rating-v1";
import type { PlaceSummary } from "../../features/places/place.types";
import type { RegionCluster, RegionClusterLevel, RegionGroup } from "../../features/maps/region-cluster-policy";

function PlaceRows({ places, onSelect, startIndex = 0 }: {
  places: PlaceSummary[];
  onSelect: (id: string) => void;
  startIndex?: number;
}) {
  return <ol className="map-place-list">
    {places.map((place, index) => {
      const rating = calculateRating(place);
      return <li key={place.id}>
        <button type="button" aria-label={`${place.name} 선택`} onClick={() => onSelect(place.id)}>
          <span className="map-place-index">{String(startIndex + index + 1).padStart(2, "0")}</span>
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

export function MapPlaceList({ places, groups, level, onSelect, onGroupSelect }: {
  places: PlaceSummary[];
  groups: RegionGroup[];
  level: RegionClusterLevel;
  onSelect: (id: string) => void;
  onGroupSelect: (cluster: RegionCluster) => void;
}) {
  if (!places.length) return <p className="map-explorer-empty">이 범위에서 공개된 장소를 찾지 못했어요.</p>;
  if (level === "PLACE") return <PlaceRows places={places} onSelect={onSelect} />;

  let offset = 0;
  return <div className="map-region-groups" data-region-level={level.toLowerCase()}>
    {groups.map((group) => {
      const startIndex = offset;
      offset += group.places.length;
      return <section className="map-region-group" key={group.id}>
        <button
          type="button"
          className="map-region-group__heading"
          aria-label={`${group.label} ${group.count}곳, 지도에서 보기`}
          data-region-label={group.label}
          onClick={() => onGroupSelect(group)}
        >
          <strong>{group.label}</strong>
          <span>{group.count}곳</span>
          <small>지도에서 보기 →</small>
        </button>
        <PlaceRows places={group.places} onSelect={onSelect} startIndex={startIndex} />
      </section>;
    })}
  </div>;
}
