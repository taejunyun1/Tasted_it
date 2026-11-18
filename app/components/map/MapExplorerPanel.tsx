import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { PlaceSummary, PublicPlaceCounts } from "../../features/places/place.types";
import type { RegionCluster, RegionClusterLevel, RegionGroup } from "../../features/maps/region-cluster-policy";
import { MapPlaceList } from "./MapPlaceList";

export interface PublicCategoryGroup {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  children: Array<{ id: string; slug: string; name: string; emoji: string; count: number; overallCount?: number }>;
}

export function MapExplorerPanel({ places, groups, regionGroups, clusterLevel, query, category, counts, hasSelectedPlace, onSelect, onSearch, onCategory, onLocate, onGroupSelect, onExpandBounds }: {
  places: PlaceSummary[];
  groups: PublicCategoryGroup[];
  regionGroups: RegionGroup[];
  clusterLevel: RegionClusterLevel;
  query: string;
  category: string | null;
  counts?: PublicPlaceCounts | null;
  hasSelectedPlace: boolean;
  onSelect: (id: string) => void;
  onSearch: (query: string) => void;
  onCategory: (slug: string | null) => void;
  onLocate: () => void;
  onGroupSelect: (cluster: RegionCluster) => void;
  onExpandBounds?: (bounds: [number, number, number, number]) => void;
}) {
  const selectedGroup = groups.find((group) => group.children.some((child) => child.slug === category))?.id ?? null;
  const [groupId, setGroupId] = useState<string | null>(selectedGroup);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [searchQuery, setSearchQuery] = useState(query);
  const children = useMemo(() => groups.find((group) => group.id === groupId)?.children ?? [], [groupId, groups]);
  const currentCount = counts?.count ?? places.length;
  const expansionBounds = counts?.overallBounds;
  const canExpand = currentCount === 0 && Boolean(counts?.overallCount && expansionBounds && onExpandBounds);

  useEffect(() => {
    setGroupId(selectedGroup);
  }, [selectedGroup]);

  useEffect(() => {
    setSearchQuery(query);
  }, [query]);

  useEffect(() => {
    if (hasSelectedPlace) setMobileView("map");
  }, [hasSelectedPlace]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    onSearch(typeof value === "string" ? value.trim() : "");
  };

  return <aside className="map-explorer-panel" data-mobile-view={mobileView} aria-label="장소 탐색">
    <div className="map-mobile-tabs" role="group" aria-label="모바일 보기 방식">
      <button type="button" aria-pressed={mobileView === "map"} onClick={() => setMobileView("map")}>지도</button>
      <button type="button" aria-pressed={mobileView === "list"} onClick={() => setMobileView("list")}>목록</button>
    </div>
    <div className="map-explorer-panel__content">
      <header className="map-atlas-head">
        <p>GWANGJU · JEONNAM FOOD ATLAS</p>
        <h1>동네의 맛을<br />지도에서 찾기</h1>
        <span>직접 확인한 지역의 음식과 장소를 기록합니다.</span>
      </header>
      <div className="map-search-row">
        <form onSubmit={submitSearch} role="search">
          <label htmlFor="map-search">장소 검색</label>
          <input id="map-search" name="q" value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} placeholder="동네·상호명 검색" />
          <button>검색</button>
        </form>
        <button type="button" className="map-locate" onClick={onLocate}>◎ 내 주변</button>
      </div>
      <div className="map-category-groups" role="group" aria-label="대표 카테고리">
        <button type="button" aria-pressed={!category} data-active={!category || undefined} onClick={() => { setGroupId(null); onCategory(null); }}>전체</button>
        {groups.map((group) => <button type="button" key={group.id} aria-expanded={group.id === groupId} aria-pressed={group.id === selectedGroup} data-expanded={group.id === groupId || undefined} onClick={() => setGroupId(group.id)}>{group.emoji} {group.name}</button>)}
      </div>
      {groupId && <div className="map-category-children" role="group" aria-label="세부 카테고리">
        {children.map((child) => <button type="button" key={child.id} aria-label={`${child.name}, 현재 범위 ${child.count}곳, 전체 검색 결과 ${child.overallCount ?? child.count}곳`} aria-pressed={child.slug === category} data-active={child.slug === category || undefined} onClick={() => onCategory(child.slug)}>{child.emoji} {child.name} <small>범위 안 {child.count} · 전체 {child.overallCount ?? child.count}</small></button>)}
      </div>}
      <div className="map-result-head" aria-live="polite"><span>현재 지도 안의 기록</span><strong>{currentCount}</strong><small>곳</small></div>
      {currentCount > places.length && <p className="mx-4 mb-4 text-sm" role="status">전체 {currentCount}곳 중 이름순 첫 {places.length}곳을 표시합니다. 검색어나 지도 범위를 좁혀 주세요.</p>}
      {canExpand && <div className="mx-4 mb-4 border border-current p-4 text-sm" role="status">
        <p>이 범위에는 조건에 맞는 장소가 없어요. 검색 조건을 유지하고 지도 범위를 넓힐 수 있습니다.</p>
        <button type="button" className="map-locate mt-3 min-h-[var(--control-height)] w-full" onClick={() => { if (expansionBounds) onExpandBounds?.(expansionBounds); }}>전체 결과 {counts?.overallCount}곳 보기</button>
      </div>}
      {!canExpand && <MapPlaceList places={places} groups={regionGroups} level={clusterLevel} onSelect={onSelect} onGroupSelect={onGroupSelect} />}
    </div>
  </aside>;
}
