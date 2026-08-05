import { useEffect, useRef } from "react";
import type { PlaceSummary } from "../../features/places/place.types";

export function PlaceMap({ places, selected, onSelect, onBounds }: {
  places: PlaceSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  onBounds: (bbox: [number, number, number, number]) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const selectRef = useRef(onSelect);
  const boundsRef = useRef(onBounds);
  selectRef.current = onSelect;
  boundsRef.current = onBounds;

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let map: import("maplibre-gl").Map | undefined;
    const markers: import("maplibre-gl").Marker[] = [];
    void import("maplibre-gl").then((maplibregl) => {
      if (disposed || !host.current) return;
      const instance = new maplibregl.Map({
        container: host.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: [126.8526, 35.1595], zoom: 11,
        attributionControl: { compact: true },
      });
      map = instance;
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      for (const place of places) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `map-pin${selected === place.id ? " is-selected" : ""}`;
        button.setAttribute("aria-label", `${place.name} 지도 핀`);
        button.textContent = place.primaryCategory.emoji;
        button.onclick = () => selectRef.current(place.id);
        markers.push(new maplibregl.Marker({ element: button }).setLngLat([place.longitude, place.latitude]).addTo(instance));
      }
      instance.on("moveend", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const b = instance.getBounds();
          if (b) boundsRef.current([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        }, 400);
      });
    });
    return () => { disposed = true; clearTimeout(timer); markers.forEach((m) => m.remove()); map?.remove(); };
  }, [places, selected]);

  return <div className="map-canvas" ref={host} aria-label="장소 지도" />;
}
