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

  it("Golden 이력 조회 실패를 빈 결과나 정상 fallback으로 표시하지 않는다", async () => {
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
      status: "UNAVAILABLE",
      places: [],
      goldenFallback: false,
      notice: "Golden Pick 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    }));
  });

  it("정상 조회에 현재 Golden Pick만 없으면 기존 평가 fallback을 유지한다", async () => {
    mocks.loadRecommendationCandidateContext.mockResolvedValue({
      candidates: [place], dislikedPlaceIds: [], goldenPicks: [],
      goldenSummaries: [], tasteSignals: [], goldenContextStatus: "AVAILABLE",
    });
    const { getHomeCurationPage } = await import("../../app/features/places/home-curation.server");
    const page = await getHomeCurationPage({} as never, { ...request, mode: "golden" });
    expect(page.status).toBe("READY");
    expect(page.places.map(item => item.id)).toEqual([place.id]);
    expect(page.goldenFallback).toBe(true);
    expect(page.notice).toContain("과거 선정 이력과 평가 기록");
  });
});
