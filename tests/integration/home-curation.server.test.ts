import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

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
import { getHomeCurationPage } from "../../app/features/places/home-curation.server";
import { loadRecommendationCandidateContext } from "../../app/features/places/recommendation-candidates.server";

async function seedHomeCurationFixtures(input: { farTail: boolean }) {
  const db = createDb(env.DB);
  const suffix = crypto.randomUUID();
  const now = "2026-08-11T03:00:00.000Z";
  const baseLatitude = input.farTail ? 34.8 : 35.15;
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

it("공개 후보와 평가·취향·Golden Pick을 결합해 3km 추천을 반환한다", async () => {
  const fixture = await seedHomeCurationFixtures({ farTail: false });
  const page = await getHomeCurationPage(createDb(env.DB), {
    userId: fixture.userId,
    bbox: fixture.bbox,
    center: fixture.center,
    mode: "now",
    now: fixture.now,
  });

  expect(page.status).toBe("READY");
  expect(page.radiusMeters).toBe(3_000);
  expect(page.places).toHaveLength(5);
  expect(page.places.map((place) => place.rank)).toEqual([1, 2, 3, 4, 5]);
  expect(page.places.some((place) => place.isGoldenPick)).toBe(true);
});

it("3km 후보가 부족하면 5km로 한 번만 확장한다", async () => {
  const fixture = await seedHomeCurationFixtures({ farTail: true });
  const page = await getHomeCurationPage(createDb(env.DB), {
    userId: fixture.userId,
    bbox: fixture.bbox,
    center: fixture.center,
    mode: "now",
    now: fixture.now,
  });

  expect(page.radiusMeters).toBe(5_000);
  expect(page.places).toHaveLength(5);
  expect(page.places.every((place) => (place.distanceMeters ?? Infinity) <= 5_000)).toBe(true);
});
