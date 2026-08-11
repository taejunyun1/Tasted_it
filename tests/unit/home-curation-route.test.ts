import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { DB: {}, ONBOARDING_ENABLED: "true", NAVER_MAPS_CLIENT_ID: "map-client" },
  getOptionalUser: vi.fn(async (): Promise<{ id: string } | null> => null),
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
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("../../app/db/client.server", () => ({ createDb: () => ({}) }));
vi.mock("../../app/features/auth/session.server", () => ({ getOptionalUser: mocks.getOptionalUser }));
vi.mock("../../app/features/onboarding/guest-session.server", () => ({
  getGuestOnboardingFromRequest: mocks.getGuestOnboardingFromRequest,
}));
vi.mock("../../app/features/places/home-curation.server", () => ({
  getHomeCurationPage: mocks.getHomeCurationPage,
}));
vi.mock("../../app/features/places/place.server", () => ({
  listPlaces: mocks.listPlaces,
  listPublicCategoryGroups: mocks.listPublicCategoryGroups,
}));

afterEach(() => {
  mocks.getOptionalUser.mockReset();
  mocks.getOptionalUser.mockResolvedValue(null);
  mocks.getGuestOnboardingFromRequest.mockReset();
  mocks.getGuestOnboardingFromRequest.mockResolvedValue(null);
  mocks.getHomeCurationPage.mockClear();
  mocks.listPlaces.mockClear();
  mocks.listPublicCategoryGroups.mockClear();
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

  it("명시적 전체보기는 기존 장소·카테고리 탐색을 유지한다", async () => {
    const { loader } = await import("../../app/routes/home");
    const result = await loader({ request: new Request("https://retaste.example/?view=browse&q=국밥") } as never);

    expect(result.view).toBe("browse");
    expect(mocks.listPlaces).toHaveBeenCalled();
    expect(mocks.listPublicCategoryGroups).toHaveBeenCalled();
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

    const url = new URL(buildRecommendationUrl("taste", [126.8, 35, 127, 35.3], "gps", storage), "https://retaste.example");

    expect(url.pathname).toBe("/resources/home-recommendations");
    expect(url.searchParams.get("mode")).toBe("taste");
    expect(url.searchParams.get("bbox")).toBe("126.8,35,127,35.3");
    expect(url.searchParams.get("locationSource")).toBe("gps");
    expect(url.searchParams.get("history")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("완료된 v2 정상 응답만 요청별 한 번 기록 대상으로 고른다", async () => {
    const { getRecordableHomeRecommendation } = await import("../../app/routes/home");
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
    const response = { ok: true as const, recommendations: page };

    expect(getRecordableHomeRecommendation("idle", response, "request-1", "request-1", null))
      .toEqual({ requestKey: "request-1", page });
    const emptyPage = { ...page, status: "EMPTY" as const };
    expect(getRecordableHomeRecommendation("idle", {
      ok: true,
      recommendations: emptyPage,
    }, "request-2", "request-2", null)).toEqual({ requestKey: "request-2", page: emptyPage });
    expect(getRecordableHomeRecommendation("loading", response, "request-1", "request-1", null)).toBeNull();
    expect(getRecordableHomeRecommendation("idle", response, "request-1", "request-1", "request-1")).toBeNull();
    expect(getRecordableHomeRecommendation("idle", { ok: false }, "request-1", "request-1", null)).toBeNull();
    expect(getRecordableHomeRecommendation("idle", {
      ok: true,
      recommendations: { ...page, algorithmVersion: "home-curation-v1" },
    }, "request-1", "request-1", null)).toBeNull();
    expect(getRecordableHomeRecommendation("idle", {
      ok: true,
      recommendations: { ...page, status: "ERROR" },
    }, "request-1", "request-1", null)).toBeNull();
  });

  it("모드 변경·위치·지역·명시적 재시도만 현재 세션 이력을 보내며 hydration은 재요청하지 않는다", () => {
    const source = readFileSync("app/routes/home.tsx", "utf8");

    expect(source).toContain("readHomeRecommendationHistory");
    expect(source).toContain("encodeHomeRecommendationHistory");
    expect(source).toContain("recordHomeRecommendation");
    expect(source).toContain("lastRecordedRequestKeyRef");
    expect(source).toMatch(/const requestKey = `\$\{\+\+requestSequenceRef\.current\}:\$\{requestUrl\}`;\s*pendingRequestKeyRef\.current = requestKey;\s*startedRequestKeyRef\.current = requestKey;\s*void recommendationFetcher\.load\(requestUrl\)/);
    expect(source).toContain('loadRecommendations(mode, liveMapState.bbox, locationSource)');
    expect(source).toContain('loadRecommendations(liveHomeState.mode, result.bbox, "gps")');
    expect(source).toContain('loadRecommendations(liveHomeState.mode, pendingBounds, "map_center")');
    expect(source).toContain('onRetry: () => loadRecommendations(liveHomeState.mode, liveMapState.bbox, locationSource)');
    expect(source).not.toContain("clientLoader");
    expect(source).not.toMatch(/useEffect\(\(\) => \{\s*loadRecommendations/);
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("document.cookie");
  });
});
