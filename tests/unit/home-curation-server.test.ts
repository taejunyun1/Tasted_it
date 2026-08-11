import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadRecommendationCandidateContext: vi.fn(),
}));

vi.mock("../../app/features/places/recommendation-candidates.server", () => ({
  loadRecommendationCandidateContext: mocks.loadRecommendationCandidateContext,
}));

const place = {
  id: "place-1",
  slug: "place-1",
  name: "장소 1",
  address: "광주",
  neighborhood: "동명동",
  latitude: 35.151,
  longitude: 126.921,
  heroImageUrl: null,
  searchText: "백반",
  primaryCategory: { slug: "korean", name: "한식", emoji: "🍚" },
  positive: 20,
  negative: 0,
  ratingScore: 85,
  ratingSampleCount: 20,
};

const request = {
  bbox: [126.8, 35, 127, 35.3] as [number, number, number, number],
  center: { latitude: 35.15, longitude: 126.92 },
  mode: "now" as const,
  now: "2026-08-11T03:00:00.000Z",
};

beforeEach(() => {
  mocks.loadRecommendationCandidateContext.mockReset();
  mocks.loadRecommendationCandidateContext.mockResolvedValue({
    candidates: [place],
    dislikedPlaceIds: [],
    goldenPicks: [],
    goldenSummaries: [],
    tasteSignals: [],
    goldenContextStatus: "NOT_REQUESTED",
  });
});

describe("getHomeCurationPage Golden 조회 실패", () => {
  it("Golden이 아닌 모드는 이력 조회를 생략하는 정책을 요청한다", async () => {
    const { getHomeCurationPage } = await import("../../app/features/places/home-curation.server");
    await getHomeCurationPage({} as never, request);

    expect(mocks.loadRecommendationCandidateContext).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      goldenContext: "omit",
    }));
  });

  it("Golden 이력 조회가 실패하면 일반 평가 후보로 대체하지 않고 EMPTY를 반환한다", async () => {
    mocks.loadRecommendationCandidateContext.mockResolvedValue({
      candidates: [place],
      dislikedPlaceIds: [],
      goldenPicks: [],
      goldenSummaries: [],
      tasteSignals: [],
      goldenContextStatus: "UNAVAILABLE",
    });
    const { getHomeCurationPage } = await import("../../app/features/places/home-curation.server");
    const page = await getHomeCurationPage({} as never, { ...request, mode: "golden" });

    expect(mocks.loadRecommendationCandidateContext).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      goldenContext: "empty-on-error",
    }));
    expect(page).toEqual(expect.objectContaining({
      status: "EMPTY",
      places: [],
      goldenFallback: true,
      notice: "현재 주변 Golden Pick이 없어 과거 선정 이력과 평가 기록을 바탕으로 추천합니다.",
    }));
  });
});
