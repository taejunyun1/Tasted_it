import { describe, expect, it } from "vitest";

import {
  centerOfBbox,
  homeTimeSlotAt,
  homeTimeSlotLabel,
  parseHomeCurationState,
  parseHomeRecommendationRequest,
} from "../../app/features/maps/home-curation-options";

describe("home curation options", () => {
  it("알 수 없는 view와 mode를 큐레이션 기본값으로 정규화한다", () => {
    expect(parseHomeCurationState("?view=bad&mode=bad")).toEqual({ view: "curated", mode: "now" });
  });

  it("지원하는 view와 mode만 보존한다", () => {
    expect(parseHomeCurationState("?view=browse&mode=golden")).toEqual({ view: "browse", mode: "golden" });
  });

  it.each(["?category=ramen-detail", "?q=국밥"])("기존 검색·카테고리 URL은 전체 탐색으로 연다: %s", (search) => {
    expect(parseHomeCurationState(search).view).toBe("browse");
  });

  it("bbox 중심을 계산한다", () => {
    expect(centerOfBbox([126.8, 35.1, 127, 35.3])).toEqual({ latitude: 35.2, longitude: 126.9 });
  });

  it.each([
    ["2026-08-10T20:29:00.000Z", "breakfast"],
    ["2026-08-10T01:30:00.000Z", "lunch"],
    ["2026-08-10T05:30:00.000Z", "afternoon"],
    ["2026-08-10T08:30:00.000Z", "dinner"],
    ["2026-08-10T12:30:00.000Z", "late"],
  ] as const)("Asia/Seoul 기준 시간대를 계산한다", (now, expected) => {
    expect(homeTimeSlotAt(new Date(now))).toBe(expected);
  });

  it("시간대 식별자를 사용자 문구로 바꾼다", () => {
    expect(homeTimeSlotLabel("late")).toBe("늦은 시간");
  });

  it("추천 리소스의 모드와 bbox를 엄격하게 파싱한다", () => {
    expect(parseHomeRecommendationRequest("?mode=golden&bbox=126.8,35,127,35.3"))
      .toEqual({
        mode: "golden",
        bbox: [126.8, 35, 127, 35.3],
        center: { latitude: 35.15, longitude: 126.9 },
      });
  });

  it("React Router가 붙이는 정확한 리소스 식별자만 허용한다", () => {
    expect(parseHomeRecommendationRequest("?mode=now&bbox=126.8,35,127,35.3&_routes=routes%2Fhome-recommendations-resource"))
      .toMatchObject({ mode: "now", bbox: [126.8, 35, 127, 35.3] });
  });

  it.each([
    "?bbox=126.8,35,127,35.3",
    "?mode=now",
    "?mode=bad&bbox=126.8,35,127,35.3",
    "?mode=now&mode=taste&bbox=126.8,35,127,35.3",
    "?mode=now&bbox=126.8,35,127,35.3&debug=1",
    "?mode=now&bbox=126.8,35,127,35.3&_routes=bad",
    "?mode=now&bbox=126.8,35,127,35.3&_routes=routes%2Fhome-recommendations-resource&_routes=routes%2Fhome-recommendations-resource",
    "?mode=now&bbox=126.8,35,127",
    "?mode=now&bbox=127,35.3,126.8,35",
    "?mode=now&bbox=100,35,101,35.3",
  ])("모호하거나 한국 범위를 벗어난 추천 요청을 거부한다: %s", (search) => {
    expect(() => parseHomeRecommendationRequest(search)).toThrow("HOME_RECOMMENDATION_REQUEST_INVALID");
  });
});
