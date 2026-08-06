import { env } from "cloudflare:workers";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import type { Route } from "./+types/home";
import { MapExplorerPanel } from "../components/map/MapExplorerPanel";
import { MapPlaceDetail } from "../components/map/MapPlaceDetail";
import { PlaceMap } from "../components/map/PlaceMap";
import { createDb } from "../db/client.server";
import { parseMapState } from "../features/maps/map-state";
import { findSelectedPlace, updateMapSearch } from "../features/maps/map-selection";
import { listPlaces, listPublicCategoryGroups } from "../features/places/place.server";

export function meta() {
  return [{ title: "Re:Taste — 내 주변 맛 지도" }, { name: "description", content: "현재 위치에서 찾는 광주·전남 맛 지도" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const state = parseMapState(url.search);
  const category = url.searchParams.get("category") || undefined;
  const db = createDb(env.DB);
  const [places, groups] = await Promise.all([
    listPlaces(db, { categorySlug: category, query: state.query, bbox: state.bbox }),
    listPublicCategoryGroups(db),
  ]);
  return { places, groups, state, category: category ?? null, clientId: env.NAVER_MAPS_CLIENT_ID ?? "" };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const selectedPlace = findSelectedPlace(loaderData.places, loaderData.state.selected);
  const setSearch = (change: Parameters<typeof updateMapSearch>[1]) => setParams((current) => updateMapSearch(current, change), { replace: true });
  const setBounds = (bbox: [number, number, number, number]) => setSearch({ bbox: bbox.map((value) => value.toFixed(5)).join(",") });
  const locate = () => navigator.geolocation?.getCurrentPosition(({ coords }) => {
    const longitudeRadius = 0.025;
    const latitudeRadius = 0.018;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("bbox", [coords.longitude - longitudeRadius, coords.latitude - latitudeRadius, coords.longitude + longitudeRadius, coords.latitude + latitudeRadius].map((value) => value.toFixed(5)).join(","));
      next.delete("selected");
      return next;
    }, { replace: true });
  });

  useEffect(() => {
    if (loaderData.state.selected && !selectedPlace) setSearch({ selected: null });
  }, [loaderData.state.selected, selectedPlace]);

  return <main id="main" className="map-explorer">
    <MapExplorerPanel
      places={loaderData.places}
      groups={loaderData.groups}
      query={loaderData.state.query}
      category={loaderData.category}
      hasSelectedPlace={Boolean(selectedPlace)}
      onSelect={(id) => setSearch({ selected: id })}
      onSearch={(q) => setSearch({ q, selected: null })}
      onCategory={(category) => setSearch({ category, selected: null })}
      onLocate={locate}
    />
    <section className="map-explorer-map" aria-label="지도 영역">
      <PlaceMap
        places={loaderData.places}
        selected={selectedPlace?.id ?? null}
        clientId={loaderData.clientId}
        initialBounds={params.has("bbox") ? loaderData.state.bbox : undefined}
        locateOnLoad={!params.has("bbox")}
        onSelect={(id) => setSearch({ selected: id })}
        onBounds={setBounds}
      />
      {selectedPlace && <MapPlaceDetail key={selectedPlace.id} place={selectedPlace} onBack={() => setSearch({ selected: null })} />}
    </section>
  </main>;
}
