import { env } from "cloudflare:workers";
import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/map-category";
import { createDb } from "../db/client.server";
import { parseMapState } from "../features/maps/map-state";
import { listPlaces } from "../features/places/place.server";
import { PlaceMap } from "../components/map/PlaceMap";
import { PlaceCard } from "../components/places/PlaceCard";

export async function loader({ request, params }: Route.LoaderArgs) {
  const state = parseMapState(new URL(request.url).search);
  const places = await listPlaces(createDb(env.DB), { categorySlug: params.categorySlug, query: state.query, bbox: state.bbox });
  const clientId = (env as Env & { NAVER_MAPS_CLIENT_ID?: string }).NAVER_MAPS_CLIENT_ID ?? "";
  return { places, state, categorySlug: params.categorySlug, clientId };
}

export default function CategoryMap({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const setState = (key: string, value: string) => setParams((current) => { current.set(key, value); return current; }, { replace: true });
  const selected = loaderData.state.selected;
  return (
    <main id="main" className="explore-page">
      <header className="explore-head shell">
        <div><p className="eyebrow">CATEGORY / {loaderData.categorySlug.toUpperCase()}</p><h1>{loaderData.places[0]?.primaryCategory.emoji} {loaderData.places[0]?.primaryCategory.name ?? "맛집"} 지도</h1></div>
        <Form className="search-form"><label htmlFor="q">동네 또는 가게</label><input id="q" name="q" defaultValue={loaderData.state.query} placeholder="동명동, 라멘…" /><button>찾기</button></Form>
      </header>
      <nav className="view-tabs shell" aria-label="보기 방식"><Link to="?view=map">지도</Link><Link to="?view=list">목록</Link><button type="button" onClick={() => navigator.geolocation.getCurrentPosition(() => undefined)}>내 주변</button></nav>
      <div className="explore-split" data-view={loaderData.state.view}>
        <section className="map-panel" aria-label="지도 보기">
          <PlaceMap places={loaderData.places} selected={selected} clientId={loaderData.clientId} initialBounds={params.has("bbox") ? loaderData.state.bbox : undefined} onSelect={(id) => { setState("selected", id); document.getElementById(`place-${id}`)?.scrollIntoView({ behavior: "smooth" }); }} onBounds={(bbox) => setState("bbox", bbox.map((n) => n.toFixed(5)).join(","))} />
        </section>
        <section className="result-panel" aria-label="장소 목록">
          <p className="result-count">{loaderData.places.length} PLACES</p>
          {loaderData.places.map((place) => <PlaceCard place={place} selected={selected === place.id} key={place.id} />)}
          {!loaderData.places.length && <p className="empty">이 범위에서 등록된 장소를 찾지 못했어요.</p>}
        </section>
      </div>
    </main>
  );
}
