import { env } from "cloudflare:workers";
import { Form, Link } from "react-router";
import type { Route } from "./+types/place-list";
import { PlaceCard } from "../components/places/PlaceCard";
import { PlaceDiscoveryRail } from "../components/places/PlaceDiscoveryRail";
import { createDb } from "../db/client.server";
import { parseMapState } from "../features/maps/map-state";
import { getPlaceDiscovery } from "../features/places/place-discovery.server";
import { listPlaces, listPublicCategoryGroups } from "../features/places/place.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const state = parseMapState(url.search);
  const categorySlug = url.searchParams.get("category") || undefined;
  const [west, south, east, north] = state.bbox;
  const center = { latitude: (south + north) / 2, longitude: (west + east) / 2 };
  const db = createDb(env.DB);
  const [places, groups, discovery] = await Promise.all([
    listPlaces(db, { categorySlug, query: state.query, bbox: state.bbox }),
    listPublicCategoryGroups(db),
    getPlaceDiscovery(db, { categorySlug, bbox: state.bbox, center, now: new Date().toISOString() }),
  ]);
  const category = groups.flatMap((group) => group.children).find((child) => child.slug === categorySlug);
  return { places, discovery, state, category: category ?? null, search: url.search };
}

export default function PlaceList({ loaderData }: Route.ComponentProps) {
  const categoryName = loaderData.category ? `${loaderData.category.emoji} ${loaderData.category.name}` : "모든 카테고리";
  return <main id="main" className="shell discovery-page">
    <header className="discovery-hero">
      <div>
        <p className="eyebrow">PLACES / DISCOVERY</p>
        <h1>오늘의 한 끼를<br />먼저 골라봤어요</h1>
        <p>현재 지도 범위와 Re:Taste 평가를 바탕으로 구성했습니다.</p>
      </div>
      <Link className="discovery-map-link" to={`/${loaderData.search}`}>지도에서 보기</Link>
    </header>

    <PlaceDiscoveryRail title="내 주변 추천" description={`${categoryName} · 현재 지도 중심에서 가까운 순`} places={loaderData.discovery.nearby} kind="nearby" />
    <PlaceDiscoveryRail title="Re:Taste 추천" description="8표 이상 평가된 장소 중 추천 점수와 표본을 함께 봅니다." places={loaderData.discovery.service} kind="service" />
    <PlaceDiscoveryRail title="최근 Golden Pick" description="활동 중인 리뷰어가 최근에 직접 고른 장소입니다." places={loaderData.discovery.golden} kind="golden" />

    <section className="discovery-section discovery-all" aria-labelledby="all-places">
      <header className="discovery-heading">
        <div><p className="eyebrow">ALL PLACES</p><h2 id="all-places">전체 장소</h2></div>
        <p>검수 승인된 영업 장소만 표시합니다.</p>
      </header>
      <Form action="/places" className="discovery-search">
        <label htmlFor="place-query">장소 검색</label>
        <input id="place-query" name="q" defaultValue={loaderData.state.query} placeholder="장소 이름이나 주소 검색" />
        <input type="hidden" name="category" value={loaderData.category?.slug ?? ""} />
        <input type="hidden" name="bbox" value={loaderData.state.bbox.join(",")} />
        <button>찾기</button>
      </Form>
      <p className="discovery-count">{loaderData.places.length} PLACES · {categoryName}</p>
      <div className="place-grid discovery-grid">{loaderData.places.map((place) => <PlaceCard place={place} key={place.id} />)}</div>
      {!loaderData.places.length && <p className="discovery-empty">이 조건에서 공개된 장소를 찾지 못했어요. 검색어를 줄이거나 지도 범위를 넓혀보세요.</p>}
    </section>
  </main>;
}
