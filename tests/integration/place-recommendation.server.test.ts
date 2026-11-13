import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { categories, goldenPickEvents, placeCategories, places, ratingSnapshots, reviewerVisitReviews, userTasteBadges, users } from "../../app/db/schema";
import { getPlaceRecommendationPage } from "../../app/features/places/place-recommendation.server";

import { publicationSnapshotStamp, seedApprovedReviewerVote } from "./reviewer-public-fixtures";
import { getPublicationEpoch } from "../../app/features/ratings/reviewer-publication.server";

describe("place recommendation server", () => {
  it("keeps exploration and diversity safeguards after service fallback", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const now = "2026-08-10T00:00:00.000Z";
    const categoryIds = Array.from({ length: 4 }, (_, index) => `recommend-final-category-${suffix}-${index}`);
    await db.insert(categories).values(categoryIds.map((id, index) => ({
      id,
      slug: id,
      name: `최종 추천 분류 ${index}`,
      emoji: "🍽️",
      isActive: true,
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
    })));

    const trustedExplorationIds = Array.from({ length: 8 }, (_, index) => `recommend-final-trusted-${suffix}-${index}`);
    const preferredFamiliarIds = Array.from({ length: 7 }, (_, index) => `recommend-final-preferred-${suffix}-${index}`);
    await db.insert(places).values(trustedExplorationIds.map((id, index) => ({
      id,
      slug: id,
      name: `탐색 메뉴 ${index}`,
      status: "PUBLISHED" as const,
      address: "격리 테스트",
      neighborhood: index === 0 ? "공통동" : `탐색동-${index}`,
      latitude: 34.05 + index * 0.001,
      longitude: 125.05,
      searchText: `새로운 메뉴 ${index}`,
      createdAt: now,
      updatedAt: now,
    })));
    await db.insert(places).values(preferredFamiliarIds.map((id, index) => ({
      id,
      slug: id,
      name: `선호 국밥 ${index}`,
      status: "PUBLISHED" as const,
      address: "격리 테스트",
      neighborhood: index < 2 ? "공통동" : `선호동-${index}`,
      latitude: 34.06 + index * 0.001,
      longitude: 125.05,
      searchText: `국밥 ${index}`,
      createdAt: now,
      updatedAt: now,
    })));
    await db.insert(placeCategories).values([
      ...trustedExplorationIds.map((placeId, index) => ({
        placeId,
        categoryId: index === 0 ? categoryIds[0]! : categoryIds[3]!,
        isPrimary: true,
      })),
      ...preferredFamiliarIds.map((placeId, index) => ({
        placeId,
        categoryId: categoryIds[index < 3 ? 0 : index < 5 ? 1 : 2]!,
        isPrimary: true,
      })),
    ]);
    const snapshotEpoch = await getPublicationEpoch(db);
    const snapshotValues = trustedExplorationIds.map((placeId, index) => ({
      id: `recommend-final-snapshot-${suffix}-${index}`,
      moderationEpoch: snapshotEpoch, voteRevision: 0,
      placeId,
      configId: "rating-config-v2",
      inputHash: `${suffix}-${index}`,
      overallScore: 99 - index,
      userScore: 99 - index,
      reviewerScore: 99 - index,
      overallSampleCount: 50,
      userSampleCount: 40,
      reviewerSampleCount: 10,
      reviewerRawWeight: 10,
      reviewerCombinedWeight: 10,
      reviewerWeightShare: 0.2,
      reasonsJson: "{}",
      isStale: false,
      computedAt: now,
      createdAt: now,
      updatedAt: now,
    }));
    await db.insert(ratingSnapshots).values(snapshotValues.slice(0, 4));
    await db.insert(ratingSnapshots).values(snapshotValues.slice(4));

    const result = await getPlaceRecommendationPage(db, {
      userId: null,
      tasteBadgeIds: ["food-gukbap"],
      bbox: [125.0, 34.0, 125.1, 34.1],
      center: { latitude: 34.05, longitude: 125.05 },
      selectedBadges: [],
      now,
      limit: 8,
    });

    expect(result.personal).toHaveLength(8);
    expect(result.personal.filter((place) => place.discoveryMode === "EXPLORATION").length)
      .toBeGreaterThanOrEqual(2);
    const categoryCounts = result.personal.reduce(
      (counts, place) => counts.set(place.primaryCategory.slug, (counts.get(place.primaryCategory.slug) ?? 0) + 1),
      new Map<string, number>(),
    );
    const neighborhoodCounts = result.personal.reduce(
      (counts, place) => counts.set(place.neighborhood, (counts.get(place.neighborhood) ?? 0) + 1),
      new Map<string, number>(),
    );
    expect(Math.max(...categoryCounts.values())).toBeLessThanOrEqual(3);
    expect(Math.max(...neighborhoodCounts.values())).toBeLessThanOrEqual(2);
    expect(result.personal.map((place) => (
      trustedExplorationIds.indexOf(place.id) >= 0
        ? `T${trustedExplorationIds.indexOf(place.id)}`
        : `P${preferredFamiliarIds.indexOf(place.id)}`
    ))).toEqual(["T0", "T1", "P0", "P2", "P3", "P4", "P5", "P6"]);
    expect(result.trusted.map((place) => trustedExplorationIds.indexOf(place.id)))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.golden).toEqual([]);
    expect(Object.keys(result).sort()).toEqual([
      "chips",
      "golden",
      "personal",
      "selectedBadges",
      "title",
      "trusted",
    ]);
  });

  it("uses guest taste badge ids without a member id", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const now = "2026-08-10T00:00:00.000Z";
    const activeCategories = await db.select().from(categories).where(eq(categories.isActive, true)).limit(4);
    expect(activeCategories).toHaveLength(4);
    const guestPlaceIds = Array.from({ length: 8 }, (_, index) => `recommend-guest-${suffix}-${index}`);
    await db.insert(places).values(guestPlaceIds.map((id, index) => ({
      id,
      slug: id,
      name: index < 3 ? `비회원 국밥 ${index}` : `비회원 탐색 ${index}`,
      status: "PUBLISHED" as const,
      address: "광주",
      neighborhood: `추천동-${index % 4}`,
      latitude: 35.14 + index * 0.001,
      longitude: 126.89 + index * 0.001,
      searchText: index < 3 ? "국밥 노포" : `새로운 메뉴 ${index}`,
      createdAt: now,
      updatedAt: now,
    })));
    await db.insert(placeCategories).values(guestPlaceIds.map((placeId, index) => ({
      placeId,
      categoryId: activeCategories[index % activeCategories.length]!.id,
      isPrimary: true,
    })));

    const result = await getPlaceRecommendationPage(db, {
      userId: null,
      tasteBadgeIds: ["food-gukbap", "style-old-school"],
      bbox: [126.8, 35.0, 127.0, 35.3],
      center: { latitude: 35.15, longitude: 126.9 },
      selectedBadges: [],
      now,
      limit: 8,
    });

    expect(result.chips.some((chip) => chip.id === "food-gukbap")).toBe(true);
    expect(result.chips.slice(0, 2).map((chip) => chip.id)).toEqual(["food-gukbap", "style-old-school"]);
    expect(result.personal).toHaveLength(8);
  });

  it("carries stored source and score into ranking so direct USER taste outranks equal INFERRED taste", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const now = "2026-08-10T00:00:00.000Z";
    const [category] = await db.select().from(categories).where(eq(categories.isActive, true)).limit(1);
    expect(category).toBeTruthy();
    const userId = `recommend-strength-user-${suffix}`;
    const directPlaceId = `recommend-strength-direct-${suffix}`;
    const inferredPlaceId = `recommend-strength-inferred-${suffix}`;
    await db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "추천 강도 사용자",
      role: "USER",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(places).values([
      {
        id: directPlaceId,
        slug: directPlaceId,
        name: "하 직접 국밥",
        status: "PUBLISHED",
        address: "격리 추천",
        neighborhood: "직접동",
        latitude: 34.5,
        longitude: 125.5,
        searchText: "국밥",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: inferredPlaceId,
        slug: inferredPlaceId,
        name: "가 추론 라멘",
        status: "PUBLISHED",
        address: "격리 추천",
        neighborhood: "추론동",
        latitude: 34.5,
        longitude: 125.5,
        searchText: "라멘",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(placeCategories).values([
      { placeId: directPlaceId, categoryId: category!.id, isPrimary: true },
      { placeId: inferredPlaceId, categoryId: category!.id, isPrimary: true },
    ]);
    await env.DB.prepare("INSERT INTO taste_learning_states(user_id,version_token,created_at,updated_at) VALUES(?,?,?,?)").bind(userId,"ranking-inference-token",now,now).run();
    await db.insert(userTasteBadges).values([
      { userId, badgeId: "food-gukbap", source: "USER", score: 0.8, evidenceJson: "{}", createdAt: now, updatedAt: now },
      { userId, badgeId: "food-ramen", source: "INFERRED", score: 0.8, evidenceJson: JSON.stringify({ algorithm: "activity-v1", moderationEpoch: await getPublicationEpoch(db), versionToken:"ranking-inference-token" }), createdAt: now, updatedAt: now },
    ]);

    const result = await getPlaceRecommendationPage(db, {
      userId,
      bbox: [125.4, 34.4, 125.6, 34.6],
      center: { latitude: 34.5, longitude: 125.5 },
      selectedBadges: [],
      now,
      limit: 2,
    });

    expect(result.personal.map((place) => place.id)).toEqual([directPlaceId, inferredPlaceId]);
  });

  it("reuses stored taste, rating snapshots, and active Golden Picks", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const now = "2026-08-09T00:00:00.000Z";
    const [category] = await db.select().from(categories).where(eq(categories.isActive, true)).limit(1);
    expect(category).toBeTruthy();
    const userId = `recommend-user-${suffix}`;
    const reviewerId = `recommend-reviewer-${suffix}`;
    const trustedId = `recommend-trusted-${suffix}`;
    const goldenId = `recommend-golden-${suffix}`;
    await db.insert(users).values([
      { id: userId, email: `${userId}@example.com`, displayName: "취향 사용자", role: "USER", createdAt: now, updatedAt: now },
      { id: reviewerId, email: `${reviewerId}@example.com`, displayName: "리뷰어", role: "REVIEWER", createdAt: now, updatedAt: now },
    ]);
    await db.insert(userTasteBadges).values({ userId, badgeId: "food-gukbap", source: "USER", score: 0.95, evidenceJson: "{}", createdAt: now, updatedAt: now });
    await db.insert(places).values([
      { id: trustedId, slug: trustedId, name: "평가가 쌓인 국밥", status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: "국밥", createdAt: now, updatedAt: now },
      { id: goldenId, slug: goldenId, name: "리뷰어의 라멘", status: "PUBLISHED", address: "광주", neighborhood: "충장동", latitude: 35.151, longitude: 126.921, searchText: "라멘", createdAt: now, updatedAt: now },
    ]);
    await db.insert(placeCategories).values([
      { placeId: trustedId, categoryId: category.id, isPrimary: true },
      { placeId: goldenId, categoryId: category.id, isPrimary: true },
    ]);
    const {reviewId: goldenReviewId} = await seedApprovedReviewerVote(db,{reviewerId,placeId:goldenId,eventId:`recommend-golden-review-${suffix}`,value:1,now,projectVote:false,withPhoto:true});
    await db.insert(goldenPickEvents).values({
      id: `recommend-golden-event-${suffix}`, reviewId:goldenReviewId, reviewVersion:1, reviewerUserId: reviewerId, placeId: goldenId, eventType: "GRANT",
      previousEventId: null, reason: null, effectiveAt: now, expiresAt: "2026-09-09T00:00:00.000Z", createdAt: now,
    });
    await db.update(reviewerVisitReviews).set({goldenRequested:true,goldenPickEventId:`recommend-golden-event-${suffix}`}).where(eq(reviewerVisitReviews.id,goldenReviewId));
    await db.insert(ratingSnapshots).values({
      ...(await publicationSnapshotStamp(db,trustedId)), id: `recommend-snapshot-${suffix}`, placeId: trustedId, configId: "rating-config-v2", inputHash: suffix,
      overallScore: 91, userScore: 90, reviewerScore: 94, overallSampleCount: 42, userSampleCount: 32, reviewerSampleCount: 10,
      reviewerRawWeight: 10, reviewerCombinedWeight: 10, reviewerWeightShare: 0.24, reasonsJson: "{}", isStale: false,
      computedAt: now, createdAt: now, updatedAt: now,
    });

    const result = await getPlaceRecommendationPage(db, {
      userId,
      bbox: [126.8, 35.0, 127.1, 35.3],
      center: { latitude: 35.15, longitude: 126.92 },
      selectedBadges: ["food-gukbap"],
      now,
      limit: 8,
    });

    expect(result.chips.map((chip) => chip.id)).toContain("food-gukbap");
    expect(result.trusted[0]).toMatchObject({ id: trustedId, ratingScore: 91, ratingSampleCount: 42 });
    expect(result.golden[0]).toMatchObject({ id: goldenId, reviewerUserId: reviewerId });
  });
});
