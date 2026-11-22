import { env } from "cloudflare:workers";
import { Link, isRouteErrorResponse, useFetcher, useLocation, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/place-list";
import type { loader as recommendationLoader } from "./place-recommendations-resource";
import { PlaceCard, safePlaceDetailRequestPath, safePlaceDetailSearchPath } from "../components/places/PlaceCard";
import { PlaceDiscoveryRail } from "../components/places/PlaceDiscoveryRail";
import { PlaceDetailSheet } from "../components/places/PlaceDetailSheet";
import { PlaceRecommendationControls } from "../components/places/PlaceRecommendationControls";
import { PlaceSearchError, PlaceSearchForm } from "../components/places/PlaceSearchError";
import { createDb } from "../db/client.server";
import { getOptionalUser } from "../features/auth/session.server";
import { getGuestOnboardingFromRequest } from "../features/onboarding/guest-session.server";
import { getPlaceRecommendationPage } from "../features/places/place-recommendation.server";
import { toggleRecommendationSelection } from "../features/places/place-recommendation-options";
import { getPublicPlacePage, listPublicCategoryGroups } from "../features/places/place.server";
import { publicPlacePageHref } from "../features/places/public-place-pagination";
import { publicPlaceBrowseHref, readPublicPlaceBrowse } from "../features/places/public-place-browse";
import { useEffect, useRef, useState } from "react";
import { publicPageMeta, resolvePublicOrigin } from "../features/places/public-metadata";

export function meta({ loaderData }: Route.MetaArgs) {
  const page = loaderData?.pagination?.page ?? 1;
  const outOfRange = Boolean(loaderData?.pagination?.outOfRange);
  const search = new URLSearchParams(loaderData?.search ?? "");
  const filtered = ["q", "category", "badge", "bbox", "temp"].some(key => search.getAll(key).some(Boolean));
  return publicPageMeta({ title: `맛집 리스트${page > 1 ? ` · ${page}페이지` : ""} — Re:Taste`, description: "광주·전남·전북의 장소를 취향과 평가 근거로 찾아보세요.", path: "/places", origin: loaderData?.publicOrigin, noindex: Boolean(loaderData?.tempOnly || filtered || outOfRange), page: outOfRange ? 1 : page });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { state, filters, page } = readPublicPlaceBrowse(url.search);
  const { categorySlug, tempOnly } = filters;
  if (page === null) throw new Response("검색 페이지 번호를 확인해 주세요.", { status: 400, statusText: "INVALID_PAGE" });
  const [west, south, east, north] = state.bbox;
  const center = { latitude: (south + north) / 2, longitude: (west + east) / 2 };
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const user = await getOptionalUser(request);
  const guest = !user && env.ONBOARDING_ENABLED === "true"
    ? await getGuestOnboardingFromRequest(db, request, now)
    : null;
  const selectedBadges = url.searchParams.getAll("badge");
  const [pagination, groups, recommendations] = await Promise.all([
    getPublicPlacePage(db, filters, page),
    listPublicCategoryGroups(db),
    getPlaceRecommendationPage(db, {
      userId: user?.id,
      tasteBadgeIds: guest ? [...guest.foodBadgeIds, ...guest.styleBadgeIds] : [],
      categorySlug,
      bbox: state.bbox,
      center,
      selectedBadges,
      now,
    }),
  ]);
  const category = groups.flatMap((group) => group.children).find((child) => child.slug === categorySlug);
  return { places: pagination.places, pagination, recommendations, state, category: category ?? null, search: url.search, tempOnly, publicOrigin: resolvePublicOrigin(request.url, (env as Env & { APP_BASE_URL?: string }).APP_BASE_URL) };
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const location = useLocation();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return <PlaceSearchError search={location.search} status={status} />;
}

export default function PlaceList({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const navigation = useNavigation();
  const searchPending = navigation.state !== "idle" && navigation.location?.pathname === "/places"
    && (navigation.formMethod?.toLowerCase() === "get"
      || new URLSearchParams(navigation.location.search).get("page") !== params.get("page"));
  const previousPage = useRef(loaderData.pagination.page);
  useEffect(() => {
    if (previousPage.current !== loaderData.pagination.page) {
      document.getElementById("all-places")?.focus({ preventScroll: true });
      previousPage.current = loaderData.pagination.page;
    }
  }, [loaderData.pagination.page]);
  const recommendationFetcher = useFetcher<typeof recommendationLoader>();
  const [selectedBadges, setSelectedBadges] = useState(loaderData.recommendations.selectedBadges);
  const [recommendations, setRecommendations] = useState(loaderData.recommendations);
  const [limitReached, setLimitReached] = useState(false);
  useEffect(() => setRecommendations(loaderData.recommendations), [loaderData.recommendations]);
  useEffect(() => setSelectedBadges(loaderData.recommendations.selectedBadges), [loaderData.recommendations.selectedBadges]);
  useEffect(() => {
    if (recommendationFetcher.data?.ok) setRecommendations(recommendationFetcher.data.recommendations);
  }, [recommendationFetcher.data]);
  const detailPath = safePlaceDetailSearchPath(params.get("place"));
  const detailOpener = useRef<HTMLAnchorElement>(null);
  const selected = loaderData.places.find((place) => place.id === loaderData.state.selected)?.id;
  const openDetail = (requestPath: string, opener: HTMLAnchorElement, placeId?: string) => {
    const safeRequestPath = safePlaceDetailRequestPath(requestPath);
    if (!safeRequestPath) return;
    detailOpener.current = opener;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("place", safeRequestPath);
      if (placeId) next.set("selected", placeId);
      return next;
    }, { preventScrollReset: true });
  };
  const closeDetail = () => setParams((current) => { const next = new URLSearchParams(current); next.delete("place"); return next; }, { replace: true, preventScrollReset: true });
  const categoryName = loaderData.category ? `${loaderData.category.emoji} ${loaderData.category.name}` : "모든 카테고리";
  const searchIsFiltered = selectedBadges.length > 0 || ["q", "category", "bbox", "badge", "page", "selected"].some((key) => params.has(key));
  const resetSearch = new URLSearchParams();
  if (loaderData.tempOnly) resetSearch.set("temp", "1");
  if (params.has("qa")) resetSearch.set("qa", "1");
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
        <p>광주·전남·전북의 장소를 취향, 평가 신뢰도, 리뷰어 선택으로 찾아볼 수 있습니다. 임시 정보는 TEMP로 표시합니다.</p>
        <Link to={loaderData.tempOnly ? "/places" : "/places?temp=1"}>{loaderData.tempOnly ? "전체 장소 보기" : "TEMP 100 베타 목록"}</Link>
      </div>
      <Link className="discovery-map-link" to={publicPlaceBrowseHref("map", loaderData.search, { selected, badges: selectedBadges })}>지도에서 보기</Link>
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
        <div><p className="eyebrow">ALL PLACES</p><h2 id="all-places" tabIndex={-1}>{loaderData.tempOnly ? "TEMP 베타 전체 장소" : "전체 장소"}</h2></div>
        <p>공식 출처 기반 임시 정보는 TEMP로 구분하며 현재 영업 여부는 확인 중입니다.</p>
      </header>
      <PlaceSearchForm context={{ query: loaderData.state.query, categorySlug: loaderData.category?.slug ?? "", bbox: loaderData.state.bbox, tempOnly: loaderData.tempOnly, badges: selectedBadges }} pending={searchPending} />
      {searchIsFiltered && <Link className="inline-flex min-h-11 items-center underline!" to={`${publicPlaceBrowseHref("list", resetSearch.toString())}#all-places`}>검색 조건 초기화</Link>}
      <p id="place-search-status" className="discovery-count" role="status" aria-live="polite" aria-atomic="true">{searchPending ? "장소를 찾고 있어요. 검색이 끝날 때까지 기존 결과를 표시합니다." : `전체 ${loaderData.pagination.total}곳${loaderData.pagination.start ? ` · ${loaderData.pagination.start}–${loaderData.pagination.end}번째 표시` : ""} · ${categoryName}`}</p>
      <div className="place-grid discovery-grid" aria-busy={searchPending}>{loaderData.places.map((place) => <PlaceCard place={place} key={place.id} selected={selected === place.id} onOpenDetail={(path, opener) => openDetail(path, opener, place.id)} />)}</div>
      {!loaderData.places.length && (loaderData.pagination.outOfRange
        ? <p className="discovery-empty">이 페이지에 표시할 장소가 없습니다. <Link className="underline!" to={`${publicPlacePageHref(loaderData.search, 1)}#all-places`}>같은 조건의 첫 페이지로 돌아가기</Link></p>
        : <p className="discovery-empty">이 조건에서 공개된 장소를 찾지 못했어요. 검색어를 줄이거나 지도 범위를 넓혀보세요.</p>)}
      {loaderData.pagination.totalPages > 1 && !loaderData.pagination.outOfRange && <nav className="flex flex-wrap items-center gap-4" aria-label="장소 목록 페이지">
        {loaderData.pagination.page > 1 ? <Link className="inline-flex min-h-11 items-center underline!" to={`${publicPlacePageHref(loaderData.search, loaderData.pagination.page - 1)}#all-places`}>이전 페이지</Link> : <span aria-disabled="true">이전 페이지</span>}
        <span aria-current="page">{loaderData.pagination.page} / {loaderData.pagination.totalPages} 페이지</span>
        {loaderData.pagination.page < loaderData.pagination.totalPages ? <Link className="inline-flex min-h-11 items-center underline!" to={`${publicPlacePageHref(loaderData.search, loaderData.pagination.page + 1)}#all-places`}>다음 페이지</Link> : <span aria-disabled="true">다음 페이지</span>}
      </nav>}
    </section>
    <PlaceDetailSheet detailPath={detailPath} opener={detailOpener.current} fallbackFocus="#all-places" onClose={closeDetail} />
  </main>;
}
