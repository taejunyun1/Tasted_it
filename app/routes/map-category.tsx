import { env } from "cloudflare:workers";
import { Form, isRouteErrorResponse, Link, useLocation, useNavigation, useSearchParams } from "react-router";
import { useRef, useState, type RefObject } from "react";
import type { Route } from "./+types/map-category";
import { createDb } from "../db/client.server";
import { parseMapState } from "../features/maps/map-state";
import { useMapLocationRequest } from "../features/maps/use-map-location-request";
import { getPublicPlaceCounts, getPublicPlacePage } from "../features/places/place.server";
import { parsePublicPlacePage } from "../features/places/public-place-pagination";
import { PlaceMap } from "../components/map/PlaceMap";
import { PlaceCard, safePlaceDetailSearchPath } from "../components/places/PlaceCard";
import { PlaceDetailSheet } from "../components/places/PlaceDetailSheet";
import { PLACE_DETAIL_MOBILE_QUERY } from "../features/places/place-detail-sheet";
import { publicPageMeta, resolvePublicOrigin } from "../features/places/public-metadata";
import { categories } from "../db/schema";
import { eq } from "drizzle-orm";
import { MapReadBoundary, MapReadError, useMapViewerKey } from "../components/map/MapReadBoundary";
import { isMapReadFailure, readMapData } from "../features/maps/map-read-recovery";

export function meta({ params, loaderData }: Route.MetaArgs) {
  const loaded = loaderData && !isMapReadFailure(loaderData) ? loaderData : null;
  const category = loaded?.category?.name ?? "맛집";
  const page = loaded?.pagination.page ?? 1;
  const title = page > 1 ? `${category} 지도 · ${page}페이지 — Re:Taste` : `${category} 지도 — Re:Taste`;
  return publicPageMeta({
    title,
    description: `광주·전남·전북 ${category} 장소를 지도와 목록에서 확인하세요.`,
    path: `/maps/${encodeURIComponent(params.categorySlug ?? "")}`,
    origin: loaded?.publicOrigin,
    noindex: loaded?.pagination.outOfRange,
  });
}

export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) { return readMapData(request, serverLoader); }

function categoryPageSearch(current: URLSearchParams, page: number) {
  const next = new URLSearchParams(current);
  next.delete("page");
  next.delete("selected");
  next.delete("place");
  if (page > 1) next.set("page", String(page));
  return `?${next}`;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const location = useLocation();
  if (!isRouteErrorResponse(error) || error.status !== 400 || error.statusText !== "INVALID_PAGE") return <MapReadError error={error} />;
  return <main id="main" className="error-page">
    <h1>검색 페이지를 확인해 주세요</h1>
    <p role="alert">페이지 번호가 올바르지 않습니다.</p>
    <Link className="inline-flex min-h-11 items-center underline!" to={{ search: categoryPageSearch(new URLSearchParams(location.search), 1) }}>같은 조건의 첫 페이지로 돌아가기</Link>
  </main>;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { search } = new URL(request.url);
  const state = parseMapState(search);
  const page = parsePublicPlacePage(search);
  if (page === null) throw new Response("검색 페이지 번호를 확인해 주세요.", { status: 400, statusText: "INVALID_PAGE" });
  const db = createDb(env.DB);
  const filters = { categorySlug: params.categorySlug, query: state.query, bbox: state.bbox };
  const [pagination, category] = await Promise.all([
    getPublicPlacePage(db, filters, page),
    db.query.categories.findFirst({ columns: { name: true, emoji: true }, where: eq(categories.slug, params.categorySlug) }),
  ]);
  const outsideResults = pagination.total === 0 && !pagination.outOfRange ? await getPublicPlaceCounts(db, filters) : null;
  const clientId = (env as Env & { NAVER_MAPS_CLIENT_ID?: string }).NAVER_MAPS_CLIENT_ID ?? "";
  return { pagination, outsideResults, state, categorySlug: params.categorySlug, category: category ?? null, clientId, publicOrigin: resolvePublicOrigin(request.url, (env as Env & { APP_BASE_URL?: string }).APP_BASE_URL) };
}

type DetailOpener = { element: HTMLElement; requestPath: string; replacement?: string };

export default function CategoryMap({ loaderData }: Route.ComponentProps) {
  const viewer = useMapViewerKey();
  // The first guest save can replace the viewer's map while the same detail stays open.
  const detailOpener = useRef<DetailOpener | null>(null);
  return <MapReadBoundary<Awaited<ReturnType<typeof loader>>> incoming={loaderData} scope={`category:${viewer ?? "guest"}`}>
    {(data) => <CategoryMapView key={viewer ?? "guest"} loaderData={data} detailOpener={detailOpener} />}
  </MapReadBoundary>;
}

function CategoryMapView({ loaderData, detailOpener }: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  detailOpener: RefObject<DetailOpener | null>;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const pendingLocation = useNavigation().location;
  const { locating, notice: locationNotice, clearLocation, locate: requestLocation } = useMapLocationRequest(`${location.key}:${pendingLocation?.key ?? ""}`);
  const [locationBounds, setLocationBounds] = useState<[number, number, number, number] | null>(null);
  const setState = (key: string, value: string) => setParams((current) => { current.set(key, value); return current; }, { replace: true });
  const setBounds = (bbox: [number, number, number, number]) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set("bbox", bbox.map((value) => value.toFixed(5)).join(","));
    const oldBounds = parseMapState(current.toString()).bbox;
    const newBounds = parseMapState(next.toString()).bbox;
    if (oldBounds.some((value, index) => value !== newBounds[index])) {
      next.delete("page");
      next.delete("place");
    }
    return next;
  }, { replace: true, preventScrollReset: true });
  const { pagination: { places, total, page, totalPages, start, end, outOfRange }, outsideResults, category } = loaderData;
  const outsideBounds = outsideResults?.overallBounds;
  const viewSearch = (view: "map" | "list") => {
    const next = new URLSearchParams(pendingLocation?.pathname === location.pathname ? pendingLocation.search : params);
    next.set("view", view);
    return `?${next}`;
  };
  const selected = loaderData.state.selected;
  const detailPath = safePlaceDetailSearchPath(params.get("place"));
  const currentOpener = detailOpener.current?.requestPath === detailPath ? detailOpener.current : null;
  const openDetail = (id: string, path: string, opener: HTMLElement) => {
    const placeId = CSS.escape(id);
    const replacement = opener.matches("button.map-pin")
      ? `.map-panel button.map-pin[data-place-id="${placeId}"]`
      : `.result-panel #place-${placeId} > a`;
    detailOpener.current = { element: opener, requestPath: path, replacement };
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("selected", id);
      next.set("place", path);
      return next;
    }, { preventScrollReset: true });
  };
  const closeDetail = () => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete("place");
    return next;
  }, { replace: true, preventScrollReset: true });
  const selectPin = (id: string, opener: HTMLButtonElement) => {
    if (window.matchMedia(PLACE_DETAIL_MOBILE_QUERY).matches) {
      const place = places.find((candidate) => candidate.id === id);
      const path = safePlaceDetailSearchPath(place?.slug ?? null);
      if (path) {
        openDetail(id, path, opener);
        return;
      }
    }
    setState("selected", id);
    document.getElementById(`place-${id}`)?.scrollIntoView({ behavior: "smooth" });
  };
  const locate = () => {
    if (pendingLocation) return;
    requestLocation((result) => {
      setLocationBounds(result.bbox);
      void setBounds(result.bbox);
      return result.notice
        ? `${result.notice} 광주 기본 지도로 이동했습니다.`
        : "현재 위치 주변으로 지도를 이동했습니다.";
    });
  };
  return (
    <main id="main" className="explore-page">
      <header className="explore-head shell">
        <div><p className="eyebrow">CATEGORY / {loaderData.categorySlug.toUpperCase()}</p><h1>{category?.emoji} {category?.name ?? "맛집"} 지도</h1></div>
        <Form action={`/maps/${encodeURIComponent(loaderData.categorySlug)}`} className="search-form"><label htmlFor="q">동네 또는 가게</label><input key={loaderData.state.query} id="q" name="q" defaultValue={loaderData.state.query} placeholder="동명동, 라멘…" /><input type="hidden" name="bbox" value={loaderData.state.bbox.join(",")} /><input type="hidden" name="view" value={loaderData.state.view} />{selected && <input type="hidden" name="selected" value={selected} />}<button>찾기</button></Form>
      </header>
      <nav className="view-tabs shell" aria-label="보기 방식"><Link to={{ search: viewSearch("map") }}>지도</Link><Link to={{ search: viewSearch("list") }}>목록</Link><button type="button" disabled={locating || Boolean(pendingLocation)} aria-busy={locating} onClick={locate}>{locating ? "위치 확인 중…" : "내 주변"}</button></nav>
      {locationNotice && <p className="shell" role="status" aria-live="polite">{locationNotice}</p>}
      <div className="shell mb-3 flex flex-wrap items-center gap-x-4">
        <p role="status" aria-live="polite" aria-atomic="true"><span className="result-count">{total} PLACES</span>{totalPages > 1 && start > 0 && ` · ${start}–${end}번째 표시`}</p>
        {totalPages > 1 && !outOfRange && <nav className="flex flex-wrap items-center gap-x-4" aria-label="장소 목록 페이지">
          {page > 1 ? <Link className="inline-flex min-h-11 items-center underline!" to={{ search: categoryPageSearch(params, page - 1) }}>이전 페이지</Link> : <span aria-disabled="true">이전 페이지</span>}
          <span aria-current="page">{page} / {totalPages} 페이지</span>
          {page < totalPages ? <Link className="inline-flex min-h-11 items-center underline!" to={{ search: categoryPageSearch(params, page + 1) }}>다음 페이지</Link> : <span aria-disabled="true">다음 페이지</span>}
        </nav>}
        {outOfRange && <p className="w-full">이 페이지에 표시할 장소가 없습니다. <Link className="inline-flex min-h-11 items-center underline!" to={{ search: categoryPageSearch(params, 1) }}>같은 조건의 첫 페이지로 돌아가기</Link></p>}
      </div>
      <div className="explore-split" data-view={loaderData.state.view}>
        <section className="map-panel" aria-label="지도 보기">
          <PlaceMap places={places} selected={selected} clientId={loaderData.clientId} deferBounds initialBounds={loaderData.state.bbox} locationBounds={locationBounds} onViewportIntent={clearLocation} onSelect={selectPin} onBounds={setBounds} onPendingBounds={setBounds} />
        </section>
        <section className="result-panel" aria-label="장소 목록">
          {places.map((place) => <PlaceCard place={place} selected={selected === place.id} key={place.id} onOpenDetail={(path, opener) => openDetail(place.id, path, opener)} />)}
          {!places.length && !outOfRange && <div className="empty" role="status"><p>이 범위에서 조건에 맞는 장소를 찾지 못했어요.</p>{outsideBounds && <button type="button" className="mt-3 min-h-[var(--control-height)] border border-current px-4" onClick={() => { clearLocation(); setLocationBounds(outsideBounds); void setBounds(outsideBounds); }}>전체 결과 {outsideResults.overallCount}곳 보기</button>}</div>}
        </section>
      </div>
      <PlaceDetailSheet detailPath={detailPath} opener={currentOpener?.element ?? null} replacementOpener={currentOpener?.replacement} fallbackFocus="#q" onClose={closeDetail} />
    </main>
  );
}
