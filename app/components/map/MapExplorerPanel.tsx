import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { PlaceSummary, PublicPlaceCounts } from "../../features/places/place.types";
import type { RegionCluster, RegionClusterLevel, RegionGroup } from "../../features/maps/region-cluster-policy";
import { publicPlaceBrowseHref } from "../../features/places/public-place-browse";
import { MapPlaceList } from "./MapPlaceList";

export interface PublicCategoryGroup {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  children: Array<{ id: string; slug: string; name: string; emoji: string; count: number; overallCount?: number }>;
}

export type BrowseMobileView = "map" | "list";

export function MapExplorerPanel({ places, groups, regionGroups, clusterLevel, query, category, counts, pagination, tempOnly = false, browseSearch = "", listHref, mobileView = "map", onMobileViewChange, onSelect, onSearch, onCategory, onLocate, onGroupSelect, onExpandBounds }: {
  places: PlaceSummary[];
  groups: PublicCategoryGroup[];
  regionGroups: RegionGroup[];
  clusterLevel: RegionClusterLevel;
  query: string;
  category: string | null;
  counts?: PublicPlaceCounts | null;
  pagination?: { total: number; page: number; totalPages: number; start: number; end: number; outOfRange: boolean } | null;
  tempOnly?: boolean;
  browseSearch?: string;
  listHref?: string;
  mobileView?: BrowseMobileView;
  onMobileViewChange?: (view: BrowseMobileView) => void;
  onSelect: (id: string) => void;
  onSearch: (query: string) => void;
  onCategory: (slug: string | null) => void;
  onLocate: () => void;
  onGroupSelect: (cluster: RegionCluster) => void;
  onExpandBounds?: (bounds: [number, number, number, number]) => void;
}) {
  const selectedGroup = groups.find((group) => group.children.some((child) => child.slug === category))?.id ?? null;
  const [groupId, setGroupId] = useState<string | null>(selectedGroup);
  const [searchQuery, setSearchQuery] = useState(query);
  const children = useMemo(() => groups.find((group) => group.id === groupId)?.children ?? [], [groupId, groups]);
  const currentCount = pagination?.total ?? counts?.count ?? places.length;
  const expansionBounds = counts?.overallBounds;
  const canExpand = !tempOnly && !pagination?.outOfRange && currentCount === 0 && Boolean(counts?.overallCount && expansionBounds && onExpandBounds);

  useEffect(() => {
    setGroupId(selectedGroup);
  }, [selectedGroup]);

  useEffect(() => {
    setSearchQuery(query);
  }, [query]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    onSearch(typeof value === "string" ? value.trim() : "");
  };

  return <aside className="map-explorer-panel" data-mobile-view={mobileView} aria-label="장소 탐색">
    <div className={listHref ? "map-mobile-tabs grid-cols-3!" : "map-mobile-tabs"} role="group" aria-label="모바일 보기 방식">
      <button type="button" aria-pressed={mobileView === "map"} onClick={() => onMobileViewChange?.("map")}>지도</button>
      <button type="button" aria-pressed={mobileView === "list"} onClick={() => onMobileViewChange?.("list")}>목록</button>
      {listHref && <Link className="flex min-h-11 items-center justify-center text-xs font-semibold underline!" to={listHref}>목록에서 보기</Link>}
    </div>
    <div className="map-explorer-panel__content">
      <header className="map-atlas-head">
        <p>광주 · 전남 · 전북</p>
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
      {listHref && <Link className="mx-4 hidden min-h-11 items-center text-sm font-semibold underline! min-[761px]:inline-flex" to={listHref}>목록에서 보기</Link>}
      <div className="map-category-groups" role="group" aria-label="대표 카테고리">
        <button type="button" aria-pressed={!category} data-active={!category || undefined} onClick={() => { setGroupId(null); onCategory(null); }}>전체</button>
        {groups.map((group) => <button type="button" key={group.id} aria-expanded={group.id === groupId} aria-pressed={group.id === selectedGroup} data-expanded={group.id === groupId || undefined} onClick={() => setGroupId(group.id)}>{group.emoji} {group.name}</button>)}
      </div>
      {groupId && <div className="map-category-children" role="group" aria-label="세부 카테고리">
        {children.map((child) => <button type="button" key={child.id} aria-label={tempOnly ? `${child.name}, TEMP 베타 ${child.count}곳` : `${child.name}, 현재 범위 ${child.count}곳, 전체 검색 결과 ${child.overallCount ?? child.count}곳`} aria-pressed={child.slug === category} data-active={child.slug === category || undefined} onClick={() => onCategory(child.slug)}>{child.emoji} {child.name} <small>{tempOnly ? `TEMP ${child.count}곳` : `범위 안 ${child.count} · 전체 ${child.overallCount ?? child.count}`}</small></button>)}
      </div>}
      <div className="map-result-head" aria-live="polite"><span>{tempOnly ? "TEMP 베타 장소" : "현재 지도 안의 기록"}</span><strong>{currentCount}</strong><small>곳</small></div>
      {pagination?.outOfRange && <p className="mx-4 mb-4 text-sm" role="status">이 페이지에 표시할 장소가 없습니다. <Link className="inline-flex min-h-11 items-center underline!" to={publicPlaceBrowseHref("map", browseSearch, { page: 1 })}>같은 조건의 첫 페이지로 돌아가기</Link></p>}
      {pagination && !pagination.outOfRange && pagination.totalPages > 1 && <>
        <p className="mx-4 mb-2 text-sm" role="status">전체 {currentCount}곳 중 {pagination.start}–{pagination.end}번째를 표시합니다.</p>
        <nav className="mx-4 mb-4 flex flex-wrap items-center gap-3 text-sm" aria-label="지도 결과 페이지">
          {pagination.page > 1 && <Link className="inline-flex min-h-11 items-center underline!" to={publicPlaceBrowseHref("map", browseSearch, { page: pagination.page - 1 })}>이전 페이지</Link>}
          <span aria-current="page">{pagination.page} / {pagination.totalPages} 페이지</span>
          {pagination.page < pagination.totalPages && <Link className="inline-flex min-h-11 items-center underline!" to={publicPlaceBrowseHref("map", browseSearch, { page: pagination.page + 1 })}>다음 페이지</Link>}
        </nav>
      </>}
      {canExpand && <div className="mx-4 mb-4 border border-current p-4 text-sm" role="status">
        <p>이 범위에는 조건에 맞는 장소가 없어요. 검색 조건을 유지하고 지도 범위를 넓힐 수 있습니다.</p>
        <button type="button" className="map-locate mt-3 min-h-[var(--control-height)] w-full" onClick={() => { if (expansionBounds) onExpandBounds?.(expansionBounds); }}>전체 결과 {counts?.overallCount}곳 보기</button>
      </div>}
      {!canExpand && !pagination?.outOfRange && <MapPlaceList places={places} groups={regionGroups} level={clusterLevel} onSelect={onSelect} onGroupSelect={onGroupSelect} />}
    </div>
  </aside>;
}
