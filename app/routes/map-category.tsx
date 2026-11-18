import { env } from "cloudflare:workers";
import { Form, Link, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/map-category";
import { createDb } from "../db/client.server";
import { parseMapState } from "../features/maps/map-state";
import { resolveLocationViewport } from "../features/maps/location-policy";
import { getPublicPlaceCounts, listPlaces } from "../features/places/place.server";
import { PlaceMap } from "../components/map/PlaceMap";
import { PlaceCard } from "../components/places/PlaceCard";
import { publicPageMeta, resolvePublicOrigin } from "../features/places/public-metadata";
import { categories } from "../db/schema";
import { eq } from "drizzle-orm";
import { MapReadBoundary, MapReadError, useMapViewerKey } from "../components/map/MapReadBoundary";
import { isMapReadFailure, readMapData } from "../features/maps/map-read-recovery";

export function meta({ params, loaderData }: Route.MetaArgs) {
  const loaded = loaderData && !isMapReadFailure(loaderData) ? loaderData : null;
  const category = loaded?.categoryName ?? "맛집";
  return publicPageMeta({ title: `${category} 지도 — Re:Taste`, description: `광주·전남 ${category} 장소를 지도와 목록에서 확인하세요.`, path: `/maps/${encodeURIComponent(params.categorySlug ?? "")}`, origin: loaded?.publicOrigin });
}

export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) { return readMapData(request, serverLoader); }
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <MapReadError error={error} />; }

export async function loader({ request, params }: Route.LoaderArgs) {
  const state = parseMapState(new URL(request.url).search);
  const db = createDb(env.DB);
  const filters = { categorySlug: params.categorySlug, query: state.query, bbox: state.bbox };
  const [places, counts, category] = await Promise.all([
    listPlaces(db, filters), getPublicPlaceCounts(db, filters),
    db.query.categories.findFirst({ columns: { name: true }, where: eq(categories.slug, params.categorySlug) }),
  ]);
  const clientId = (env as Env & { NAVER_MAPS_CLIENT_ID?: string }).NAVER_MAPS_CLIENT_ID ?? "";
  return { places, counts, state, categorySlug: params.categorySlug, categoryName: category?.name ?? null, clientId, publicOrigin: resolvePublicOrigin(request.url, (env as Env & { APP_BASE_URL?: string }).APP_BASE_URL) };
}

export default function CategoryMap({ loaderData }: Route.ComponentProps) {
  const viewer = useMapViewerKey();
  return <MapReadBoundary<Awaited<ReturnType<typeof loader>>> incoming={loaderData} scope={`category:${viewer ?? "guest"}`}>
    {(data) => <CategoryMapView key={viewer ?? "guest"} loaderData={data} />}
  </MapReadBoundary>;
}

function CategoryMapView({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const [params, setParams] = useSearchParams();
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [locationBounds, setLocationBounds] = useState<[number, number, number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const locationRequest = useRef(0);
  const locatingRef = useRef(false);
  useEffect(() => () => { locationRequest.current += 1; }, []);
  const setState = (key: string, value: string) => setParams((current) => { current.set(key, value); return current; }, { replace: true });
  const viewSearch = (view: "map" | "list") => {
    const next = new URLSearchParams(params);
    next.set("view", view);
    return `?${next}`;
  };
  const selected = loaderData.state.selected;
  const locate = () => {
    if (locatingRef.current) return;
    if (typeof navigator.geolocation?.getCurrentPosition !== "function") {
      setLocationNotice("이 브라우저는 현재 위치를 지원하지 않습니다. 지도를 직접 움직이거나 장소를 검색해 주세요.");
      return;
    }
    const requestId = ++locationRequest.current;
    locatingRef.current = true;
    setLocating(true);
    setLocationNotice("현재 위치를 확인하고 있습니다.");
    const finish = () => { locatingRef.current = false; setLocating(false); };
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (requestId !== locationRequest.current) return;
      finish();
      const result = resolveLocationViewport(coords);
      setLocationBounds(result.bbox);
      setLocationNotice(result.notice
        ? "Re:Taste는 지금 광주·전남만 다룹니다. 광주 기본 지도로 이동했습니다."
        : "현재 위치 주변으로 지도를 이동했습니다.");
      setState("bbox", result.bbox.map((value) => value.toFixed(5)).join(","));
    }, (error) => {
      if (requestId !== locationRequest.current) return;
      finish();
      setLocationNotice(error.code === 1
        ? "위치 권한이 꺼져 있습니다. 브라우저 설정에서 허용하거나 장소를 검색해 주세요."
        : error.code === 3
          ? "현재 위치 확인 시간이 초과됐습니다. 다시 시도하거나 장소를 검색해 주세요."
          : "현재 위치를 확인할 수 없습니다. 다시 시도하거나 지도를 직접 움직여 주세요.");
    }, { enableHighAccuracy: true, timeout: 8_000 });
  };
  return (
    <main id="main" className="explore-page">
      <header className="explore-head shell">
        <div><p className="eyebrow">CATEGORY / {loaderData.categorySlug.toUpperCase()}</p><h1>{loaderData.places[0]?.primaryCategory.emoji} {loaderData.places[0]?.primaryCategory.name ?? "맛집"} 지도</h1></div>
        <Form className="search-form"><label htmlFor="q">동네 또는 가게</label><input id="q" name="q" defaultValue={loaderData.state.query} placeholder="동명동, 라멘…" /><input type="hidden" name="bbox" value={loaderData.state.bbox.join(",")} /><input type="hidden" name="view" value={loaderData.state.view} />{selected && <input type="hidden" name="selected" value={selected} />}<button>찾기</button></Form>
      </header>
      <nav className="view-tabs shell" aria-label="보기 방식"><Link to={{ search: viewSearch("map") }}>지도</Link><Link to={{ search: viewSearch("list") }}>목록</Link><button type="button" disabled={locating} aria-busy={locating} onClick={locate}>{locating ? "위치 확인 중…" : "내 주변"}</button></nav>
      {locationNotice && <p className="shell" role="status" aria-live="polite">{locationNotice}</p>}
      <div className="explore-split" data-view={loaderData.state.view}>
        <section className="map-panel" aria-label="지도 보기">
          <PlaceMap places={loaderData.places} selected={selected} clientId={loaderData.clientId} initialBounds={params.has("bbox") ? loaderData.state.bbox : undefined} locationBounds={locationBounds} onViewportIntent={() => setLocationNotice(null)} onSelect={(id) => { setState("selected", id); document.getElementById(`place-${id}`)?.scrollIntoView({ behavior: "smooth" }); }} onBounds={(bbox) => setState("bbox", bbox.map((n) => n.toFixed(5)).join(","))} />
        </section>
        <section className="result-panel" aria-label="장소 목록">
          <p className="result-count" aria-live="polite">{loaderData.counts.count} PLACES</p>
          {loaderData.counts.count > loaderData.places.length && <p role="status">전체 {loaderData.counts.count}곳 중 이름순 첫 {loaderData.places.length}곳을 표시합니다. 검색어나 지도 범위를 좁혀 주세요.</p>}
          {loaderData.places.map((place) => <PlaceCard place={place} selected={selected === place.id} key={place.id} />)}
          {!loaderData.places.length && <div className="empty" role="status"><p>이 범위에서 조건에 맞는 장소를 찾지 못했어요.</p>{loaderData.counts.overallBounds && <button type="button" className="mt-3 min-h-[var(--control-height)] border border-current px-4" onClick={() => { const bounds = loaderData.counts.overallBounds!; setLocationBounds(bounds); setLocationNotice(null); setState("bbox", bounds.join(",")); }}>전체 결과 {loaderData.counts.overallCount}곳 보기</button>}</div>}
        </section>
      </div>
    </main>
  );
}
