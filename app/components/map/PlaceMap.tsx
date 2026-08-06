import { useEffect, useRef, useState } from "react";
import { loadNaverMaps, toBoundsTuple } from "../../features/maps/naver-map-sdk";
import { getMarkerFocusZoom, getMarkerInfluence } from "../../features/maps/place-marker-policy";
import type { PlaceSummary } from "../../features/places/place.types";

export function PlaceMap({ places, selected, clientId, onSelect, onBounds, initialBounds, locateOnLoad = false }: {
  places: PlaceSummary[];
  selected: string | null;
  clientId: string;
  onSelect: (id: string) => void;
  onBounds: (bbox: [number, number, number, number]) => void;
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
  const suppressBoundsUntilRef = useRef(0);
  selectRef.current = onSelect;
  boundsRef.current = onBounds;

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let instance: naver.maps.Map | undefined;
    let idleListener: unknown;
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
    }).catch(() => {
      if (!disposed) setError("네이버 지도를 불러오지 못했습니다. 등록 URL과 Client ID를 확인해주세요.");
    });

    return () => {
      disposed = true;
      clearTimeout(timer);
      if (idleListener) naver.maps.Event.removeListener(idleListener);
      locationMarker?.setMap(null);
      setMap((current) => current === instance ? null : current);
      instance?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!map || !window.naver?.maps) return;
    const { maps } = window.naver;
    const markers = places.map((place) => {
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
        // Commit the detail selection before map idle events update the bbox URL.
        selectRef.current(place.id);
        suppressBoundsUntilRef.current = Date.now() + 1_500;
        map.panTo(position);
        const focusZoom = getMarkerFocusZoom(map.getZoom());
        if (focusZoom !== null) map.setZoom(focusZoom);
      };
      return new maps.Marker({
        map,
        position,
        icon: { content: button, anchor: new maps.Point(markerSize / 2, markerSize / 2) },
      });
    });
    return () => markers.forEach((marker) => marker.setMap(null));
  }, [map, places, selected]);

  return <div className="map-canvas" ref={host} aria-label="장소 지도">
    {error && <p className="map-error" role="status">{error}</p>}
  </div>;
}
