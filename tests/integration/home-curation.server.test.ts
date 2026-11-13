import { env } from "cloudflare:workers";
import { expect, expectTypeOf, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import {
  categories,
  currentVotes,
  goldenPickEvents,
  placeCategories,
  places,
  ratingSnapshots,
  userTasteBadges,
  users,
  voteEvents,
} from "../../app/db/schema";
import {
  getHomeCurationPage,
  type HomeCurationRequest,
} from "../../app/features/places/home-curation.server";
import type { HomeCurationPage as HomeCurationPageContract } from "../../app/features/places/home-curation";
import { loadRecommendationCandidateContext } from "../../app/features/places/recommendation-candidates.server";

const GOLDEN_FALLBACK_NOTICE = "현재 주변 Golden Pick이 없어 과거 선정 이력과 평가 기록을 바탕으로 추천합니다.";
let homeFixtureIndex = 0;

type ConcentricLayer = "within3" | "within5Extra" | "within8Extra";
type SeedCandidate = {
  id: string;
  distanceMeters: number;
  longitudeMeters?: number;
  ratingScore: number;
  ratingSampleCount: number;
};
let concentricFixtureIndex = 0;

it("공개 HomeCurationPage가 v2 메타데이터를 필수로 요구한다", () => {
  expectTypeOf<Pick<
    HomeCurationPageContract,
    "algorithmVersion" | "candidateCount" | "goldenFallback" | "notice"
  >>().toEqualTypeOf<{
    algorithmVersion: "home-curation-v2";
    candidateCount: number;
    goldenFallback: boolean;
    notice: string | null;
  }>();
});

async function seedConcentricCandidates(input: {
  within3: number;
  within5Extra: number;
  within8Extra: number;
  qualityExtras?: boolean;
}) {
  const db = createDb(env.DB);
  const suffix = crypto.randomUUID();
  const now = "2026-08-11T03:00:00.000Z";
  const center = {
    latitude: 36 + concentricFixtureIndex * .2,
    longitude: 127,
  };
  concentricFixtureIndex += 1;
  const categoryId = `density-category-${suffix}`;
  const layerDistances: Record<ConcentricLayer, number> = {
    within3: 1_500,
    within5Extra: 4_000,
    within8Extra: 6_500,
  };
  const layerCounts: Record<ConcentricLayer, number> = {
    within3: input.within3,
    within5Extra: input.within5Extra,
    within8Extra: input.within8Extra,
  };
  const candidates: SeedCandidate[] = (Object.keys(layerCounts) as ConcentricLayer[]).flatMap((layer) => (
    Array.from({ length: layerCounts[layer] }, (_, index) => ({
      id: `density-${suffix}-${layer}-${index}`,
      distanceMeters: layerDistances[layer],
      ratingScore: 82,
      ratingSampleCount: 20,
    }))
  ));
  if (input.qualityExtras) {
    candidates.push(
      {
        id: `density-${suffix}-mature-low`,
        distanceMeters: 1_000,
        ratingScore: 54,
        ratingSampleCount: 8,
      },
      {
        id: `density-${suffix}-small-low`,
        distanceMeters: 1_000,
        ratingScore: 54,
        ratingSampleCount: 7,
      },
      {
        id: `density-${suffix}-outside-eight`,
        distanceMeters: 6_100,
        longitudeMeters: 6_100,
        ratingScore: 82,
        ratingSampleCount: 20,
      },
    );
  }

  await db.insert(categories).values({
    id: categoryId,
    slug: categoryId,
    name: "후보 밀도 분류",
    emoji: "🍽️",
    isActive: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });
  for (let offset = 0; offset < candidates.length; offset += 4) {
    const chunk = candidates.slice(offset, offset + 4);
    await db.insert(places).values(chunk.map((candidate) => ({
      id: candidate.id,
      slug: candidate.id,
      name: candidate.id,
      status: "PUBLISHED" as const,
      address: "광주광역시 후보 밀도",
      neighborhood: "후보동",
      latitude: center.latitude + candidate.distanceMeters / 111_195,
      longitude: center.longitude + (candidate.longitudeMeters ?? 0)
        / (111_195 * Math.cos(center.latitude * Math.PI / 180)),
      searchText: "백반",
      createdAt: now,
      updatedAt: now,
    })));
    await db.insert(placeCategories).values(chunk.map((candidate) => ({
      placeId: candidate.id,
      categoryId,
      isPrimary: true,
    })));
    await db.insert(ratingSnapshots).values(chunk.map((candidate, index) => ({
      id: `density-snapshot-${suffix}-${offset + index}`,
      placeId: candidate.id,
      configId: "rating-config-v2",
      inputHash: `${suffix}-${offset + index}`,
      overallScore: candidate.ratingScore,
      userScore: candidate.ratingScore,
      reviewerScore: candidate.ratingScore,
      overallSampleCount: candidate.ratingSampleCount,
      userSampleCount: candidate.ratingSampleCount,
      reviewerSampleCount: candidate.ratingSampleCount,
      reviewerRawWeight: candidate.ratingSampleCount,
      reviewerCombinedWeight: candidate.ratingSampleCount,
      reviewerWeightShare: .5,
      reasonsJson: "{}",
      isStale: false,
      computedAt: now,
      createdAt: now,
      updatedAt: now,
    })));
  }

  const request = (overrides: Partial<HomeCurationRequest> = {}): HomeCurationRequest => ({
    bbox: [center.longitude - .001, center.latitude - .001, center.longitude + .001, center.latitude + .001],
    center,
    mode: "now",
    now,
    history: {
      sessionSeed: "density-session",
      recentFirst: [],
      recentShown: [],
      previousMode: null,
      previousIds: [],
    },
    locationSource: "map_center",
    ...overrides,
  });

  return { candidates, db, request };
}

async function seedHomeCurationFixtures(input: { farTail: boolean; fixed?: { id: string; latitude: number } }) {
  const db = createDb(env.DB);
  const suffix = input.fixed?.id ?? crypto.randomUUID();
  const now = "2026-08-11T03:00:00.000Z";
  const baseLatitude = input.fixed?.latitude ?? 34.2 + homeFixtureIndex * .2;
  homeFixtureIndex += 1;
  const userId = `home-user-${suffix}`;
  const reviewerId = `home-reviewer-${suffix}`;

  await db.insert(users).values([
    {
      id: userId,
      email: `${userId}@example.com`,
      displayName: "홈 사용자",
      role: "USER",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: reviewerId,
      email: `${reviewerId}@example.com`,
      displayName: "홈 리뷰어",
      role: "REVIEWER",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(userTasteBadges).values({
    userId,
    badgeId: "food-gukbap",
    source: "USER",
    score: 0.95,
    evidenceJson: "{}",
    createdAt: now,
    updatedAt: now,
  });

  const categoryIds = Array.from({ length: 6 }, (_, index) => `home-category-${suffix}-${index}`);
  await db.insert(categories).values(categoryIds.map((id, index) => ({
    id,
    slug: id,
    name: `홈 분류 ${index}`,
    emoji: "🍽️",
    isActive: true,
    sortOrder: index,
    createdAt: now,
    updatedAt: now,
  })));

  const placeIds = Array.from({ length: 6 }, (_, index) => `home-place-${suffix}-${index}`);
  await db.insert(places).values(placeIds.map((id, index) => ({
    id,
    slug: id,
    name: index === 0 ? "테스트 국밥" : `테스트 장소 ${index}`,
    status: "PUBLISHED" as const,
    address: "광주광역시 테스트",
    neighborhood: `테스트동-${index}`,
    searchText: index === 0 ? "국밥 백반" : index === 1 ? "점심 백반" : `새로운 메뉴 ${index}`,
    latitude: baseLatitude + (input.farTail && index >= 4 ? 0.036 : index * 0.002),
    longitude: 126.92,
    createdAt: now,
    updatedAt: now,
  })));
  await db.insert(placeCategories).values(placeIds.map((placeId, index) => ({
    placeId,
    categoryId: categoryIds[index]!,
    isPrimary: true,
  })));

  const snapshots = placeIds.map((placeId, index) => ({
    id: `home-snapshot-${suffix}-${index}`,
    placeId,
    configId: "rating-config-v2",
    inputHash: `${suffix}-${index}`,
    overallScore: 90 - index,
    userScore: 89 - index,
    reviewerScore: 92 - index,
    overallSampleCount: 20,
    userSampleCount: 15,
    reviewerSampleCount: 5,
    reviewerRawWeight: 5,
    reviewerCombinedWeight: 5,
    reviewerWeightShare: 0.25,
    reasonsJson: "{}",
    isStale: false,
    computedAt: now,
    createdAt: now,
    updatedAt: now,
  }));
  await db.insert(ratingSnapshots).values(snapshots.slice(0, 4));
  await db.insert(ratingSnapshots).values(snapshots.slice(4));
  await db.insert(goldenPickEvents).values({
    id: `home-golden-${suffix}`,
    reviewerUserId: reviewerId,
    placeId: placeIds[2]!,
    eventType: "GRANT",
    previousEventId: null,
    reason: null,
    effectiveAt: now,
    expiresAt: "2026-09-11T03:00:00.000Z",
    createdAt: now,
  });

  return {
    userId,
    reviewerId,
    placeIds,
    now,
    center: { latitude: baseLatitude, longitude: 126.92 },
    bbox: [126.85, baseLatitude - 0.06, 126.99, baseLatitude + 0.06] as [number, number, number, number],
  };
}

it("로그인 사용자의 현재 비추천 후보만 제외하고 익명 후보는 유지한다", async () => {
  const fixture = await seedHomeCurationFixtures({ farTail: false });
  const db = createDb(env.DB);
  const dislikedPlaceId = fixture.placeIds[0]!;
  const eventId = `home-dislike-${crypto.randomUUID()}`;
  await db.insert(voteEvents).values({
    id: eventId,
    placeId: dislikedPlaceId,
    userId: fixture.userId,
    value: -1,
    eventType: "CREATE",
    previousEventId: null,
    createdAt: fixture.now,
  });
  await db.insert(currentVotes).values({
    placeId: dislikedPlaceId,
    userId: fixture.userId,
    eventId,
    value: -1,
    updatedAt: fixture.now,
  });
  const request = {
    bbox: fixture.bbox,
    now: fixture.now,
  };

  const memberContext = await loadRecommendationCandidateContext(db, {
    ...request,
    userId: fixture.userId,
  });
  const anonymousContext = await loadRecommendationCandidateContext(db, request);

  expect(memberContext.dislikedPlaceIds).toEqual([dislikedPlaceId]);
  expect(memberContext.candidates.some((place) => place.id === dislikedPlaceId)).toBe(false);
  expect(anonymousContext.dislikedPlaceIds).toEqual([]);
  expect(anonymousContext.candidates.some((place) => place.id === dislikedPlaceId)).toBe(true);

  const memberPage = await getHomeCurationPage(db, {
    ...request,
    userId: fixture.userId,
    center: fixture.center,
    mode: "now",
  });
  expect(memberPage.candidateCount).toBe(5);
  expect(memberPage.places.some((place) => place.id === dislikedPlaceId)).toBe(false);
});

it("최신 평가 스냅샷의 전체·사용자·리뷰어 점수와 표본을 null·0 구분까지 모두 붙인다", async () => {
  const fixture = await seedHomeCurationFixtures({ farTail: false });
  const db = createDb(env.DB);
  const zeroSamplePlaceId = fixture.placeIds[0]!;
  await db.insert(ratingSnapshots).values({
    id: `home-snapshot-zero-${crypto.randomUUID()}`,
    placeId: zeroSamplePlaceId,
    configId: "rating-config-v2",
    inputHash: crypto.randomUUID(),
    overallScore: null,
    userScore: null,
    reviewerScore: null,
    overallSampleCount: 0,
    userSampleCount: 0,
    reviewerSampleCount: 0,
    reviewerRawWeight: 0,
    reviewerCombinedWeight: 0,
    reviewerWeightShare: 0,
    reasonsJson: "{}",
    isStale: false,
    computedAt: "2026-08-11T04:00:00.000Z",
    createdAt: "2026-08-11T04:00:00.000Z",
    updatedAt: "2026-08-11T04:00:00.000Z",
  });

  const context = await loadRecommendationCandidateContext(db, {
    bbox: fixture.bbox,
    now: fixture.now,
  });
  const populated = context.candidates.find((place) => place.id === fixture.placeIds[1]);
  const zeroSample = context.candidates.find((place) => place.id === zeroSamplePlaceId);

  expect(populated).toEqual(expect.objectContaining({
    ratingScore: 89,
    ratingSampleCount: 20,
    userRatingScore: 88,
    userRatingSampleCount: 15,
    reviewerRatingScore: 91,
    reviewerRatingSampleCount: 5,
  }));
  expect(zeroSample).toEqual(expect.objectContaining({
    ratingScore: null,
    ratingSampleCount: 0,
    userRatingScore: null,
    userRatingSampleCount: 0,
    reviewerRatingScore: null,
    reviewerRatingSampleCount: 0,
  }));
});

it("후보별 Golden 이력 요약과 기존 활성 Golden 정보를 함께 조립한다", async () => {
  const fixture = await seedHomeCurationFixtures({ farTail: false });

  const context = await loadRecommendationCandidateContext(createDb(env.DB), {
    userId: fixture.userId,
    bbox: fixture.bbox,
    now: fixture.now,
  });

  expect(context.goldenSummaries).toContainEqual({
    placeId: fixture.placeIds[2],
    active: true,
    activeStrength: 1,
    pastStrength: 0,
    reviewerUserId: fixture.reviewerId,
  });
  expect(context.goldenPicks).toContainEqual(expect.objectContaining({
    placeId: fixture.placeIds[2],
    reviewerUserId: fixture.reviewerId,
  }));
});

it("공개 후보와 평가·취향·Golden Pick을 결합해 Golden 추천을 반환한다", async () => {
  const fixture = await seedHomeCurationFixtures({ farTail: false });
  const page = await getHomeCurationPage(createDb(env.DB), {
    userId: fixture.userId,
    bbox: fixture.bbox,
    center: fixture.center,
    mode: "golden",
    now: fixture.now,
  });

  expect(page.status).toBe("READY");
  expect(page.radiusMeters).toBe(8_000);
  expect(page.candidateCount).toBe(6);
  expect(page.places).toHaveLength(5);
  expect(page.places.map((place) => place.rank)).toEqual([1, 2, 3, 4, 5]);
  expect(page.places.some((place) => place.isGoldenPick)).toBe(true);
  expect(page.goldenFallback).toBe(false);
  expect(page.notice).toBeNull();
});

it("모드별 홈 5곳 ID 순서와 공개 Page 계약을 유지한다", async () => {
  // Variation hashes place ID, center and history. Exact order needs fixed inputs
  // and a center outside the other fixtures' 34.2+ / 36+ latitude ranges.
  const fixture = await seedHomeCurationFixtures({ farTail: false, fixed: { id: "home-mode-order-contract-v1", latitude: 34 } });
  const expectedOrder = {
    now: [0, 3, 1, 2, 4],
    taste: [0, 3, 1, 5, 2],
    time: [1, 4, 0, 2, 3],
    discovery: [2, 5, 3, 4, 1],
    golden: [2, 5, 0, 3, 4],
  } as const;
  for (const mode of ["now", "taste", "time", "discovery", "golden"] as const) {
    const page = await getHomeCurationPage(createDb(env.DB), {
      userId: fixture.userId,
      bbox: fixture.bbox,
      center: fixture.center,
      mode,
      now: fixture.now,
      history: { sessionSeed: "home-mode-order-contract-v1", recentFirst: [], recentShown: [], previousMode: null, previousIds: [] },
    });
    expect(page.places.map((place) => fixture.placeIds.indexOf(place.id))).toEqual(expectedOrder[mode]);
    expect(page.algorithmVersion).toBe("home-curation-v2");
    expect(Object.keys(page).sort()).toEqual([
      "algorithmVersion",
      "candidateCount",
      "goldenFallback",
      "mode",
      "notice",
      "places",
      "radiusMeters",
      "status",
      "timeSlot",
    ]);
  }
});

it("8km에도 20곳 미만이면 존재하는 품질 후보만 사용하고 거리를 붙인다", async () => {
  const fixture = await seedHomeCurationFixtures({ farTail: true });
  const page = await getHomeCurationPage(createDb(env.DB), {
    userId: fixture.userId,
    bbox: fixture.bbox,
    center: fixture.center,
    mode: "now",
    now: fixture.now,
  });

  expect(page.radiusMeters).toBe(8_000);
  expect(page.candidateCount).toBe(6);
  expect(page.places).toHaveLength(5);
  expect(page.places.every((place) => (place.distanceMeters ?? Infinity) <= 8_000)).toBe(true);
});

it.each([
  [21, 0, 0, 3_000],
  [10, 12, 0, 5_000],
  [10, 8, 7, 8_000],
] as const)(
  "3/5/8km 후보 밀도로 반경을 결정한다 (%i, %i, %i)",
  async (within3, within5Extra, within8Extra, expected) => {
    const fixture = await seedConcentricCandidates({ within3, within5Extra, within8Extra });

    const page = await getHomeCurationPage(fixture.db, fixture.request());

    expect(page.radiusMeters).toBe(expected);
    expect(page.candidateCount).toBe(within3 + within5Extra + (expected === 8_000 ? within8Extra : 0));
  },
);

it("품질 하한과 실제 8km 거리를 적용하되 소표본 후보는 유지한다", async () => {
  const fixture = await seedConcentricCandidates({
    within3: 3,
    within5Extra: 2,
    within8Extra: 1,
    qualityExtras: true,
  });

  const page = await getHomeCurationPage(fixture.db, fixture.request());

  expect(page.radiusMeters).toBe(8_000);
  expect(page.candidateCount).toBe(7);
  expect(page.places.some((place) => place.id.endsWith("-mature-low"))).toBe(false);
  expect(page.places.some((place) => place.id.endsWith("-outside-eight"))).toBe(false);
});

it("v2 메타데이터와 Golden fallback notice를 반환한다", async () => {
  const fixture = await seedConcentricCandidates({ within3: 3, within5Extra: 2, within8Extra: 1 });

  const page = await getHomeCurationPage(fixture.db, fixture.request({ mode: "golden" }));

  expect(page).toEqual(expect.objectContaining({
    algorithmVersion: "home-curation-v2",
    radiusMeters: 8_000,
    candidateCount: 6,
    goldenFallback: true,
    notice: GOLDEN_FALLBACK_NOTICE,
  }));
});

it("history와 위치 출처를 랭킹에 전달한다", async () => {
  const fixture = await seedConcentricCandidates({ within3: 21, within5Extra: 0, within8Extra: 0 });

  const initialPage = await getHomeCurationPage(fixture.db, fixture.request({
    locationSource: "gps",
    history: {
      sessionSeed: "gps-session",
      recentFirst: [],
      recentShown: [],
      previousMode: null,
      previousIds: [],
    },
  }));
  const repeatedPage = await getHomeCurationPage(fixture.db, fixture.request({
    locationSource: "gps",
    history: {
      sessionSeed: "gps-session",
      recentFirst: [initialPage.places[0]!.id],
      recentShown: [],
      previousMode: "now",
      previousIds: initialPage.places.map((place) => place.id),
    },
  }));

  expect(repeatedPage.places[0]!.id).not.toBe(initialPage.places[0]!.id);
  expect(repeatedPage.places.some((place) => place.recommendationReasons.includes("현재 위치에서 가까워요"))).toBe(true);
});
