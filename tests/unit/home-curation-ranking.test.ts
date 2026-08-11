import { describe, expect, it } from "vitest";

import {
  rankGoldenCandidates,
  rankHomeCandidates,
  type HomeCandidateFeatures,
  type HomeRankingCandidate,
} from "../../app/features/places/home-curation-ranking";
import type { HomeCurationMode } from "../../app/features/maps/home-curation-options";
import type { DiscoveryPlace } from "../../app/features/places/place-discovery";

function place(id: string, input: {
  category?: string;
  latitude?: number;
  longitude?: number;
  ratingScore?: number | null;
  ratingSampleCount?: number;
} = {}): DiscoveryPlace {
  return {
    id,
    slug: id,
    name: id,
    address: id,
    neighborhood: id,
    latitude: input.latitude ?? 35.15,
    longitude: input.longitude ?? 126.92,
    heroImageUrl: null,
    primaryCategory: {
      slug: input.category ?? id,
      name: input.category ?? id,
      emoji: "🍽️",
    },
    positive: input.ratingSampleCount ?? 0,
    negative: 0,
    ratingScore: input.ratingScore,
    ratingSampleCount: input.ratingSampleCount,
  };
}

function features(input: Partial<HomeCandidateFeatures> = {}): HomeCandidateFeatures {
  return {
    distanceMeters: 1_000,
    distance: 0,
    confidence: 0,
    taste: 0,
    time: 0,
    discovery: 0,
    freshness: 1,
    firstRankPenalty: 0,
    variation: 0,
    tasteMatches: [],
    timeCompatibility: "UNKNOWN",
    ...input,
  };
}

function candidate(
  id: string,
  featureInput: Partial<HomeCandidateFeatures>,
  input: {
    category?: string;
    latitude?: number;
    longitude?: number;
    ratingScore?: number | null;
    ratingSampleCount?: number;
    golden?: 0 | .8 | 1;
    pastGolden?: 0 | .4;
    reviewerConfidence?: number;
    reviewerId?: string | null;
  } = {},
): HomeRankingCandidate {
  return {
    place: place(id, input),
    features: features(featureInput),
    golden: input.golden ?? 0,
    pastGolden: input.pastGolden ?? 0,
    reviewerConfidence: input.reviewerConfidence ?? 0,
    reviewerId: input.reviewerId ?? null,
  };
}

function input(overrides: {
  mode?: Exclude<HomeCurationMode, "golden">;
  candidates?: HomeRankingCandidate[];
  previousMode?: HomeCurationMode | null;
  previousIds?: string[];
}) {
  return {
    mode: overrides.mode ?? "now" as const,
    candidates: overrides.candidates ?? [],
    previousMode: overrides.previousMode ?? null,
    previousIds: overrides.previousIds ?? [],
    locationSource: "map_center" as const,
  };
}

describe("rankHomeCandidates", () => {
  it("거리만 가까운 장소보다 현재 모드 핵심 점수가 높은 장소를 1위로 둔다", () => {
    const nearWeakTaste = candidate("near-weak-taste", {
      distance: 1,
      taste: 0,
      confidence: .4,
      time: .5,
      discovery: .8,
    });
    const fartherStrongTaste = candidate("farther-strong-taste", {
      distance: .55,
      taste: 1,
      confidence: .4,
      time: .5,
      discovery: .2,
      tasteMatches: [{ badgeId: "food-gukbap", strength: 1, match: "DIRECT" }],
    });

    const result = rankHomeCandidates(input({
      mode: "taste",
      candidates: [nearWeakTaste, fartherStrongTaste],
    }));

    expect(result[0].place.id).toBe("farther-strong-taste");
  });

  it("2~5위는 같은 카테고리·세부 유형·500m 군집·같은 이유를 MMR로 분산한다", () => {
    const diversityFixture = [
      candidate("a", { taste: 1, distance: 1, time: 1, confidence: 1, discovery: 1,
        tasteMatches: [{ badgeId: "food-gukbap", strength: 1, match: "DIRECT" }] },
      { category: "soup", latitude: 35.15, longitude: 126.92 }),
      candidate("b", { taste: .96, distance: 1, time: 1, confidence: 1, discovery: 1,
        tasteMatches: [{ badgeId: "food-gukbap", strength: 1, match: "DIRECT" }] },
      { category: "soup", latitude: 35.151, longitude: 126.921 }),
      candidate("d", { distance: 1, time: 1, confidence: 1, discovery: 1 },
      { category: "noodle", latitude: 35.16, longitude: 126.93 }),
      candidate("f", { distance: .95, time: .9, confidence: 1, discovery: 1 },
      { category: "seafood", latitude: 35.17, longitude: 126.94 }),
      candidate("e", { distance: .5, time: .5, confidence: .5, discovery: .5 },
      { category: "bakery", latitude: 35.18, longitude: 126.95 }),
    ];

    const result = rankHomeCandidates(input({ candidates: diversityFixture }));

    expect(result.slice(0, 5).map((item) => item.place.id)).toEqual(["a", "d", "f", "b", "e"]);
  });

  it("모드를 실제 변경했고 겹침이 4곳 이상이며 후보가 8곳 이상이면 2곳 이상 바꾼다", () => {
    const candidates = [
      ...["a", "b", "c", "d", "e"].map((id, index) => candidate(id, {
        taste: .95 - index * .01,
        distance: .95,
        time: .95,
        confidence: .95,
        discovery: .95,
      }, { latitude: 35.15 + index * .01, longitude: 126.92 + index * .01 })),
      ...["f", "g", "h"].map((id, index) => candidate(id, {
        taste: .82 - index * .01,
        distance: .82,
        time: .82,
        confidence: .82,
        discovery: .82,
      }, { latitude: 35.21 + index * .01, longitude: 126.98 + index * .01 })),
    ];

    const result = rankHomeCandidates(input({
      mode: "time",
      candidates,
      previousMode: "taste",
      previousIds: ["a", "b", "c", "d", "e"],
    }));

    expect(result.filter((item) => ["a", "b", "c", "d", "e"].includes(item.place.id))).toHaveLength(3);
  });

  it("같은 모드 재시도와 7곳 이하 후보에는 최소 변화량을 강제하지 않는다", () => {
    const candidates = ["a", "b", "c", "d", "e", "f", "g"].map((id, index) => candidate(id, {
      taste: 1 - index * .08,
      distance: 1 - index * .08,
      time: 1 - index * .08,
      confidence: 1 - index * .08,
      discovery: 1 - index * .08,
    }, { latitude: 35.15 + index * .01, longitude: 126.92 + index * .01 }));
    const previousIds = ["a", "b", "c", "d", "e"];

    const tasteBaseline = rankHomeCandidates(input({ mode: "taste", candidates }));
    const timeBaseline = rankHomeCandidates(input({ mode: "time", candidates }));
    const sameMode = rankHomeCandidates(input({ mode: "taste", candidates, previousMode: "taste", previousIds }));
    const smallPool = rankHomeCandidates(input({ mode: "time", candidates, previousMode: "taste", previousIds }));

    expect(sameMode.map((item) => item.place.id)).toEqual(tasteBaseline.map((item) => item.place.id));
    expect(smallPool.map((item) => item.place.id)).toEqual(timeBaseline.map((item) => item.place.id));
  });

  it("세부 유형은 가장 강한 직접 배지, 인접 배지, 카테고리 순으로 결정한다", () => {
    const result = rankHomeCandidates(input({ candidates: [
      candidate("direct", {
        taste: .8,
        tasteMatches: [
          { badgeId: "adjacent-strong", strength: 1, match: "ADJACENT" },
          { badgeId: "direct-weak", strength: .2, match: "DIRECT" },
          { badgeId: "direct-strong", strength: .9, match: "DIRECT" },
        ],
      }, { category: "category-fallback" }),
      candidate("adjacent", {
        taste: .4,
        tasteMatches: [{ badgeId: "adjacent-only", strength: .7, match: "ADJACENT" }],
      }, { category: "category-fallback" }),
      candidate("category", {}, { category: "category-fallback" }),
    ] }));

    expect(Object.fromEntries(result.map((item) => [item.place.id, item.detailTypeKey]))).toEqual({
      direct: "direct-strong",
      adjacent: "adjacent-only",
      category: "category-fallback",
    });
  });
});

describe("rankGoldenCandidates", () => {
  it("activeGoldenIds로 지정한 활성 후보를 Golden primary 경계 안에서 선택한다", () => {
    const result = rankGoldenCandidates({
      candidates: [
        candidate("active", { confidence: .5, freshness: 1 }),
        candidate("fallback", { confidence: 1, freshness: 1 }, { reviewerConfidence: 1 }),
      ],
      activeGoldenIds: ["active"],
      locationSource: "map_center",
    });

    expect(result.places[0]).toEqual(expect.objectContaining({
      place: expect.objectContaining({ id: "active" }),
      isGoldenPick: true,
    }));
  });

  it("활성 Golden 후보를 먼저 선택하고 5곳 미만일 때만 근거 fallback으로 채운다", () => {
    const result = rankGoldenCandidates({
      candidates: [
        candidate("active-normal", { confidence: .7, freshness: 1 }, { golden: 1, reviewerId: "r1" }),
        candidate("active-expiring", { confidence: 1, freshness: 1 }, { golden: .8, reviewerId: "r2" }),
        candidate("past", { confidence: .4, freshness: 1 }, { pastGolden: .4 }),
        candidate("reviewer", { confidence: .6, freshness: 1 }, { reviewerConfidence: .9 }),
        candidate("overall", { confidence: .8, freshness: 1 }, { ratingScore: 80, ratingSampleCount: 12 }),
        candidate("general", { distance: 1, freshness: 1 }),
      ],
      locationSource: "map_center",
    });

    expect(result.places.slice(0, 2).map((item) => item.place.id)).toEqual(["active-normal", "active-expiring"]);
    expect(result.places).toHaveLength(5);
    expect(result.places.some((item) => item.place.id === "general")).toBe(false);
    expect(result.goldenFallback).toBe(false);
    expect(result.notice).toBeNull();
  });

  it("활성 후보가 없으면 근거리 일반 장소를 섞지 않고 평가 근거 후보만 반환한다", () => {
    const generalNearby = candidate("general", { distance: 1, freshness: 1 });
    const pastGolden = candidate("past", { confidence: .4, freshness: 1 }, { pastGolden: .4 });
    const reviewerTrusted = candidate("reviewer", { confidence: .6, freshness: 1 }, { reviewerConfidence: .9 });

    const result = rankGoldenCandidates({
      candidates: [generalNearby, pastGolden, reviewerTrusted],
      locationSource: "map_center",
    });

    expect(result.places.map((item) => item.place.id)).toEqual(expect.arrayContaining(["past", "reviewer"]));
    expect(result.places.some((item) => item.place.id === "general")).toBe(false);
    expect(result.places).toHaveLength(2);
    expect(result.goldenFallback).toBe(true);
    expect(result.notice).toBe("현재 주변 Golden Pick이 없어 리뷰어 평가가 좋은 장소를 추천합니다.");
  });

  it("Golden 모드 변경 보정도 근거 fallback 풀 밖의 일반 후보를 사용하지 않는다", () => {
    const eligible = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id, index) => candidate(id, {
      confidence: id === "h" ? .2 : .95 - index * .02,
      freshness: 1,
    }, { reviewerConfidence: id === "h" ? .2 : .95 - index * .02 }));
    const result = rankGoldenCandidates({
      candidates: [candidate("general", { distance: 1, freshness: 1 }), ...eligible],
      activeGoldenIds: [],
      previousMode: "taste",
      previousIds: ["a", "b", "c", "d", "e"],
      locationSource: "map_center",
    });

    expect(result.places.filter((item) => ["a", "b", "c", "d", "e"].includes(item.place.id))).toHaveLength(3);
    expect(result.places.some((item) => item.place.id === "general")).toBe(false);
  });
});
