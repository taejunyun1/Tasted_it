import { env } from "cloudflare:workers";
import { Form, Link, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/place-list";
import type { loader as recommendationLoader } from "./place-recommendations-resource";
import { PlaceCard } from "../components/places/PlaceCard";
import { PlaceDiscoveryRail } from "../components/places/PlaceDiscoveryRail";
import { PlaceDetailSheet } from "../components/places/PlaceDetailSheet";
import { PlaceRecommendationControls } from "../components/places/PlaceRecommendationControls";
import { createDb } from "../db/client.server";
import { getOptionalUser } from "../features/auth/session.server";
import { parseMapState } from "../features/maps/map-state";
import { getPlaceRecommendationPage } from "../features/places/place-recommendation.server";
import { toggleRecommendationSelection } from "../features/places/place-recommendation-options";
import { listPlaces, listPublicCategoryGroups } from "../features/places/place.server";
import { useEffect, useState } from "react";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const state = parseMapState(url.search);
  const categorySlug = url.searchParams.get("category") || undefined;
  const [west, south, east, north] = state.bbox;
  const center = { latitude: (south + north) / 2, longitude: (west + east) / 2 };
  const db = createDb(env.DB);
  const user = await getOptionalUser(request);
  const selectedBadges = url.searchParams.getAll("badge");
  const [places, groups, recommendations] = await Promise.all([
    listPlaces(db, { categorySlug, query: state.query, bbox: state.bbox }),
    listPublicCategoryGroups(db),
    getPlaceRecommendationPage(db, { userId: user?.id, categorySlug, bbox: state.bbox, center, selectedBadges, now: new Date().toISOString() }),
  ]);
  const category = groups.flatMap((group) => group.children).find((child) => child.slug === categorySlug);
  return { places, recommendations, state, category: category ?? null, search: url.search };
}

export default function PlaceList({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const recommendationFetcher = useFetcher<typeof recommendationLoader>();
  const [selectedBadges, setSelectedBadges] = useState(loaderData.recommendations.selectedBadges);
  const [recommendations, setRecommendations] = useState(loaderData.recommendations);
  const [limitReached, setLimitReached] = useState(false);
  useEffect(() => setRecommendations(loaderData.recommendations), [loaderData.recommendations]);
  useEffect(() => setSelectedBadges(loaderData.recommendations.selectedBadges), [loaderData.recommendations.selectedBadges]);
  useEffect(() => {
    if (recommendationFetcher.data?.ok) setRecommendations(recommendationFetcher.data.recommendations);
  }, [recommendationFetcher.data]);
  const detailSlug = params.get("place");
  const openDetail = (slug: string) => setParams((current) => { const next = new URLSearchParams(current); next.set("place", slug); return next; });
  const closeDetail = () => setParams((current) => { const next = new URLSearchParams(current); next.delete("place"); return next; }, { replace: true });
  const categoryName = loaderData.category ? `${loaderData.category.emoji} ${loaderData.category.name}` : "모든 카테고리";
  const recommendationError = recommendationFetcher.data && !recommendationFetcher.data.ok
    ? recommendationFetcher.data.message : null;
  const toggleBadge = (id: string) => {
    const next = toggleRecommendationSelection(selectedBadges, id);
    setLimitReached(next.limitReached);
    if (next.limitReached) return;
    setSelectedBadges(next.selected);
    const search = new URLSearchParams();
    next.selected.forEach((badge) => search.append("badge", badge));
    search.set("bbox", loaderData.state.bbox.join(","));
    if (loaderData.category) search.set("category", loaderData.category.slug);
    recommendationFetcher.load(`/resources/place-recommendations?${search}`);
  };
  return <main id="main" className="shell discovery-page">
    <header className="discovery-hero">
      <div>
        <p className="eyebrow">PLACES / DISCOVERY</p>
        <h1>좋아하는 맛과<br />낯선 한 끼 사이.</h1>
        <p>광주·전남의 검수된 장소를 취향, 평가 신뢰도, 리뷰어 선택으로 다시 엮었습니다.</p>
      </div>
      <Link className="discovery-map-link" to={`/${loaderData.search}`}>지도에서 보기</Link>
    </header>

    <PlaceRecommendationControls
      chips={loaderData.recommendations.chips}
      selected={selectedBadges}
      limitReached={limitReached}
      pending={recommendationFetcher.state !== "idle"}
      onToggle={toggleBadge}
    />
    {recommendationError && <p className="discovery-resource-error" role="status">{recommendationError}</p>}

    <section className="discovery-recommendations" aria-live="polite" aria-busy={recommendationFetcher.state !== "idle"}>
      <header className="discovery-recommendations__title"><p className="eyebrow">FOR YOUR MOMENT</p><h2>{recommendations.title}</h2></header>
      <PlaceDiscoveryRail title="취향과 새로운 발견" description="익숙한 취향 네 곳, 이어지는 맛 두 곳, 평소와 다른 선택 두 곳을 섞었습니다." places={recommendations.personal} kind="personal" onOpenDetail={openDetail} />
      <PlaceDiscoveryRail title="Re:Taste 추천" description="높은 추천률보다 충분한 평가와 회원·리뷰어의 의견 일치를 먼저 봅니다." places={recommendations.trusted} kind="trusted" onOpenDetail={openDetail} />
      <PlaceDiscoveryRail title="Golden Pick 취향 릴레이" description="서로 다른 리뷰어와 메뉴의 선택을 이어봅니다." places={recommendations.golden} kind="golden" onOpenDetail={openDetail} />
    </section>

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
      <div className="place-grid discovery-grid">{loaderData.places.map((place) => <PlaceCard place={place} key={place.id} onOpenDetail={openDetail} />)}</div>
      {!loaderData.places.length && <p className="discovery-empty">이 조건에서 공개된 장소를 찾지 못했어요. 검색어를 줄이거나 지도 범위를 넓혀보세요.</p>}
    </section>
    <PlaceDetailSheet slug={detailSlug} onClose={closeDetail} />
  </main>;
}
