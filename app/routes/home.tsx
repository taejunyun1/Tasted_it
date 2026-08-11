import { env } from "cloudflare:workers";
import { useEffect, useMemo, useState } from "react";
import {
  useFetcher,
  useSearchParams,
  type ShouldRevalidateFunction,
} from "react-router";

import type { Route } from "./+types/home";
import type { loader as homeRecommendationLoader } from "./home-recommendations-resource";
import { HomeCurationPanel } from "../components/map/HomeCurationPanel";
import { HomeCurationSheet } from "../components/map/HomeCurationSheet";
import { MapExplorerPanel } from "../components/map/MapExplorerPanel";
import { MapPlaceDetail } from "../components/map/MapPlaceDetail";
import { PlaceMap } from "../components/map/PlaceMap";
import { PlaceDetailSheet } from "../components/places/PlaceDetailSheet";
import { createDb } from "../db/client.server";
import { getOptionalUser } from "../features/auth/session.server";
import {
  parseHomeCurationState,
  type HomeCurationMode,
} from "../features/maps/home-curation-options";
import { resolveLocationViewport } from "../features/maps/location-policy";
import { parseMapState } from "../features/maps/map-state";
import { findSelectedPlace, updateMapSearch } from "../features/maps/map-selection";
import { getGuestOnboardingFromRequest } from "../features/onboarding/guest-session.server";
import {
  buildRegionClusters,
  buildRegionGroups,
  getRegionClusterLevel,
  type RegionCluster,
} from "../features/maps/region-cluster-policy";
import { getHomeCurationPage } from "../features/places/home-curation.server";
import { listPlaces, listPublicCategoryGroups } from "../features/places/place.server";

export function meta() {
  return [{ title: "Re:Taste — 내 주변 맛 지도" }, { name: "description", content: "현재 위치에서 찾는 광주·전남 맛 지도" }];
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}) => {
  const sameHomePath = currentUrl.pathname === nextUrl.pathname;
  const currentView = parseHomeCurationState(currentUrl.search).view;
  const nextView = parseHomeCurationState(nextUrl.search).view;
  if (sameHomePath && currentView === "curated" && nextView === "curated") return false;
  return defaultShouldRevalidate;
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const state = parseMapState(url.search);
  const homeState = parseHomeCurationState(url.search);
  const category = url.searchParams.get("category") || undefined;
  const db = createDb(env.DB);
  const common = {
    state,
    category: category ?? null,
    clientId: env.NAVER_MAPS_CLIENT_ID ?? "",
    qaMode: url.searchParams.has("qa"),
  };

  if (homeState.view === "browse") {
    const [places, groups] = await Promise.all([
      listPlaces(db, { categorySlug: category, query: state.query, bbox: state.bbox }),
      listPublicCategoryGroups(db),
    ]);
    return { ...common, view: "browse" as const, places, groups, curation: null };
  }

  const now = new Date().toISOString();
  const user = await getOptionalUser(request);
  const guest = !user && env.ONBOARDING_ENABLED === "true"
    ? await getGuestOnboardingFromRequest(db, request, now)
    : null;
  const curation = await getHomeCurationPage(db, {
    userId: user?.id,
    tasteBadgeIds: guest ? [...guest.foodBadgeIds, ...guest.styleBadgeIds] : [],
    bbox: state.bbox,
    center: {
      latitude: (state.bbox[1] + state.bbox[3]) / 2,
      longitude: (state.bbox[0] + state.bbox[2]) / 2,
    },
    mode: homeState.mode,
    now,
  });
  return {
    ...common,
    view: "curated" as const,
    places: curation.places,
    groups: [],
    curation,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const recommendationFetcher = useFetcher<typeof homeRecommendationLoader>();
  const [curation, setCuration] = useState(loaderData.curation);
  const [mapZoom, setMapZoom] = useState(12);
  const [focusCluster, setFocusCluster] = useState<RegionCluster | null>(null);
  const [locationBounds, setLocationBounds] = useState<[number, number, number, number] | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [pendingBounds, setPendingBounds] = useState<[number, number, number, number] | null>(null);
  const liveSearch = `?${params.toString()}`;
  const liveMapState = parseMapState(liveSearch);
  const liveHomeState = parseHomeCurationState(liveSearch);
  const isCurated = liveHomeState.view === "curated";
  const activeCuration = curation ?? loaderData.curation;
  const activePlaces = isCurated && activeCuration ? activeCuration.places : loaderData.places;
  const requestedSelectedId = params.get("selected");
  const selectedId = requestedSelectedId ?? (isCurated ? activeCuration?.places[0]?.id ?? null : null);
  const selectedPlace = findSelectedPlace(activePlaces, selectedId);
  const detailSlug = params.get("place");
  const clusterLevel = getRegionClusterLevel(mapZoom);
  const clusters = useMemo(() => isCurated ? [] : buildRegionClusters(activePlaces, mapZoom), [activePlaces, isCurated, mapZoom]);
  const regionGroups = useMemo(() => isCurated ? [] : buildRegionGroups(activePlaces, mapZoom), [activePlaces, isCurated, mapZoom]);
  const markerRanks = useMemo(() => Object.fromEntries(
    (isCurated ? activeCuration?.places ?? [] : []).map((place) => [place.id, place.rank]),
  ), [activeCuration, isCurated]);
  const recommendationError = recommendationFetcher.data && !recommendationFetcher.data.ok
    ? recommendationFetcher.data.message
    : null;

  useEffect(() => {
    if (loaderData.curation) setCuration(loaderData.curation);
  }, [loaderData.curation]);

  useEffect(() => {
    if (recommendationFetcher.data?.ok) {
      setCuration(recommendationFetcher.data.recommendations);
      setPendingBounds(null);
    }
  }, [recommendationFetcher.data]);

  useEffect(() => {
    if (requestedSelectedId && !selectedPlace) {
      setParams((current) => updateMapSearch(current, { selected: null }), { replace: true });
    }
  }, [requestedSelectedId, selectedPlace, setParams]);

  const loadRecommendations = (
    mode: HomeCurationMode,
    bbox: [number, number, number, number],
  ) => {
    const search = new URLSearchParams({ mode, bbox: bbox.join(",") });
    recommendationFetcher.load(`/resources/home-recommendations?${search}`);
  };
  const setSearch = (change: Parameters<typeof updateMapSearch>[1]) => {
    setParams((current) => updateMapSearch(current, change), { replace: true });
  };
  const setBounds = (bbox: [number, number, number, number]) => {
    setSearch({ bbox: bbox.map((value) => value.toFixed(5)).join(",") });
  };
  const setMode = (mode: HomeCurationMode) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("mode", mode);
      next.delete("selected");
      return next;
    }, { replace: true });
    loadRecommendations(mode, liveMapState.bbox);
  };
  const locate = () => navigator.geolocation?.getCurrentPosition(({ coords }) => {
    const result = resolveLocationViewport(coords);
    setLocationBounds(result.bbox);
    setLocationNotice(result.notice);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("bbox", result.bbox.map((value) => value.toFixed(5)).join(","));
      next.delete("selected");
      return next;
    }, { replace: true });
    if (isCurated) loadRecommendations(liveHomeState.mode, result.bbox);
  }, () => {
    setLocationNotice("위치 권한을 확인한 뒤 다시 시도해주세요.");
  }, { enableHighAccuracy: true, timeout: 8_000 });
  const recommendPendingArea = () => {
    if (!pendingBounds) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("bbox", pendingBounds.map((value) => value.toFixed(5)).join(","));
      next.delete("selected");
      return next;
    }, { replace: true });
    loadRecommendations(liveHomeState.mode, pendingBounds);
  };
  const browseAll = () => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", "browse");
      next.delete("selected");
      return next;
    });
  };
  const returnToCuration = () => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("view");
      next.delete("category");
      next.delete("q");
      next.delete("selected");
      next.delete("place");
      next.set("mode", "now");
      return next;
    });
  };
  const focusRegion = (cluster: RegionCluster) => {
    setSearch({ selected: null });
    setFocusCluster(cluster);
    setMapZoom(cluster.level === "DISTRICT" ? 13 : 15);
  };
  const openDetail = (slug: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set("place", slug);
    return next;
  });
  const closeDetail = () => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete("place");
    return next;
  }, { replace: true });
  const presentationProps = activeCuration ? {
    page: activeCuration,
    selectedPlaceId: selectedPlace?.id ?? null,
    mode: liveHomeState.mode,
    pending: recommendationFetcher.state !== "idle",
    error: recommendationError,
    onModeChange: setMode,
    onSelect: (id: string) => setSearch({ selected: id }),
    onLocate: locate,
    onRetry: () => loadRecommendations(liveHomeState.mode, liveMapState.bbox),
    onBrowse: browseAll,
  } : null;

  return <main id="main" className={`map-explorer${isCurated ? " map-explorer--curated" : ""}`}>
    {isCurated && presentationProps ? <HomeCurationPanel {...presentationProps} /> : <MapExplorerPanel
      places={activePlaces}
      groups={loaderData.groups}
      regionGroups={regionGroups}
      clusterLevel={clusterLevel}
      query={liveMapState.query}
      category={loaderData.category}
      hasSelectedPlace={Boolean(selectedPlace)}
      onSelect={(id) => setSearch({ selected: id })}
      onSearch={(q) => setSearch({ q, selected: null })}
      onCategory={(category) => setSearch({ category, selected: null })}
      onLocate={locate}
      onGroupSelect={focusRegion}
    />}
    <section className="map-explorer-map" aria-label="지도 영역">
      <PlaceMap
        places={activePlaces}
        selected={selectedPlace?.id ?? null}
        clientId={loaderData.clientId}
        qaMode={loaderData.qaMode}
        zoom={mapZoom}
        clusters={clusters}
        focusCluster={isCurated ? null : focusCluster}
        markerRanks={markerRanks}
        deferBounds={isCurated}
        initialBounds={isCurated || params.has("bbox") ? liveMapState.bbox : undefined}
        locationBounds={locationBounds}
        locationNotice={locationNotice}
        onSelect={(id) => setSearch({ selected: id })}
        onBounds={isCurated ? () => undefined : setBounds}
        onPendingBounds={setPendingBounds}
        onZoom={setMapZoom}
        onClusterSelect={focusRegion}
      />
      {isCurated && pendingBounds && <button type="button" className="home-curation-reload-area" onClick={recommendPendingArea}>이 지역 다시 추천</button>}
      {isCurated && presentationProps && <HomeCurationSheet {...presentationProps} />}
      {!isCurated && <button type="button" className="home-curation-return" onClick={returnToCuration}>추천 지도</button>}
      {!isCurated && selectedPlace && !detailSlug && <MapPlaceDetail key={selectedPlace.id} place={selectedPlace} onBack={() => setSearch({ selected: null })} onOpenDetail={openDetail} />}
      {!isCurated && <PlaceDetailSheet slug={detailSlug} onClose={closeDetail} />}
    </section>
  </main>;
}
