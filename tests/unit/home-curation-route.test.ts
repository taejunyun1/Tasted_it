import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeCurationPage } from "../../app/features/places/home-curation";
import {
  readHomeRecommendationHistory,
  recordHomeRecommendation,
} from "../../app/features/places/home-curation-history.client";

const mocks = vi.hoisted(() => ({
  env: { DB: {}, ONBOARDING_ENABLED: "true", NAVER_MAPS_CLIENT_ID: "map-client" },
  getOptionalUser: vi.fn(async (): Promise<{ id: string; role?: string } | null> => null),
  getGuestOnboardingFromRequest: vi.fn(async (): Promise<{
    foodBadgeIds: string[];
    styleBadgeIds: string[];
  } | null> => null),
  getHomeCurationPage: vi.fn(async () => ({
    status: "READY",
    places: [],
    mode: "now",
    timeSlot: "lunch",
    radiusMeters: 3_000,
  })),
  listPlaces: vi.fn(async () => []),
  listPublicCategoryGroups: vi.fn(async () => []),
  getPublicPlaceCounts: vi.fn(async () => ({ count: 0, overallCount: 0, overallBounds: null })),
}));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } as Storage;
}

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("../../app/db/client.server", () => ({ createDb: () => ({}) }));
vi.mock("../../app/features/auth/session.server", () => ({ getOptionalUser: mocks.getOptionalUser, readSessionId: () => null }));
vi.mock("../../app/features/onboarding/guest-session.server", () => ({
  getGuestOnboardingFromRequest: mocks.getGuestOnboardingFromRequest,
  readGuestSessionId: () => null,
}));
vi.mock("../../app/features/places/home-curation.server", () => ({
  getHomeCurationPage: mocks.getHomeCurationPage,
}));
vi.mock("../../app/features/places/place.server", () => ({
  listPlaces: mocks.listPlaces,
  listPublicCategoryGroups: mocks.listPublicCategoryGroups,
  getPublicPlaceCounts: mocks.getPublicPlaceCounts,
}));

afterEach(() => {
  mocks.getOptionalUser.mockReset();
  mocks.getOptionalUser.mockResolvedValue(null);
  mocks.getGuestOnboardingFromRequest.mockReset();
  mocks.getGuestOnboardingFromRequest.mockResolvedValue(null);
  mocks.getHomeCurationPage.mockClear();
  mocks.listPlaces.mockClear();
  mocks.listPublicCategoryGroups.mockClear();
  mocks.getPublicPlaceCounts.mockClear();
});

describe("home curated route", () => {
  it("기본 진입은 전체 장소 대신 게스트 취향을 적용한 큐레이션을 불러온다", async () => {
    mocks.getGuestOnboardingFromRequest.mockResolvedValue({
      foodBadgeIds: ["food-gukbap"],
      styleBadgeIds: ["style-local"],
    });
    const { loader } = await import("../../app/routes/home");
    const result = await loader({ request: new Request("https://retaste.example/") } as never);

    expect(result.view).toBe("curated");
    expect(mocks.getHomeCurationPage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      mode: "now",
      tasteBadgeIds: ["food-gukbap", "style-local"],
    }));
    expect(mocks.listPlaces).not.toHaveBeenCalled();
  });

  it("초기 큐레이션 loader가 URL의 위치 출처를 추천 이유 계산에 전달한다", async () => {
    const { loader } = await import("../../app/routes/home");
    await loader({
      request: new Request("https://retaste.example/?locationSource=gps"),
    } as never);

    expect(mocks.getHomeCurationPage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      locationSource: "gps",
    }));
  });

  it("QA 요청은 등록된 네이버 Client ID 대신 결정적인 간이 지도를 사용한다", async () => {
    const { loader } = await import("../../app/routes/home");
    const result = await loader({
      request: new Request("https://retaste.example/?qa=1"),
    } as never);

    expect(result.qaMode).toBe(true);
    expect(result.clientId).toBe("");
  });

  it("명시적 전체보기는 기존 장소·카테고리 탐색을 유지한다", async () => {
    const { loader } = await import("../../app/routes/home");
    const result = await loader({ request: new Request("https://retaste.example/?view=browse&q=국밥") } as never);

    expect(result.view).toBe("browse");
    expect(mocks.listPlaces).toHaveBeenCalled();
    expect(mocks.listPublicCategoryGroups).toHaveBeenCalled();
    expect(mocks.listPublicCategoryGroups).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ query: "국밥", bbox: expect.any(Array) }));
    expect(mocks.getPublicPlaceCounts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ query: "국밥", bbox: expect.any(Array) }));
    expect(mocks.getHomeCurationPage).not.toHaveBeenCalled();
  });

  it("큐레이션 내부 모드·선택 변경만 loader 재검증을 생략한다", async () => {
    const { shouldRevalidate } = await import("../../app/routes/home");

    expect(shouldRevalidate({
      currentUrl: new URL("https://retaste.example/?mode=now"),
      nextUrl: new URL("https://retaste.example/?mode=taste&selected=p1"),
      defaultShouldRevalidate: true,
    } as never)).toBe(false);
    expect(shouldRevalidate({
      currentUrl: new URL("https://retaste.example/?mode=now"),
      nextUrl: new URL("https://retaste.example/?view=browse"),
      defaultShouldRevalidate: true,
    } as never)).toBe(true);
    expect(shouldRevalidate({
      currentUrl: new URL("https://retaste.example/?mode=now"),
      nextUrl: new URL("https://retaste.example/?mode=taste"),
      formMethod: "POST",
      defaultShouldRevalidate: true,
    } as never)).toBe(true);
    expect(shouldRevalidate({
      currentUrl: new URL("https://retaste.example/?mode=now"),
      nextUrl: new URL("https://retaste.example/?mode=now"),
      defaultShouldRevalidate: true,
    } as never)).toBe(true);
  });

  it("리소스 fetcher·대기 bbox·번호 마커·전체보기 복귀 동작을 연결한다", () => {
    const source = readFileSync("app/routes/home.tsx", "utf8");

    expect(source).toContain('import type { loader as homeRecommendationLoader } from "./home-recommendations-resource"');
    expect(source).toContain("useFetcher<typeof homeRecommendationLoader>");
    expect(source).toContain("/resources/home-recommendations");
    expect(source).toContain("onPendingBounds={setPendingBounds}");
    expect(source).toContain("이 지역 다시 추천");
    expect(source).toContain("markerRanks={markerRanks}");
    expect(source).toContain("추천 지도");
    expect(source).toContain('className="home-curation-view-toggle"');
    expect(source).toContain('isCurated ? "전체 지도" : "추천 지도"');
    expect(source).toContain("isCurated ? browseAll : returnToCuration");
    expect(source.match(/home-curation-view-toggle/g)).toHaveLength(1);
  });

  it("사용자 추천 요청 URL에 세션 이력과 위치 출처를 넣는다", async () => {
    const values = new Map<string, string>([["retaste:home-curation-v2", JSON.stringify({
      sessionSeed: "session-1",
      recentFirst: ["p1"],
      recentShown: [{ placeId: "p1", count: 1 }],
      previousMode: "now",
      previousIds: ["p1"],
    })]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage;
    const { buildRecommendationUrl } = await import("../../app/routes/home");

    const url = new URL(buildRecommendationUrl(
      "taste",
      [126.8, 35, 127, 35.3],
      "gps",
      "request-token-01",
      storage,
    ), "https://retaste.example");

    expect(url.pathname).toBe("/resources/home-recommendations");
    expect(url.searchParams.get("mode")).toBe("taste");
    expect(url.searchParams.get("bbox")).toBe("126.8,35,127,35.3");
    expect(url.searchParams.get("locationSource")).toBe("gps");
    expect(url.searchParams.get("requestToken")).toBe("request-token-01");
    expect(url.searchParams.get("history")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("내 위치에서 전체 지도로 간 뒤 지도 이동을 확정하면 추천 지도 출처를 map_center로 유지한다", async () => {
    const { parseHomeCurationState } = await import("../../app/features/maps/home-curation-options");
    const { updateMapSearch } = await import("../../app/features/maps/map-selection");
    let params = updateMapSearch(new URLSearchParams(), {
      bbox: "126.85,35.12,126.9,35.16",
      locationSource: "gps",
    });
    params.set("view", "browse");
    expect(parseHomeCurationState(`?${params}`).locationSource).toBe("gps");

    params = updateMapSearch(params, {
      bbox: "126.8,35.1,126.88,35.18",
      locationSource: "map_center",
    });
    params.delete("view");

    expect(parseHomeCurationState(`?${params}`)).toEqual(expect.objectContaining({
      view: "curated",
      locationSource: "map_center",
    }));
  });

  it("새 loader 결과는 pending bounds와 진행 중 추천 요청 수명주기를 함께 폐기한다", async () => {
    const { clearHomeRecommendationRequestLifecycle } = await import("../../app/routes/home");
    const pendingRequestKeyRef = { current: "request-token-A" };
    const pendingRequestRouteKeyRef = { current: "route-A" };
    const startedRequestKeyRef = { current: "request-token-A" };

    clearHomeRecommendationRequestLifecycle({
      pendingRequestKeyRef,
      pendingRequestRouteKeyRef,
      startedRequestKeyRef,
    });

    expect({
      pendingRequestKey: pendingRequestKeyRef.current,
      pendingRequestRouteKey: pendingRequestRouteKeyRef.current,
      startedRequestKey: startedRequestKeyRef.current,
    }).toEqual({
      pendingRequestKey: null,
      pendingRequestRouteKey: null,
      startedRequestKey: null,
    });

    const source = readFileSync("app/routes/home.tsx", "utf8");

    expect(source).toMatch(/const browseAll = \(\) => \{\s*setPendingBounds\(null\)/);
    expect(source).toMatch(/const returnToCuration = \(\) => \{\s*setPendingBounds\(null\)/);
    expect(source).toMatch(/useEffect\(\(\) => \{[\s\S]*?setPendingBounds\(null\);[\s\S]*?clearHomeRecommendationRequestLifecycle\([\s\S]*?\);[\s\S]*?\}, \[loaderData\.curation, loaderData\.view\]\)/);
  });

  it("완료된 v2 정상 응답만 요청별 한 번 기록 대상으로 고른다", async () => {
    const {
      getRecordableHomeRecommendation,
      isCurrentHomeRecommendationResponse,
    } = await import("../../app/routes/home");
    const page = {
      algorithmVersion: "home-curation-v2",
      status: "READY",
      places: [],
      mode: "now",
      timeSlot: "lunch",
      radiusMeters: 3_000,
      candidateCount: 0,
      goldenFallback: false,
      notice: null,
    } as const;
    const response = { ok: true as const, requestToken: "request-token-01", recommendations: page };
    const routeKey = "curated|now|126.80000,35.00000,127.00000,35.30000|map_center";

    expect(isCurrentHomeRecommendationResponse(
      "idle",
      response,
      "request-token-01",
      "request-token-01",
      routeKey,
      routeKey,
    )).toBe(true);
    expect(isCurrentHomeRecommendationResponse(
      "idle",
      { ok: false, requestToken: "request-token-stale", message: "stale" },
      "request-token-01",
      "request-token-01",
      routeKey,
      routeKey,
    )).toBe(false);

    expect(getRecordableHomeRecommendation("idle", response, "request-token-01", "request-token-01", null, routeKey, routeKey))
      .toEqual({ requestKey: "request-token-01", page });
    const emptyPage = { ...page, status: "EMPTY" as const };
    expect(getRecordableHomeRecommendation("idle", {
      ok: true,
      requestToken: "request-token-02",
      recommendations: emptyPage,
    }, "request-token-02", "request-token-02", null, routeKey, routeKey)).toEqual({ requestKey: "request-token-02", page: emptyPage });
    expect(getRecordableHomeRecommendation("loading", response, "request-token-01", "request-token-01", null, routeKey, routeKey)).toBeNull();
    expect(getRecordableHomeRecommendation("idle", response, "request-token-01", "request-token-01", "request-token-01", routeKey, routeKey)).toBeNull();
    expect(getRecordableHomeRecommendation("idle", { ok: false }, "request-token-01", "request-token-01", null, routeKey, routeKey)).toBeNull();
    expect(getRecordableHomeRecommendation("idle", {
      ok: true,
      requestToken: "request-token-01",
      recommendations: { ...page, algorithmVersion: "home-curation-v1" },
    }, "request-token-01", "request-token-01", null, routeKey, routeKey)).toBeNull();
    expect(getRecordableHomeRecommendation("idle", {
      ok: true,
      requestToken: "request-token-01",
      recommendations: { ...page, status: "ERROR" },
    }, "request-token-01", "request-token-01", null, routeKey, routeKey)).toBeNull();
    expect(getRecordableHomeRecommendation("idle", {
      ok: true,
      requestToken: "request-token-stale",
      recommendations: page,
    }, "request-token-01", "request-token-01", null, routeKey, routeKey)).toBeNull();
  });

  it("지연된 A 응답은 URL·loader가 B로 이동한 뒤 결과나 이력 기록 대상으로 수락하지 않는다", async () => {
    const {
      getHomeRecommendationRouteKey,
      getRecordableHomeRecommendation,
    } = await import("../../app/routes/home");
    const delayedPageA = {
      algorithmVersion: "home-curation-v2",
      status: "READY",
      places: [],
      mode: "taste",
      timeSlot: "lunch",
      radiusMeters: 3_000,
      candidateCount: 0,
      goldenFallback: false,
      notice: null,
    } as const;
    const requestRouteA = getHomeRecommendationRouteKey({
      view: "curated",
      mode: "taste",
      bbox: [126.8, 35, 127, 35.3],
      locationSource: "gps",
    });
    const currentRouteB = getHomeRecommendationRouteKey({
      view: "browse",
      mode: "now",
      bbox: [126.7, 35.1, 126.9, 35.4],
      locationSource: "map_center",
    });

    expect(getRecordableHomeRecommendation(
      "idle",
      { ok: true, requestToken: "request-token-A", recommendations: delayedPageA },
      "request-A",
      "request-A",
      null,
      requestRouteA,
      currentRouteB,
    )).toBeNull();
  });

  it("idle의 retained 성공 A는 B가 loading 되기 전에 B 응답으로 기록하지 않는다", async () => {
    const {
      beginHomeRecommendationRequest,
      getRecordableHomeRecommendation,
    } = await import("../../app/routes/home");
    const retainedPageA = {
      algorithmVersion: "home-curation-v2",
      status: "READY",
      places: [],
      mode: "now",
      timeSlot: "lunch",
      radiusMeters: 3_000,
      candidateCount: 0,
      goldenFallback: false,
      notice: null,
    } as const;

    const lifecycle = beginHomeRecommendationRequest("idle", "request-B");

    expect(lifecycle).toEqual({
      pendingRequestKey: "request-B",
      startedRequestKey: null,
    });
    expect(getRecordableHomeRecommendation(
      "idle",
      { ok: true, requestToken: "request-token-A", recommendations: retainedPageA },
      lifecycle.pendingRequestKey,
      lifecycle.startedRequestKey,
      "request-A",
      "route-B",
      "route-B",
    )).toBeNull();
  });

  it("loading 중 A를 B로 교체하면 같은 fetcher의 최신 B 완료를 B 요청에 연결한다", async () => {
    const {
      beginHomeRecommendationRequest,
      getRecordableHomeRecommendation,
    } = await import("../../app/routes/home");
    const pageB = {
      algorithmVersion: "home-curation-v2",
      status: "EMPTY",
      places: [],
      mode: "taste",
      timeSlot: "lunch",
      radiusMeters: 3_000,
      candidateCount: 0,
      goldenFallback: false,
      notice: null,
    } as const;

    const lifecycle = beginHomeRecommendationRequest("loading", "request-B");

    expect(lifecycle).toEqual({
      pendingRequestKey: "request-B",
      startedRequestKey: "request-B",
    });
    expect(getRecordableHomeRecommendation(
      "idle",
      { ok: true, requestToken: "request-B", recommendations: pageB },
      lifecycle.pendingRequestKey,
      lifecycle.startedRequestKey,
      "request-A",
      "route-B",
      "route-B",
    )).toEqual({ requestKey: "request-B", page: pageB });
  });

  it.each([
    {
      label: "늦은 A 성공",
      lateResponse: {
        ok: true,
        requestToken: "request-token-A",
        recommendations: {
          algorithmVersion: "home-curation-v2",
          status: "READY",
          places: [{ id: "place-A" }],
          mode: "taste",
          timeSlot: "lunch",
          radiusMeters: 3_000,
          candidateCount: 1,
          goldenFallback: false,
          notice: null,
        },
      },
    },
    {
      label: "늦은 A 503",
      lateResponse: {
        ok: false,
        requestToken: "request-token-A",
        message: "추천을 다시 불러오지 못했어요. 기존 결과를 유지합니다.",
      },
    },
  ])("B 성공 뒤 $label 응답은 B 화면·세션 이력·오류 상태를 바꾸지 않는다", async ({ lateResponse }) => {
    const {
      beginHomeRecommendationRequest,
      clearHomeRecommendationRequestLifecycle,
      getRecordableHomeRecommendation,
      isCurrentHomeRecommendationResponse,
    } = await import("../../app/routes/home");
    const initialPage = {
      algorithmVersion: "home-curation-v2",
      status: "READY",
      places: [{ id: "place-initial" }],
      mode: "now",
      timeSlot: "lunch",
      radiusMeters: 3_000,
      candidateCount: 1,
      goldenFallback: false,
      notice: null,
    } as unknown as HomeCurationPage;
    const pageB = {
      ...initialPage,
      places: [{ id: "place-B" }],
      mode: "time",
    } as HomeCurationPage;
    const routeB = "curated|time|126.85000,35.12700,126.90000,35.16300|gps";
    const lifecycleB = beginHomeRecommendationRequest("loading", "request-token-B");
    const pendingRequestKeyRef = { current: lifecycleB.pendingRequestKey };
    const pendingRequestRouteKeyRef = { current: routeB as string | null };
    const startedRequestKeyRef = { current: lifecycleB.startedRequestKey };
    const storage = memoryStorage();
    let displayed = initialPage;
    let currentError: string | null = null;
    // Keep B's lifecycle active and omit the duplicate-record guard so the
    // immutable response token is the only identity boundary exercised here.
    const deliveryOrder: string[] = [];
    const deliver = (label: "A" | "B", response: unknown) => {
      deliveryOrder.push(label);
      const isCurrent = isCurrentHomeRecommendationResponse(
        "idle",
        response,
        pendingRequestKeyRef.current,
        startedRequestKeyRef.current,
        pendingRequestRouteKeyRef.current,
        routeB,
      );
      currentError = isCurrent
        && response.ok === false
        && "message" in response
        && typeof response.message === "string"
        ? response.message
        : null;
      const completed = getRecordableHomeRecommendation(
        "idle",
        response,
        pendingRequestKeyRef.current,
        startedRequestKeyRef.current,
        null,
        pendingRequestRouteKeyRef.current,
        routeB,
      );
      if (!completed) return;
      displayed = completed.page;
      recordHomeRecommendation(storage, completed.page);
    };
    let releaseA: (() => void) | undefined;
    const delayedA = new Promise<void>((resolve) => {
      releaseA = resolve;
    }).then(() => deliver("A", lateResponse));

    deliver("B", {
      ok: true,
      requestToken: "request-token-B",
      recommendations: pageB,
    });
    expect(displayed.places[0]?.id).toBe("place-B");
    expect(readHomeRecommendationHistory(storage)).toEqual(expect.objectContaining({
      previousMode: "time",
      previousIds: ["place-B"],
    }));
    expect(currentError).toBeNull();
    expect({
      pendingRequestKey: pendingRequestKeyRef.current,
      pendingRequestRouteKey: pendingRequestRouteKeyRef.current,
      startedRequestKey: startedRequestKeyRef.current,
    }).toEqual({
      pendingRequestKey: "request-token-B",
      pendingRequestRouteKey: routeB,
      startedRequestKey: "request-token-B",
    });

    releaseA?.();
    await delayedA;

    expect(deliveryOrder).toEqual(["B", "A"]);
    expect(displayed.places[0]?.id).toBe("place-B");
    expect(displayed.mode).toBe("time");
    expect(readHomeRecommendationHistory(storage)).toEqual(expect.objectContaining({
      recentFirst: ["place-B"],
      recentShown: [{ placeId: "place-B", count: 1 }],
      previousMode: "time",
      previousIds: ["place-B"],
    }));
    expect(currentError).toBeNull();

    clearHomeRecommendationRequestLifecycle({
      pendingRequestKeyRef,
      pendingRequestRouteKeyRef,
      startedRequestKeyRef,
    });
    expect({
      pendingRequestKey: pendingRequestKeyRef.current,
      pendingRequestRouteKey: pendingRequestRouteKeyRef.current,
      startedRequestKey: startedRequestKeyRef.current,
    }).toEqual({
      pendingRequestKey: null,
      pendingRequestRouteKey: null,
      startedRequestKey: null,
    });
  });

  it("모드 변경·위치·지역·명시적 재시도만 현재 세션 이력을 보내며 hydration은 재요청하지 않는다", () => {
    const source = readFileSync("app/routes/home.tsx", "utf8");

    expect(source).toContain("readHomeRecommendationHistory");
    expect(source).toContain("encodeHomeRecommendationHistory");
    expect(source).toContain("recordHomeRecommendation");
    expect(source).toContain("lastRecordedRequestKeyRef");
    expect(source).toContain("pendingRequestRouteKeyRef");
    expect(source).toContain("beginHomeRecommendationRequest(");
    expect(source).toContain("createHomeRecommendationRequestToken(++requestSequenceRef.current)");
    expect(source).toContain("buildRecommendationUrl(mode, bbox, source, requestKey)");
    expect(source).toContain('loadRecommendations(mode, liveMapState.bbox, liveHomeState.locationSource)');
    expect(source).toContain('loadRecommendations(liveHomeState.mode, result.bbox, "gps")');
    expect(source).toContain('loadRecommendations(liveHomeState.mode, pendingBounds, "map_center")');
    expect(source).toContain('onRetry: () => loadRecommendations(liveHomeState.mode, liveMapState.bbox, liveHomeState.locationSource)');
    expect(source).not.toMatch(/clientLoader\.hydrate\s*=\s*true/);
    expect(source).not.toMatch(/useEffect\(\(\) => \{\s*loadRecommendations/);
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("document.cookie");
  });
});
