import { useEffect, useRef, useState } from "react";
import { loadNaverMaps, toBoundsTuple } from "../../features/maps/naver-map-sdk";
import type { PlaceSummary } from "../../features/places/place.types";

export function PlaceMap({ places, selected, clientId, onSelect, onBounds }: {
  places: PlaceSummary[];
  selected: string | null;
  clientId: string;
  onSelect: (id: string) => void;
  onBounds: (bbox: [number, number, number, number]) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef(onSelect);
  const boundsRef = useRef(onBounds);
  selectRef.current = onSelect;
  boundsRef.current = onBounds;

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let map: naver.maps.Map | undefined;
    let idleListener: unknown;
    const markers: naver.maps.Marker[] = [];

    if (!clientId) {
      setError("NAVER Maps Client ID가 설정되지 않았습니다.");
      return;
    }

    setError(null);
    void loadNaverMaps(clientId).then(({ maps }) => {
      if (disposed || !host.current) return;
      const instance = new maps.Map(host.current, {
        center: new maps.LatLng(35.1595, 126.8526),
        zoom: 12,
        zoomControl: true,
        zoomControlOptions: { position: maps.Position.TOP_RIGHT },
      });
      map = instance;

      for (const place of places) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `map-pin${selected === place.id ? " is-selected" : ""}`;
        button.setAttribute("aria-label", `${place.name} 지도 핀`);
        button.textContent = place.primaryCategory.emoji;
        button.onclick = () => selectRef.current(place.id);
        markers.push(new maps.Marker({
          map: instance,
          position: new maps.LatLng(place.latitude, place.longitude),
          icon: { content: button, anchor: new maps.Point(21, 21) },
        }));
      }

      idleListener = maps.Event.addListener(instance, "idle", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const bounds = instance.getBounds();
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
      markers.forEach((marker) => marker.setMap(null));
      map?.destroy();
    };
  }, [clientId, places, selected]);

  return <div className="map-canvas" ref={host} aria-label="장소 지도">
    {error && <p className="map-error" role="status">{error}</p>}
  </div>;
}
