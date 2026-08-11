import { describe, expect, it } from "vitest";

import {
  aggregateTasteScore,
  buildHomeCandidateFeatures,
  confidenceScore,
  deterministicVariation,
  discoveryScore,
  distanceBandScore,
  firstRankPenalty,
  freshnessScore,
  timeCompatibilityScore,
} from "../../app/features/places/home-curation-features";
import type { DiscoveryPlace } from "../../app/features/places/place-discovery";

const centerA = { latitude: 35.1500, longitude: 126.9000 };
const centerBWithin500m = { latitude: 35.1510, longitude: 126.9010 };

function place(input: Partial<DiscoveryPlace> = {}): DiscoveryPlace {
  return {
    id: "p1",
    slug: "p1",
    name: "국밥집",
    address: "광주",
    neighborhood: "동구",
    latitude: 35.15,
    longitude: 126.9,
    heroImageUrl: null,
    primaryCategory: { slug: "korean", name: "한식", emoji: "🍚" },
    positive: 24,
    negative: 6,
    ...input,
  };
}

describe("home curation features", () => {
  it.each([[500, 1], [501, .95], [1_001, .85], [2_001, .72], [3_001, .55], [5_001, .35], [8_001, .15]])(
    "거리 %im 점수는 %f다", (meters, expected) => expect(distanceBandScore(meters)).toBe(expected),
  );

  it("신뢰도는 표본 로그 완화와 무표본 하한을 사용한다", () => {
    expect(confidenceScore(null, 0)).toBe(.35);
    expect(confidenceScore(80, 30)).toBeCloseTo(.8, 5);
    expect(confidenceScore(80, 1)).toBeLessThan(confidenceScore(80, 30));
  });

  it("직접·인접 취향을 중복 없이 지수 포화한다", () => {
    expect(aggregateTasteScore([{ badgeId: "gukbap", strength: 1, match: "DIRECT" }])).toBeCloseTo(1 - Math.exp(-1));
    expect(aggregateTasteScore([
      { badgeId: "gukbap", strength: 1, match: "DIRECT" },
      { badgeId: "gukbap", strength: 1, match: "ADJACENT" },
    ])).toBeCloseTo(1 - Math.exp(-1));
  });

  it.each([[0, 1], [1, .8], [2, .55], [3, .3], [9, .3]])("노출 %i회 freshness", (count, expected) => {
    expect(freshnessScore(count)).toBe(expected);
  });

  it("최근 1위 페널티는 가장 심한 값 하나만 적용한다", () => {
    expect(firstRankPenalty("p1", ["p1", "p1", "p1"])).toBe(-.30);
  });

  it.each([
    [["p1", "other", "another"], -.12],
    [["other", "p1", "another"], 0],
    [["p1", "other", "p1"], -.18],
  ] as const)("직전 1위와 최근 반복 1위를 구분한다: %j", (recentFirst, expected) => {
    expect(firstRankPenalty("p1", [...recentFirst])).toBe(expected);
  });

  it("변동값은 같은 날짜·세션·모드·500m 위치에서 안정적이다", () => {
    const a = deterministicVariation({ sessionSeed: "s", dateKey: "2026-08-11", mode: "now", center: centerA, placeId: "p" });
    const b = deterministicVariation({ sessionSeed: "s", dateKey: "2026-08-11", mode: "now", center: centerBWithin500m, placeId: "p" });
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(.05);
  });

  it("세션 또는 KST 날짜가 바뀌면 근소한 동점 후보의 결정적 변동값이 회전한다", () => {
    const inputs = [
      { sessionSeed: "session-a", dateKey: "2026-08-11" },
      { sessionSeed: "session-b", dateKey: "2026-08-11" },
      { sessionSeed: "session-a", dateKey: "2026-08-12" },
    ];
    const winners = inputs.map((seed) => ["place-a", "place-b"]
      .map((placeId) => ({
        placeId,
        variation: deterministicVariation({ ...seed, mode: "now", center: centerA, placeId }),
      }))
      .sort((left, right) => right.variation - left.variation)[0]!.placeId);

    expect(new Set(winners).size).toBeGreaterThan(1);
  });

  it.each([
    ["STRONG", 1],
    ["WEAK", .7],
    ["UNKNOWN", .5],
    ["MISMATCH", .2],
  ] as const)("시간대 근거 %s는 %f다", (compatibility, expected) => {
    expect(timeCompatibilityScore(compatibility)).toBe(expected);
  });

  it("대표 카테고리 일치는 약하게, 반대되는 구체 키워드는 불일치로 분류한다", () => {
    const baseInput = {
      center: centerA,
      tasteSignals: [],
      history: { sessionSeed: "seed", recentFirst: [], recentShown: [], previousMode: null, previousIds: [] },
      dateKey: "2026-08-11",
      mode: "time" as const,
    };

    expect(buildHomeCandidateFeatures({
      ...baseInput,
      place: place({ name: "매장", primaryCategory: { slug: "cafe", name: "카페", emoji: "☕" } }),
      timeSlot: "afternoon",
    }).timeCompatibility).toBe("WEAK");
    expect(buildHomeCandidateFeatures({
      ...baseInput,
      place: place({ name: "야식 포장마차" }),
      timeSlot: "lunch",
    }).timeCompatibility).toBe("MISMATCH");
  });

  it.each([
    [{ directTaste: .75, adjacentTaste: 0, explicitNew: false }, .2],
    [{ directTaste: .74, adjacentTaste: 0, explicitNew: false }, .35],
    [{ directTaste: 0, adjacentTaste: .1, explicitNew: false }, .65],
    [{ directTaste: 0, adjacentTaste: 0, explicitNew: false }, .8],
    [{ directTaste: 0, adjacentTaste: 0, explicitNew: true }, 1],
  ] as const)("발견성 근거는 점수를 결정한다", (input, expected) => {
    expect(discoveryScore(input)).toBe(expected);
  });

  it("후속 랭킹용 특징에 취향·시간 근거와 세션 영향을 함께 노출한다", () => {
    const result = buildHomeCandidateFeatures({
      place: place({ name: "국밥", searchText: "점심 식사" }),
      center: centerA,
      tasteSignals: [{ badgeId: "food-gukbap", score: 1, source: "USER" }],
      timeSlot: "lunch",
      history: {
        sessionSeed: "seed",
        recentFirst: ["other", "p1"],
        recentShown: [{ placeId: "p1", count: 2 }],
        previousMode: "now",
        previousIds: ["other", "p1"],
      },
      dateKey: "2026-08-11",
      mode: "taste",
    });

    expect(result.tasteMatches).toEqual([{ badgeId: "food-gukbap", strength: 1, match: "DIRECT" }]);
    expect(result.timeCompatibility).toBe("STRONG");
    expect(result.taste).toBeCloseTo(1 - Math.exp(-1));
    expect(result.discovery).toBe(.2);
    expect(result.freshness).toBe(.55);
    expect(result.firstRankPenalty).toBe(0);
    expect(result.variation).toBeGreaterThanOrEqual(0);
  });
});
