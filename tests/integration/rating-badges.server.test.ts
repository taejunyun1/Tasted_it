import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { categories, currentVotes, integrityCases, placeCategories, placeDailyMetrics, places, ratingSnapshots, users, voteEvents } from "../../app/db/schema";
import { getHiddenGemStatus, listReviewerHotTakes, recordPlaceDetailView } from "../../app/features/ratings/rating-badges.server";

describe("rating badge operations", () => {
  it("records daily detail views and derives Hidden Gem from category-neighborhood exposure", async () => {
    const db = createDb(env.DB); const prefix = `badge-${crypto.randomUUID()}`; const now = "2026-08-06T12:00:00.000Z";
    const categoryId = `${prefix}-category`; await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "한식", emoji: "🍚", sortOrder: 1, createdAt: now, updatedAt: now });
    for (const [index, views] of [2, 10, 20].entries()) {
      const placeId = `${prefix}-place-${index}`;
      await db.insert(places).values({ id: placeId, slug: placeId, name: placeId, status: "PUBLISHED", address: "광주 동명동", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: placeId, createdAt: now, updatedAt: now });
      await db.insert(placeCategories).values({ placeId, categoryId, isPrimary: true, createdAt: now });
      await db.insert(placeDailyMetrics).values({ placeId, metricDate: "2026-08-06", detailViews: views, directionClicks: 0, saveActions: 0 });
    }
    await recordPlaceDetailView(db, { placeId: `${prefix}-place-0`, now });
    await db.insert(ratingSnapshots).values({ id: `${prefix}-snapshot`, placeId: `${prefix}-place-0`, configId: "rating-config-v2", inputHash: prefix, overallScore: 80, userScore: 78, reviewerScore: 85, overallSampleCount: 10, userSampleCount: 7, reviewerSampleCount: 3, reviewerRawWeight: 3, reviewerCombinedWeight: 3, reviewerWeightShare: 0.3, reasonsJson: "{}", isStale: false, computedAt: now, createdAt: now, updatedAt: now });
    const result = await getHiddenGemStatus(db, { placeId: `${prefix}-place-0`, now });
    expect(result).toMatchObject({ eligible: true, detailViews90d: 3, categoryRegionMedianViews90d: 10 });
  });

  it("identifies a reviewer vote opposed to five agreeing peers", async () => {
    const db = createDb(env.DB); const prefix = `hot-${crypto.randomUUID()}`; const now = "2026-08-06T12:00:00.000Z"; const placeId = `${prefix}-place`;
    await db.insert(places).values({ id: placeId, slug: placeId, name: placeId, status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: placeId, createdAt: now, updatedAt: now });
    const reviewerIds = Array.from({ length: 6 }, (_, index) => `${prefix}-reviewer-${index}`);
    for (const [index, userId] of reviewerIds.entries()) {
      const eventId = `${userId}-event`; await db.insert(users).values({ id: userId, email: `${userId}@example.com`, displayName: userId, role: "REVIEWER", createdAt: now, updatedAt: now });
      await db.insert(voteEvents).values({ id: eventId, placeId, userId, value: index === 0 ? -1 : 1, eventType: "CREATE", createdAt: now });
      await db.insert(currentVotes).values({ placeId, userId, eventId, value: index === 0 ? -1 : 1, updatedAt: now });
    }
    const result = await listReviewerHotTakes(db, reviewerIds[0]);
    expect(result.get(placeId)).toMatchObject({ eligible: true, peerCount: 5, peerAgreement: 1 });
  });
});
