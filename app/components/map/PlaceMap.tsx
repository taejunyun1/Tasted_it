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

export function PlaceMap({ places, selected, clientId, qaMode = false, zoom = 15, clusters = [], focusCluster = null, onSelect, onBounds, onZoom = () => undefined, onClusterSelect = () => undefined, initialBounds, locateOnLoad = false }: {
  places: PlaceSummary[];
  selected: string | null;
  clientId: string;
  qaMode?: boolean;
  zoom?: number;
  clusters?: RegionCluster[];
  focusCluster?: RegionCluster | null;
  onSelect: (id: string) => void;
  onBounds: (bbox: [number, number, number, number]) => void;
  onZoom?: (zoom: number) => void;
  onClusterSelect?: (cluster: RegionCluster) => void;
  initialBounds?: [number, number, number, number];
  locateOnLoad?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<naver.maps.Map | null>(null);
  const initialClientId = useRef(clientId);
  const initialLocateOnLoad = useRef(locateOnLoad);
  const initialBoundsRef = useRef(initialBounds);
  const selectRef = useRef(onSelect);
  const boundsRef = useRef(onBounds);
  const zoomRef = useRef(onZoom);
  const clusterSelectRef = useRef(onClusterSelect);
  const suppressBoundsUntilRef = useRef(0);
  selectRef.current = onSelect;
  boundsRef.current = onBounds;
  zoomRef.current = onZoom;
  clusterSelectRef.current = onClusterSelect;

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let instance: naver.maps.Map | undefined;
    let idleListener: unknown;
    let zoomListener: unknown;
    let locationMarker: naver.maps.Marker | undefined;

    if (!initialClientId.current) {
      setError("NAVER Maps Client ID가 설정되지 않았습니다.");
      return;
    }

    setError(null);
    void loadNaverMaps(initialClientId.current).then(({ maps }) => {
      if (disposed || !host.current) return;
      const created = new maps.Map(host.current, {
        center: new maps.LatLng(35.1595, 126.8526),
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

      if (initialLocateOnLoad.current && navigator.geolocation) navigator.geolocation.getCurrentPosition(({ coords }) => {
        if (disposed) return;
        const position = new maps.LatLng(coords.latitude, coords.longitude);
        created.setCenter(position);
        created.setZoom(15);
        const dot = document.createElement("span");
        dot.className = "current-location-dot";
        dot.setAttribute("aria-label", "내 위치");
        locationMarker = new maps.Marker({ map: created, position, icon: { content: dot, anchor: new maps.Point(10, 10) } });
      }, () => undefined, { enableHighAccuracy: true, timeout: 8_000 });

      idleListener = maps.Event.addListener(created, "idle", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (Date.now() < suppressBoundsUntilRef.current) return;
          const bounds = created.getBounds();
          const southwest = bounds.getSW();
          const northeast = bounds.getNE();
          boundsRef.current(toBoundsTuple(
            { lat: southwest.lat(), lng: southwest.lng() },
            { lat: northeast.lat(), lng: northeast.lng() },
          ));
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
      if (idleListener) naver.maps.Event.removeListener(idleListener);
      if (zoomListener) naver.maps.Event.removeListener(zoomListener);
      locationMarker?.setMap(null);
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
      const influence = getMarkerInfluence(place.positive, place.negative);
      const isSelected = selected === place.id;
      const markerSize = isSelected ? 36 : influence === "high" ? 34 : influence === "medium" ? 32 : 30;
      const position = new maps.LatLng(place.latitude, place.longitude);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `map-pin influence-${influence}${isSelected ? " is-selected" : ""}`;
      button.setAttribute("aria-label", `${place.name} 지도 핀`);
      button.dataset.influence = influence;
      button.textContent = place.primaryCategory.emoji;
      button.onclick = () => {
        selectRef.current(place.id);
      };
      return new maps.Marker({
        map,
        position,
        icon: { content: button, anchor: new maps.Point(markerSize / 2, markerSize / 2) },
      });
    });
    return () => markers.forEach((marker) => marker.setMap(null));
  }, [clusters, map, places, selected]);

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
    if (!map || !window.naver?.maps || !selected) return;
    const place = places.find((candidate) => candidate.id === selected);
    if (!place) return;
    const position = new window.naver.maps.LatLng(place.latitude, place.longitude);
    const focusZoom = getMarkerFocusZoom(map.getZoom()) ?? map.getZoom();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    suppressBoundsUntilRef.current = Date.now() + 1_500;
    if (reduceMotion) {
      map.setCenter(position);
      map.setZoom(focusZoom);
    } else {
      map.morph(position, focusZoom, { duration: 520, easing: "easeOutCubic" });
    }
  }, [map, places, selected]);

  const qaFallback = !clientId && qaMode;
  if (qaFallback) return <div
    className="map-canvas map-canvas--qa"
    aria-label="장소 지도"
    data-focused-place={selected || undefined}
    data-focused-region={focusCluster?.label}
    data-map-zoom={zoom}
  >
    <a href="#" aria-label="지도 확대" onClick={(event) => {
      event.preventDefault();
      const nextZoom = zoom + 1;
      onZoom(nextZoom);
      const delta = Math.max(0.004, 0.02 / Math.max(1, nextZoom - 10));
      onBounds([126.8526 - delta, 35.1595 - delta, 126.8526 + delta, 35.1595 + delta]);
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
        onBounds([west, south, east, north]);
      }}
    ><span>{cluster.label}</span><strong>{cluster.count}</strong></button>) : places.map((place) => {
      const influence = getMarkerInfluence(place.positive, place.negative);
      return <button key={place.id} type="button" className={`map-pin influence-${influence}${selected === place.id ? " is-selected" : ""}`} aria-label={`${place.name} 지도 핀`} data-influence={influence} onClick={() => onSelect(place.id)}>{place.primaryCategory.emoji}</button>;
    })}
  </div>;

  return <div className="map-canvas" ref={host} aria-label="장소 지도" data-focused-place={selected || undefined} data-focused-region={focusCluster?.label} data-map-zoom={zoom}>
    {error && <p className="map-error" role="status">{error}</p>}
  </div>;
}
