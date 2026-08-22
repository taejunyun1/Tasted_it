import { useEffect, useRef, useState } from "react";
import { loadNaverMaps, toBoundsTuple } from "../../features/maps/naver-map-sdk";
import {
  getClusterFocusBounds,
  getClusterFocusZoom,
  getMarkerFocusZoom,
  getMarkerInfluence,
} from "../../features/maps/place-marker-policy";
import type { RegionCluster } from "../../features/maps/region-cluster-policy";
import type { PlaceSummary } from "../../features/places/place.types";
import { LAUNCH_DEFAULT_BBOX, LAUNCH_DEFAULT_CENTER } from "../../features/regions/region-pack";

function detachMarkers(markers: naver.maps.Marker[]) {
  markers.forEach((marker) => {
    try {
      marker.setMap(null);
    } catch {
      // The NAVER SDK can already be torn down while React disposes effects during HMR.
    }
  });
}

const GWANGJU_OVERVIEW_BOUNDS = {
  west: LAUNCH_DEFAULT_BBOX[0],
  south: LAUNCH_DEFAULT_BBOX[1],
  east: LAUNCH_DEFAULT_BBOX[2],
  north: LAUNCH_DEFAULT_BBOX[3],
} as const;
const MUDEUNGSAN_OVERVIEW_ICON_POINT = { x: 95, y: 63 } as const;
const YEONGSAN_RIVER_OVERVIEW_LINE = "44,3 35,24 22,41 16,62 12,88";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundOverviewValue(value: number) {
  return Number(value.toFixed(1));
}

export function getGwangjuOverviewPoint({ latitude, longitude }: {
  latitude: number;
  longitude: number;
}): { x: number; y: number } | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const x = ((longitude - GWANGJU_OVERVIEW_BOUNDS.west) /
    (GWANGJU_OVERVIEW_BOUNDS.east - GWANGJU_OVERVIEW_BOUNDS.west)) * 100;
  const y = ((GWANGJU_OVERVIEW_BOUNDS.north - latitude) /
    (GWANGJU_OVERVIEW_BOUNDS.north - GWANGJU_OVERVIEW_BOUNDS.south)) * 100;
  return {
    x: roundOverviewValue(clamp(x, 6, 94)),
    y: roundOverviewValue(clamp(y, 6, 94)),
  };
}

function SelectedPlaceOverview({ belowFloatingMessage = false, place }: {
  belowFloatingMessage?: boolean;
  place: PlaceSummary;
}) {
  const point = getGwangjuOverviewPoint({
    latitude: place.latitude,
    longitude: place.longitude,
  });
  if (!point) return null;

  return <div
    className={`map-location-overview${belowFloatingMessage ? " map-location-overview--below-message" : ""}`}
    role="img"
    aria-label={`광주시 벨트라인, 무등산, 영산강 기준 ${place.name} 위치 미니맵`}
  >
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g className="map-location-overview__beltline">
        <rect className="map-location-overview__region" x="12" y="22" width="76" height="56" rx="16" />
        <path className="map-location-overview__district" d="M31 25 C36 38 34 54 26 71" />
        <path className="map-location-overview__district" d="M70 25 C61 40 63 57 78 72" />
        <path className="map-location-overview__district" d="M20 52 C38 53 57 62 73 75" />
        <path className="map-location-overview__district" d="M50 24 C55 41 52 60 44 76" />
      </g>
      <polyline className="map-location-overview__river" points={YEONGSAN_RIVER_OVERVIEW_LINE} />
      <g
        className="map-location-overview__mountain-icon"
        transform={`translate(${MUDEUNGSAN_OVERVIEW_ICON_POINT.x} ${MUDEUNGSAN_OVERVIEW_ICON_POINT.y})`}
      >
        <path d="M-5 6 L0 -6 L5 6 Z" />
      </g>
      <circle className="map-location-overview__dot" cx={point.x} cy={point.y} r="4.5" />
    </svg>
  </div>;
}

export function mapBoundsDeliveryTarget(input: {
  deferBounds: boolean;
  viewportDirty: boolean;
}): "ignore" | "pending" | "committed" {
  if (!input.deferBounds) return "committed";
  return input.viewportDirty ? "pending" : "ignore";
}

export function PlaceMap({ places, selected, clientId, qaMode = false, zoom = 15, clusters = [], focusCluster = null, markerRanks = {}, deferBounds = false, onSelect, onBounds, onPendingBounds = () => undefined, onZoom = () => undefined, onClusterSelect = () => undefined, initialBounds, locationBounds, locationNotice = null }: {
  places: PlaceSummary[];
  selected: string | null;
  clientId: string;
  qaMode?: boolean;
  zoom?: number;
  clusters?: RegionCluster[];
  focusCluster?: RegionCluster | null;
  markerRanks?: Record<string, number>;
  deferBounds?: boolean;
  onSelect: (id: string) => void;
  onBounds: (bbox: [number, number, number, number]) => void;
  onPendingBounds?: (bbox: [number, number, number, number]) => void;
  onZoom?: (zoom: number) => void;
  onClusterSelect?: (cluster: RegionCluster) => void;
  initialBounds?: [number, number, number, number];
  locationBounds?: [number, number, number, number] | null;
  locationNotice?: string | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<naver.maps.Map | null>(null);
  const initialClientId = useRef(clientId);
  const initialBoundsRef = useRef(initialBounds);
  const selectRef = useRef(onSelect);
  const boundsRef = useRef(onBounds);
  const pendingBoundsRef = useRef(onPendingBounds);
  const deferBoundsRef = useRef(deferBounds);
  const zoomRef = useRef(onZoom);
  const clusterSelectRef = useRef(onClusterSelect);
  const markersRef = useRef<naver.maps.Marker[]>([]);
  const suppressBoundsUntilRef = useRef(0);
  const viewportDirtyRef = useRef(false);
  const qaFallback = !clientId && qaMode;
  const selectedPlace = selected ? places.find((candidate) => candidate.id === selected) : undefined;
  const selectedLatitude = selectedPlace?.latitude;
  const selectedLongitude = selectedPlace?.longitude;
  const hasFloatingMapMessage = qaFallback ? Boolean(locationNotice) : Boolean(error || locationNotice);
  const selectedOverview = selectedPlace
    ? <SelectedPlaceOverview belowFloatingMessage={hasFloatingMapMessage} place={selectedPlace} />
    : null;
  selectRef.current = onSelect;
  boundsRef.current = onBounds;
  pendingBoundsRef.current = onPendingBounds;
  deferBoundsRef.current = deferBounds;
  zoomRef.current = onZoom;
  clusterSelectRef.current = onClusterSelect;

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let instance: naver.maps.Map | undefined;
    let mapsApi: typeof naver.maps | undefined;
    let idleListener: unknown;
    let zoomListener: unknown;

    if (!initialClientId.current) {
      setError("NAVER Maps Client ID가 설정되지 않았습니다.");
      return;
    }

    setError(null);
    void loadNaverMaps(initialClientId.current).then(({ maps }) => {
      if (disposed || !host.current) return;
      mapsApi = maps;
      const created = new maps.Map(host.current, {
        center: new maps.LatLng(LAUNCH_DEFAULT_CENTER.latitude, LAUNCH_DEFAULT_CENTER.longitude),
        zoom: 12,
        zoomControl: true,
        zoomControlOptions: { position: maps.Position.TOP_RIGHT },
      });
      instance = created;
      setMap(created);

      if (initialBoundsRef.current) {
        const [west, south, east, north] = initialBoundsRef.current;
        created.fitBounds(new maps.LatLngBounds(
          new maps.LatLng(south, west),
          new maps.LatLng(north, east),
        ));
      }

      idleListener = maps.Event.addListener(created, "idle", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (Date.now() < suppressBoundsUntilRef.current) return;
          const bounds = created.getBounds();
          const southwest = bounds.getSW();
          const northeast = bounds.getNE();
          const nextBounds = toBoundsTuple(
            { lat: southwest.lat(), lng: southwest.lng() },
            { lat: northeast.lat(), lng: northeast.lng() },
          );
          const target = mapBoundsDeliveryTarget({
            deferBounds: deferBoundsRef.current,
            viewportDirty: viewportDirtyRef.current,
          });
          if (target === "ignore") return;
          if (target === "pending") {
            viewportDirtyRef.current = false;
            pendingBoundsRef.current(nextBounds);
          } else {
            boundsRef.current(nextBounds);
          }
        }, 400);
      });
      zoomListener = maps.Event.addListener(created, "zoom_changed", () => {
        zoomRef.current(created.getZoom());
      });
      zoomRef.current(created.getZoom());
    }).catch(() => {
      if (!disposed) setError("네이버 지도를 불러오지 못했습니다. 등록 URL과 Client ID를 확인해주세요.");
    });

    return () => {
      disposed = true;
      clearTimeout(timer);
      detachMarkers(markersRef.current);
      markersRef.current = [];
      if (idleListener && mapsApi) mapsApi.Event.removeListener(idleListener);
      if (zoomListener && mapsApi) mapsApi.Event.removeListener(zoomListener);
      setMap((current) => current === instance ? null : current);
      instance?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!map || !window.naver?.maps) return;
    const { maps } = window.naver;
    const markers = clusters.length ? clusters.map((cluster) => {
      const position = new maps.LatLng(cluster.latitude, cluster.longitude);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-region-marker";
      button.setAttribute("aria-label", `${cluster.label} 음식점 ${cluster.count}곳, 확대해서 보기`);
      button.dataset.regionLabel = cluster.label;
      const label = document.createElement("span");
      label.textContent = cluster.label;
      const count = document.createElement("strong");
      count.textContent = `${cluster.count}`;
      button.appendChild(label);
      button.appendChild(count);
      button.onclick = () => clusterSelectRef.current(cluster);
      return new maps.Marker({
        map,
        position,
        icon: { content: button, anchor: new maps.Point(44, 18) },
      });
    }) : places.map((place) => {
      const influence = getMarkerInfluence(place.ratingSampleCount ?? 0, 0);
      const isSelected = selected === place.id;
      const markerRank = markerRanks[place.id];
      const markerSize = markerRank ? (isSelected ? 42 : 38) : isSelected ? 36 : influence === "high" ? 34 : influence === "medium" ? 32 : 30;
      const position = new maps.LatLng(place.latitude, place.longitude);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `map-pin influence-${influence}${markerRank ? " map-pin--ranked" : ""}${isSelected ? " is-selected" : ""}`;
      button.setAttribute("aria-label", `${markerRank ? `${markerRank}번 ` : ""}${place.name} 지도 핀`);
      button.dataset.placeId = place.id;
      button.dataset.influence = influence;
      if (markerRank) button.dataset.rank = String(markerRank);
      button.textContent = markerRank ? String(markerRank) : place.primaryCategory.emoji;
      button.onclick = () => {
        selectRef.current(place.id);
      };
      return new maps.Marker({
        map,
        position,
        icon: { content: button, anchor: new maps.Point(markerSize / 2, markerSize / 2) },
      });
    });
    markersRef.current = markers;
    return () => {
      if (markersRef.current !== markers) return;
      markersRef.current = [];
      detachMarkers(markers);
    };
  }, [clusters, map, markerRanks, places, selected]);

  useEffect(() => {
    if (!map || !window.naver?.maps || !focusCluster) return;
    const targetZoom = getClusterFocusZoom(focusCluster.level);
    const position = new window.naver.maps.LatLng(focusCluster.latitude, focusCluster.longitude);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    suppressBoundsUntilRef.current = Date.now() + 1_500;
    if (reduceMotion) {
      map.setCenter(position);
      map.setZoom(targetZoom);
    } else {
      map.morph(position, targetZoom, { duration: 520, easing: "easeOutCubic" });
    }
    boundsRef.current(getClusterFocusBounds(focusCluster.bounds, focusCluster.level));
  }, [focusCluster, map]);

  useEffect(() => {
    if (!map || !window.naver?.maps || !locationBounds) return;
    const [west, south, east, north] = locationBounds;
    suppressBoundsUntilRef.current = Date.now() + 1_500;
    map.fitBounds(new window.naver.maps.LatLngBounds(
      new window.naver.maps.LatLng(south, west),
      new window.naver.maps.LatLng(north, east),
    ));
  }, [locationBounds, map]);

  useEffect(() => {
    if (!map || !window.naver?.maps || !selected || selectedLatitude === undefined || selectedLongitude === undefined) return;
    const position = new window.naver.maps.LatLng(selectedLatitude, selectedLongitude);
    const focusZoom = getMarkerFocusZoom(map.getZoom()) ?? map.getZoom();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    suppressBoundsUntilRef.current = Date.now() + 1_500;
    if (reduceMotion) {
      map.setCenter(position);
      map.setZoom(focusZoom);
    } else {
      map.morph(position, focusZoom, { duration: 520, easing: "easeOutCubic" });
    }
  }, [map, selected, selectedLatitude, selectedLongitude]);

  const handleViewportIntent = () => {
    viewportDirtyRef.current = true;
  };
  const deliverQaBounds = (bbox: [number, number, number, number]) => {
    const target = mapBoundsDeliveryTarget({ deferBounds, viewportDirty: true });
    if (target === "pending") onPendingBounds(bbox);
    else onBounds(bbox);
  };
  if (qaFallback) return <div
    className="map-canvas map-canvas--qa"
    aria-label="장소 지도"
    data-focused-place={selected || undefined}
    data-focused-region={focusCluster?.label}
    data-map-zoom={zoom}
    onPointerDown={handleViewportIntent}
    onWheel={handleViewportIntent}
  >
    {locationNotice && <p className="map-error" role="status" aria-live="polite">{locationNotice}</p>}
    {selectedOverview}
    <a href="#" aria-label="지도 확대" onClick={(event) => {
      event.preventDefault();
      const nextZoom = zoom + 1;
      onZoom(nextZoom);
      const delta = Math.max(0.004, 0.02 / Math.max(1, nextZoom - 10));
      deliverQaBounds([
        LAUNCH_DEFAULT_CENTER.longitude - delta,
        LAUNCH_DEFAULT_CENTER.latitude - delta,
        LAUNCH_DEFAULT_CENTER.longitude + delta,
        LAUNCH_DEFAULT_CENTER.latitude + delta,
      ]);
    }}>+</a>
    {clusters.length ? clusters.map((cluster) => <button
      key={cluster.id}
      type="button"
      className="map-region-marker"
      aria-label={`${cluster.label} 음식점 ${cluster.count}곳, 확대해서 보기`}
      data-region-label={cluster.label}
      onClick={() => {
        const nextZoom = getClusterFocusZoom(cluster.level);
        const [west, south, east, north] = getClusterFocusBounds(cluster.bounds, cluster.level);
        onClusterSelect(cluster);
        onZoom(nextZoom);
        deliverQaBounds([west, south, east, north]);
      }}
    ><span>{cluster.label}</span><strong>{cluster.count}</strong></button>) : places.map((place) => {
      const influence = getMarkerInfluence(place.ratingSampleCount ?? 0, 0);
      const markerRank = markerRanks[place.id];
      return <button key={place.id} type="button" className={`map-pin influence-${influence}${markerRank ? " map-pin--ranked" : ""}${selected === place.id ? " is-selected" : ""}`} aria-label={`${markerRank ? `${markerRank}번 ` : ""}${place.name} 지도 핀`} data-place-id={place.id} data-influence={influence} data-rank={markerRank} onClick={() => onSelect(place.id)}>{markerRank ?? place.primaryCategory.emoji}</button>;
    })}
  </div>;

  return <div className="map-canvas" aria-label="장소 지도" data-focused-place={selected || undefined} data-focused-region={focusCluster?.label} data-map-zoom={zoom} onPointerDown={handleViewportIntent} onWheel={handleViewportIntent}>
    <div className="map-canvas__host" ref={host} aria-hidden="true" />
    {(error || locationNotice) && <p className="map-error" role="status" aria-live="polite">{error || locationNotice}</p>}
    {selectedOverview}
  </div>;
}
