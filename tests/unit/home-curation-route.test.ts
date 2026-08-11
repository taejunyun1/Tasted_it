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
});
