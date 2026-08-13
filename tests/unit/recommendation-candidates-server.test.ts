import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRecommendationCandidates: vi.fn(async () => [{
    id: "place-1",
    slug: "place-1",
    name: "장소 1",
    address: "광주",
    neighborhood: "동명동",
    latitude: 35.15,
    longitude: 126.92,
    heroImageUrl: null,
    primaryCategory: { slug: "korean", name: "한식", emoji: "🍚" },
    positive: 0,
    negative: 0,
  }]),
  loadGoldenPickContextForPlaces: vi.fn(async () => {
    throw new Error("GOLDEN_HISTORY_UNAVAILABLE");
  }),
}));

vi.mock("../../app/features/places/place.server", () => ({
  listRecommendationCandidates: mocks.listRecommendationCandidates,
}));
vi.mock("../../app/features/ratings/golden-pick.server", () => ({
  loadGoldenPickContextForPlaces: mocks.loadGoldenPickContextForPlaces,
}));

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
        }),
      }),
    }),
  };
}

afterEach(() => {
  mocks.listRecommendationCandidates.mockClear();
  mocks.loadGoldenPickContextForPlaces.mockClear();
});

describe("loadRecommendationCandidateContext Golden 조회 정책", () => {
  it("홈, 코스, 장소 추천에 공통 후보 함수를 사용한다", async () => {
    const { loadRecommendationCandidateContext } = await import("../../app/features/places/recommendation-candidates.server");
    const bbox: [number, number, number, number] = [126.8, 35, 127, 35.3];

    await loadRecommendationCandidateContext(fakeDb() as never, {
      bbox,
      categorySlug: "korean",
      now: "2026-08-11T03:00:00.000Z",
      goldenContext: "omit",
    });

    expect(mocks.listRecommendationCandidates).toHaveBeenCalledWith(expect.anything(), {
      bbox,
      categorySlug: "korean",
      limit: 500,
    });
  });

  it("Golden이 아닌 홈 모드는 Golden 이력 조회를 실행하지 않는다", async () => {
    const { loadRecommendationCandidateContext } = await import("../../app/features/places/recommendation-candidates.server");
    const context = await loadRecommendationCandidateContext(fakeDb() as never, {
      bbox: [126.8, 35, 127, 35.3],
      now: "2026-08-11T03:00:00.000Z",
      goldenContext: "omit",
    });

    expect(mocks.loadGoldenPickContextForPlaces).not.toHaveBeenCalled();
    expect(context.goldenContextStatus).toBe("NOT_REQUESTED");
    expect(context.goldenPicks).toEqual([]);
    expect(context.goldenSummaries).toEqual([]);
  });

  it("Golden 홈 모드는 이력 조회 실패를 명시적 unavailable 상태로 반환한다", async () => {
    const { loadRecommendationCandidateContext } = await import("../../app/features/places/recommendation-candidates.server");
    const context = await loadRecommendationCandidateContext(fakeDb() as never, {
      bbox: [126.8, 35, 127, 35.3],
      now: "2026-08-11T03:00:00.000Z",
      goldenContext: "empty-on-error",
    });

    expect(mocks.loadGoldenPickContextForPlaces).toHaveBeenCalledOnce();
    expect(context.goldenContextStatus).toBe("UNAVAILABLE");
    expect(context.goldenPicks).toEqual([]);
    expect(context.goldenSummaries).toEqual([]);
  });

  it("기존 /places 소비자는 Golden 조회 실패를 계속 오류로 받는다", async () => {
    const { loadRecommendationCandidateContext } = await import("../../app/features/places/recommendation-candidates.server");

    await expect(loadRecommendationCandidateContext(fakeDb() as never, {
      bbox: [126.8, 35, 127, 35.3],
      now: "2026-08-11T03:00:00.000Z",
    })).rejects.toThrow("GOLDEN_HISTORY_UNAVAILABLE");
  });
});
