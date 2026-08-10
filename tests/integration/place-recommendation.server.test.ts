import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { categories, goldenPickEvents, placeCategories, places, ratingSnapshots, userTasteBadges, users } from "../../app/db/schema";
import { getPlaceRecommendationPage } from "../../app/features/places/place-recommendation.server";

describe("place recommendation server", () => {
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
    await db.insert(ratingSnapshots).values({
      id: `recommend-snapshot-${suffix}`, placeId: trustedId, configId: "rating-config-v2", inputHash: suffix,
      overallScore: 91, userScore: 90, reviewerScore: 94, overallSampleCount: 42, userSampleCount: 32, reviewerSampleCount: 10,
      reviewerRawWeight: 10, reviewerCombinedWeight: 10, reviewerWeightShare: 0.24, reasonsJson: "{}", isStale: false,
      computedAt: now, createdAt: now, updatedAt: now,
    });
    await db.insert(goldenPickEvents).values({
      id: `recommend-golden-event-${suffix}`, reviewerUserId: reviewerId, placeId: goldenId, eventType: "GRANT",
      previousEventId: null, reason: null, effectiveAt: now, expiresAt: "2026-09-09T00:00:00.000Z", createdAt: now,
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
