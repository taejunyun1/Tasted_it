import { env } from "cloudflare:workers";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isRouteErrorResponse,
  useFetcher,
  useLocation,
  useSearchParams,
  type ShouldRevalidateFunction,
} from "react-router";

import type { Route } from "./+types/home";
import type { loader as homeRecommendationLoader } from "./home-recommendations-resource";
import { HomeCurationPanel } from "../components/map/HomeCurationPanel";
import { HomeCurationSheet, type HomeSheetSnap } from "../components/map/HomeCurationSheet";
import { MapExplorerPanel, type BrowseMobileView } from "../components/map/MapExplorerPanel";
import { MapReadBoundary, MapReadError, useMapViewerKey } from "../components/map/MapReadBoundary";
import { isMapReadFailure, keepMapShell, readMapData } from "../features/maps/map-read-recovery";
import { mapViewerKey } from "../features/maps/map-viewer-key.server";
import { MapPlaceDetail } from "../components/map/MapPlaceDetail";
import { PlaceMap } from "../components/map/PlaceMap";
import { PlaceDetailSheet } from "../components/places/PlaceDetailSheet";
import { safePlaceDetailSearchPath, type OpenPlaceDetail } from "../components/places/PlaceCard";
import { PlaceSearchError } from "../components/places/PlaceSearchError";
import { createDb } from "../db/client.server";
import { getOptionalUser } from "../features/auth/session.server";
import {
  parseHomeCurationState,
  type HomeCurationMode,
  type HomeLocationSource,
  type HomeMapView,
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
import type { HomeCurationPage } from "../features/places/home-curation";
import {
  encodeHomeRecommendationHistory,
  readHomeRecommendationHistory,
  recordHomeRecommendation,
} from "../features/places/home-curation-history.client";
import { getHomeCurationPage } from "../features/places/home-curation.server";
import { getPublicPlaceCounts, getPublicPlacePage, listPublicCategoryGroups } from "../features/places/place.server";
import { publicPlaceBrowseHref, readPublicPlaceBrowse, updatePublicPlaceBrowseSearch } from "../features/places/public-place-browse";
import { publicPageMeta, resolvePublicOrigin } from "../features/places/public-metadata";

type RecommendationFetcherState = "idle" | "loading" | "submitting";

export function buildRecommendationUrl(
  mode: HomeCurationMode,
  bbox: [number, number, number, number],
  locationSource: HomeLocationSource,
  requestToken: string,
  storage: Storage = sessionStorage,
) {
  const params = new URLSearchParams({
    mode,
    bbox: bbox.join(","),
    locationSource,
    requestToken,
    history: encodeHomeRecommendationHistory(readHomeRecommendationHistory(storage)),
  });
  return `/resources/home-recommendations?${params}`;
}

export function createHomeRecommendationRequestToken(sequence: number) {
  return `hr-${sequence.toString(36)}-${crypto.randomUUID()}`;
}

export function beginHomeRecommendationRequest(
  state: RecommendationFetcherState,
  requestKey: string,
): { pendingRequestKey: string; startedRequestKey: string | null } {
  return {
    pendingRequestKey: requestKey,
    startedRequestKey: state === "idle" ? null : requestKey,
  };
}

type NullableStringRef = { current: string | null };

export function clearHomeRecommendationRequestLifecycle(input: {
  pendingRequestKeyRef: NullableStringRef;
  pendingRequestRouteKeyRef: NullableStringRef;
  startedRequestKeyRef: NullableStringRef;
}) {
  input.pendingRequestKeyRef.current = null;
  input.pendingRequestRouteKeyRef.current = null;
  input.startedRequestKeyRef.current = null;
}

export function getHomeRecommendationRouteKey(input: {
  view: HomeMapView;
  mode: HomeCurationMode;
  bbox: [number, number, number, number];
  locationSource: HomeLocationSource;
}) {
  return [
    input.view,
    input.mode,
    input.bbox.map((value) => value.toFixed(5)).join(","),
    input.locationSource,
  ].join("|");
}

export function isCurrentHomeRecommendationResponse(
  state: RecommendationFetcherState,
  response: unknown,
  requestKey: string | null,
  startedRequestKey: string | null,
  requestRouteKey: string | null,
  currentRouteKey: string,
): response is { ok: unknown; requestToken: string } {
  return state === "idle"
    && Boolean(requestKey)
    && startedRequestKey === requestKey
    && Boolean(requestRouteKey)
    && requestRouteKey === currentRouteKey
    && typeof response === "object"
    && response !== null
    && "ok" in response
    && "requestToken" in response
    && response.requestToken === requestKey;
}

export function getRecordableHomeRecommendation(
  state: RecommendationFetcherState,
  response: unknown,
  requestKey: string | null,
  startedRequestKey: string | null,
  lastRecordedRequestKey: string | null,
  requestRouteKey: string | null,
  currentRouteKey: string,
): { requestKey: string; page: HomeCurationPage } | null {
  if (
    !isCurrentHomeRecommendationResponse(
      state,
      response,
      requestKey,
      startedRequestKey,
      requestRouteKey,
      currentRouteKey,
    )
    || !requestKey
    || lastRecordedRequestKey === requestKey
    || response.ok !== true
    || !("recommendations" in response)
    || typeof response.recommendations !== "object"
    || response.recommendations === null
  ) return null;

  const page = response.recommendations as Partial<HomeCurationPage>;
  if (
    page.algorithmVersion !== "home-curation-v2"
    || (page.status !== "READY" && page.status !== "EMPTY")
    || !Array.isArray(page.places)
  ) return null;

  return { requestKey, page: page as HomeCurationPage };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const title = "Re:Taste — 내 주변 맛 지도";
  const description = "현재 위치에서 찾는 광주·전남 맛 지도";
  return publicPageMeta({ title, description, path: "/", origin: loaderData && !isMapReadFailure(loaderData) ? loaderData.publicOrigin : null });
}

export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) {
  return readMapData(request, serverLoader);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const location = useLocation();
  return isRouteErrorResponse(error) && error.status === 400 && error.statusText === "INVALID_PAGE"
    ? <PlaceSearchError search={location.search} status={400} />
    : <MapReadError error={error} />;
}

export const shouldRevalidate: ShouldRevalidateFunction = (input) => {
  const { currentUrl, nextUrl, defaultShouldRevalidate } = input;
  const currentView = parseHomeCurationState(currentUrl.search).view;
  const nextView = parseHomeCurationState(nextUrl.search).view;
  if (keepMapShell(input) && currentView === "curated" && nextView === "curated") return false;
  return defaultShouldRevalidate;
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { state, filters, page } = readPublicPlaceBrowse(url.search);
  const homeState = parseHomeCurationState(url.search);
  const qaMode = url.searchParams.has("qa");
  const db = createDb(env.DB);
  const user = await getOptionalUser(request);
  const common = {
    state,
    mapViewerKey: await mapViewerKey(request, user),
    publicOrigin: resolvePublicOrigin(request.url, (env as Env & { APP_BASE_URL?: string }).APP_BASE_URL),
    category: filters.categorySlug ?? null,
    search: url.search,
    // QA is deliberately self-contained: it must not call the external map SDK
    // just because an operator's local `.dev.vars` has a real Client ID.
    clientId: qaMode ? "" : env.NAVER_MAPS_CLIENT_ID ?? "",
    qaMode,
  };

  if (homeState.view === "browse") {
    if (page === null) throw new Response("검색 페이지 번호를 확인해 주세요.", { status: 400, statusText: "INVALID_PAGE" });
    const [{ places, ...pagination }, groups, placeCounts] = await Promise.all([
      getPublicPlacePage(db, filters, page),
      listPublicCategoryGroups(db, { query: filters.query, bbox: filters.bbox, tempOnly: filters.tempOnly }),
      filters.tempOnly ? null : getPublicPlaceCounts(db, filters),
    ]);
    return { ...common, view: "browse" as const, places, groups, placeCounts, pagination, tempOnly: filters.tempOnly, curation: null };
  }

  const now = new Date().toISOString();
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
    locationSource: homeState.locationSource,
  });
  return {
    ...common,
    view: "curated" as const,
    places: curation.places,
    groups: [],
    placeCounts: null,
    pagination: null,
    tempOnly: false,
    curation,
  };
}

type HomeData = Awaited<ReturnType<typeof loader>>;
export default function Home({ loaderData }: Route.ComponentProps) {
  const viewer = useMapViewerKey();
  const [invalidViewer, setInvalidViewer] = useState<string | null>(null);
  const allowIncoming = invalidViewer !== viewer && (isMapReadFailure(loaderData) || loaderData.mapViewerKey === viewer);
  return <MapReadBoundary<HomeData> incoming={loaderData} scope={`home:${viewer}`} allowIncoming={allowIncoming}>
    {(data, failed) => <HomeView key={viewer} loaderData={data} readFailed={failed} viewerKey={viewer} onViewerChange={() => setInvalidViewer(viewer)} />}
  </MapReadBoundary>;
}

function HomeView({ loaderData, readFailed, viewerKey, onViewerChange }: { loaderData: HomeData; readFailed: boolean; viewerKey: string; onViewerChange: () => void }) {
  const [params, setParams] = useSearchParams();
  const recommendationFetcher = useFetcher<typeof homeRecommendationLoader>();
  const [curation, setCuration] = useState(loaderData.curation);
  const [homeSheetSnap, setHomeSheetSnap] = useState<HomeSheetSnap>("half");
  const [mobileBrowseView, setMobileBrowseView] = useState<BrowseMobileView>("map");
  const [mapZoom, setMapZoom] = useState(12);
  const [focusCluster, setFocusCluster] = useState<RegionCluster | null>(null);
  const [locationBounds, setLocationBounds] = useState<[number, number, number, number] | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [pendingBounds, setPendingBounds] = useState<[number, number, number, number] | null>(null);
  const requestSequenceRef = useRef(0);
  const pendingRequestKeyRef = useRef<string | null>(null);
  const pendingRequestRouteKeyRef = useRef<string | null>(null);
  const startedRequestKeyRef = useRef<string | null>(null);
  const lastRecordedRequestKeyRef = useRef<string | null>(null);
  const lastRecordedLoaderCurationRef = useRef<HomeCurationPage | null>(null);
  const liveSearch = `?${params.toString()}`;
  const liveMapState = parseMapState(liveSearch);
  const liveHomeState = parseHomeCurationState(liveSearch);
  const previousHomeViewRef = useRef(liveHomeState.view);
  const currentRecommendationRouteKey = getHomeRecommendationRouteKey({
    view: liveHomeState.view,
    mode: liveHomeState.mode,
    bbox: liveMapState.bbox,
    locationSource: liveHomeState.locationSource,
  });
  const isCurated = readFailed ? loaderData.view === "curated" : liveHomeState.view === "curated";
  const browseSearch = readFailed ? loaderData.search : liveSearch;
  const activeCuration = curation ?? loaderData.curation;
  const activePlaces = isCurated && activeCuration ? activeCuration.places : loaderData.places;
  const requestedSelectedId = readFailed && !isCurated ? loaderData.state.selected : params.get("selected");
  const selectedId = requestedSelectedId ?? (isCurated ? activeCuration?.places[0]?.id ?? null : null);
  const selectedPlace = findSelectedPlace(activePlaces, selectedId);
  const selectedPlaceId = selectedPlace?.id;
  const detailPath = safePlaceDetailSearchPath(params.get("place"));
  const detailOpener = useRef<HTMLAnchorElement>(null);
  const clusterLevel = getRegionClusterLevel(mapZoom);
  const clusters = useMemo(() => isCurated ? [] : buildRegionClusters(activePlaces, mapZoom), [activePlaces, isCurated, mapZoom]);
  const regionGroups = useMemo(() => isCurated ? [] : buildRegionGroups(activePlaces, mapZoom), [activePlaces, isCurated, mapZoom]);
  const markerRanks = useMemo(() => Object.fromEntries(
    (isCurated ? activeCuration?.places ?? [] : []).map((place) => [place.id, place.rank]),
  ), [activeCuration, isCurated]);
  const recommendationResponseIsCurrent = isCurrentHomeRecommendationResponse(
    recommendationFetcher.state,
    recommendationFetcher.data,
    pendingRequestKeyRef.current,
    startedRequestKeyRef.current,
    pendingRequestRouteKeyRef.current,
    currentRecommendationRouteKey,
  );
  const recommendationError = recommendationResponseIsCurrent
    && recommendationFetcher.data
    && !recommendationFetcher.data.ok
    ? recommendationFetcher.data.message
    : null;
  const viewerChanged = recommendationResponseIsCurrent && recommendationFetcher.data?.ok === true
    && recommendationFetcher.data.mapViewerKey !== viewerKey;

  useEffect(() => {
    if (viewerChanged) onViewerChange();
  }, [viewerChanged, onViewerChange]);

  useEffect(() => {
    if (!loaderData.curation) return;
    setCuration(loaderData.curation);
    if (lastRecordedLoaderCurationRef.current !== loaderData.curation) {
      recordHomeRecommendation(sessionStorage, loaderData.curation);
      lastRecordedLoaderCurationRef.current = loaderData.curation;
    }
  }, [loaderData.curation]);

  useEffect(() => {
    if (previousHomeViewRef.current === "browse" && liveHomeState.view === "curated") {
      setHomeSheetSnap("half");
    }
    previousHomeViewRef.current = liveHomeState.view;
  }, [liveHomeState.view]);

  useEffect(() => {
    setPendingBounds(null);
    clearHomeRecommendationRequestLifecycle({
      pendingRequestKeyRef,
      pendingRequestRouteKeyRef,
      startedRequestKeyRef,
    });
  }, [loaderData.curation, loaderData.view]);

  useEffect(() => {
    if (
      !pendingRequestRouteKeyRef.current
      || pendingRequestRouteKeyRef.current === currentRecommendationRouteKey
    ) return;

    clearHomeRecommendationRequestLifecycle({
      pendingRequestKeyRef,
      pendingRequestRouteKeyRef,
      startedRequestKeyRef,
    });
  }, [currentRecommendationRouteKey]);

  useEffect(() => {
    if (viewerChanged) return;
    if (recommendationFetcher.state !== "idle") {
      startedRequestKeyRef.current = pendingRequestKeyRef.current;
      return;
    }

    const completed = getRecordableHomeRecommendation(
      recommendationFetcher.state,
      recommendationFetcher.data,
      pendingRequestKeyRef.current,
      startedRequestKeyRef.current,
      lastRecordedRequestKeyRef.current,
      pendingRequestRouteKeyRef.current,
      currentRecommendationRouteKey,
    );
    if (!completed) return;

    setCuration(completed.page);
    setPendingBounds(null);
    recordHomeRecommendation(sessionStorage, completed.page);
    lastRecordedRequestKeyRef.current = completed.requestKey;
    clearHomeRecommendationRequestLifecycle({
      pendingRequestKeyRef,
      pendingRequestRouteKeyRef,
      startedRequestKeyRef,
    });
  }, [currentRecommendationRouteKey, recommendationFetcher.data, recommendationFetcher.state, viewerChanged]);

  useEffect(() => {
    const curationMatchesUrl = !isCurated || activeCuration?.mode === liveHomeState.mode;
    if (!readFailed && requestedSelectedId && !selectedPlace && curationMatchesUrl) {
      setParams((current) => updateMapSearch(current, { selected: null }), { replace: true });
    }
  }, [activeCuration?.mode, isCurated, liveHomeState.mode, readFailed, requestedSelectedId, selectedPlace, setParams]);

  useEffect(() => {
    if (selectedPlaceId) setMobileBrowseView("map");
  }, [selectedPlaceId]);

  useEffect(() => {
    if (mobileBrowseView !== "list") return;
    const viewport = window.matchMedia("(max-width: 760px)");
    const restoreDesktop = () => { if (!viewport.matches) setMobileBrowseView("map"); };
    restoreDesktop();
    viewport.addEventListener("change", restoreDesktop);
    return () => viewport.removeEventListener("change", restoreDesktop);
  }, [mobileBrowseView]);

  const loadRecommendations = (
    mode: HomeCurationMode,
    bbox: [number, number, number, number],
    source: HomeLocationSource,
  ) => {
    const requestKey = createHomeRecommendationRequestToken(++requestSequenceRef.current);
    const requestUrl = buildRecommendationUrl(mode, bbox, source, requestKey);
    const lifecycle = beginHomeRecommendationRequest(recommendationFetcher.state, requestKey);
    pendingRequestKeyRef.current = lifecycle.pendingRequestKey;
    pendingRequestRouteKeyRef.current = getHomeRecommendationRouteKey({
      view: "curated",
      mode,
      bbox,
      locationSource: source,
    });
    startedRequestKeyRef.current = lifecycle.startedRequestKey;
    void recommendationFetcher.load(requestUrl);
  };
  const setSearch = (change: Parameters<typeof updateMapSearch>[1]) => {
    setParams((current) => (isCurated ? updateMapSearch : updatePublicPlaceBrowseSearch)(current, change), { replace: true });
  };
  const selectPlace = (id: string) => {
    setMobileBrowseView("map");
    setSearch({ selected: id });
  };
  const setBounds = (bbox: [number, number, number, number]) => {
    setSearch({
      bbox: bbox.map((value) => value.toFixed(5)).join(","),
      locationSource: "map_center",
    });
  };
  const setMode = (mode: HomeCurationMode) => {
    if (mode !== liveHomeState.mode) {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("mode", mode);
        next.delete("selected");
        return next;
      }, { replace: true });
    }
    loadRecommendations(mode, liveMapState.bbox, liveHomeState.locationSource);
  };
  const locate = () => navigator.geolocation?.getCurrentPosition(({ coords }) => {
    const result = resolveLocationViewport(coords);
    setLocationBounds(result.bbox);
    setLocationNotice(result.notice);
    setSearch({ bbox: result.bbox.map((value) => value.toFixed(5)).join(","), locationSource: "gps", selected: null });
    if (isCurated) loadRecommendations(liveHomeState.mode, result.bbox, "gps");
  }, () => {
    setLocationNotice("위치 권한을 확인한 뒤 다시 시도해주세요.");
  }, { enableHighAccuracy: true, timeout: 8_000 });
  const recommendPendingArea = () => {
    if (!pendingBounds) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("bbox", pendingBounds.map((value) => value.toFixed(5)).join(","));
      next.set("locationSource", "map_center");
      next.delete("selected");
      return next;
    }, { replace: true });
    loadRecommendations(liveHomeState.mode, pendingBounds, "map_center");
  };
  const browseAll = () => {
    setPendingBounds(null);
    clearHomeRecommendationRequestLifecycle({
      pendingRequestKeyRef,
      pendingRequestRouteKeyRef,
      startedRequestKeyRef,
    });
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", "browse");
      next.delete("selected");
      return next;
    });
  };
  const returnToCuration = () => {
    setPendingBounds(null);
    setHomeSheetSnap("half");
    clearHomeRecommendationRequestLifecycle({
      pendingRequestKeyRef,
      pendingRequestRouteKeyRef,
      startedRequestKeyRef,
    });
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("view");
      next.delete("category");
      next.delete("q");
      next.delete("selected");
      next.delete("place");
      next.delete("page");
      next.delete("temp");
      next.delete("badge");
      next.set("mode", "now");
      return next;
    });
  };
  const focusRegion = (cluster: RegionCluster) => {
    setSearch({ selected: null });
    setFocusCluster(cluster);
    setMapZoom(cluster.level === "DISTRICT" ? 13 : 15);
  };
  const openDetail: OpenPlaceDetail = (path, opener) => {
    detailOpener.current = opener;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("place", path.slice("/places/".length));
      return next;
    }, { preventScrollReset: true });
  };
  const closeDetail = () => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete("place");
    return next;
  }, { replace: true, preventScrollReset: true });
  const presentationProps = activeCuration ? {
    page: activeCuration,
    selectedPlaceId: selectedPlace?.id ?? null,
    mode: liveHomeState.mode,
    pending: recommendationFetcher.state !== "idle",
    error: recommendationError,
    onModeChange: setMode,
    onSelect: (id: string) => setSearch({ selected: id }),
    onLocate: locate,
    onRetry: () => loadRecommendations(liveHomeState.mode, liveMapState.bbox, liveHomeState.locationSource),
  } : null;

  if (viewerChanged) return <MapReadError viewerChanged />;

  return <main id="main" className={`map-explorer${isCurated ? " map-explorer--curated" : ""}`}>
    {isCurated && presentationProps ? <HomeCurationPanel {...presentationProps} /> : <MapExplorerPanel
      places={activePlaces}
      groups={loaderData.groups}
      regionGroups={regionGroups}
      clusterLevel={clusterLevel}
      query={readFailed ? loaderData.state.query : liveMapState.query}
      category={loaderData.category}
      counts={loaderData.placeCounts}
      pagination={loaderData.pagination}
      tempOnly={loaderData.tempOnly}
      browseSearch={browseSearch}
      listHref={publicPlaceBrowseHref("list", browseSearch, { selected: selectedPlace?.id })}
      mobileView={mobileBrowseView}
      onMobileViewChange={setMobileBrowseView}
      onSelect={selectPlace}
      onSearch={(q) => setSearch({ q, selected: null })}
      onCategory={(category) => setSearch({ category, selected: null })}
      onLocate={locate}
      onExpandBounds={(bounds) => { setLocationBounds(bounds); setBounds(bounds); }}
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
        deferBounds
        initialBounds={liveMapState.bbox}
        locationBounds={locationBounds}
        locationNotice={locationNotice}
        onSelect={selectPlace}
        onBounds={isCurated ? () => undefined : setBounds}
        onPendingBounds={isCurated ? setPendingBounds : setBounds}
        onZoom={setMapZoom}
        onClusterSelect={focusRegion}
      />
      {isCurated && pendingBounds && <button type="button" className="home-curation-reload-area" onClick={recommendPendingArea}>이 지역 다시 추천</button>}
      {isCurated && presentationProps && <HomeCurationSheet
        {...presentationProps}
        snap={homeSheetSnap}
        onSnapChange={setHomeSheetSnap}
      />}
      <button
        type="button"
        id="map-browse-toggle"
        className="home-curation-view-toggle"
        onClick={isCurated ? browseAll : returnToCuration}
      >
        {isCurated ? "전체 지도" : "추천 지도"}
      </button>
      {!isCurated && mobileBrowseView === "map" && selectedPlace && <MapPlaceDetail key={selectedPlace.id} place={selectedPlace} onBack={() => setSearch({ selected: null })} onOpenDetail={openDetail} />}
      <PlaceDetailSheet detailPath={detailPath} opener={detailOpener.current} fallbackFocus={isCurated ? "#map-browse-toggle" : mobileBrowseView === "list" ? "#map-search" : ".map-mobile-tabs button[aria-pressed=true]"} onClose={closeDetail} />
    </section>
  </main>;
}
