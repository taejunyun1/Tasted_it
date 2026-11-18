import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { categories, currentVotes, placeCategories, places, ratingSnapshots, reviewerVisitReviews, users, voteEvents } from "../../app/db/schema";
import { getPlaceBySlug, listPlaces } from "../../app/features/places/place.server";
import { attachLatestNonStaleRatingSnapshots, recomputePlaceRating } from "../../app/features/ratings/recompute.server";
import { seedApprovedReviewerVote } from "./reviewer-public-fixtures";

const now = "2026-11-18T02:00:00.000Z";
async function seed() {
  const db = createDb(env.DB);
  const id = `public-summary-${crypto.randomUUID()}`;
  await db.insert(places).values({ id, slug: id, name: "평점 표시 합성 장소", status: "PUBLISHED", address: "합성 주소", neighborhood: "합성", latitude: 35.1, longitude: 126.9, searchText: id, createdAt: now, updatedAt: now });
  await db.insert(categories).values({ id, slug: id, name: "합성 분류", emoji: "", sortOrder: 1, isActive: true, createdAt: now, updatedAt: now });
  await db.insert(placeCategories).values({ placeId: id, categoryId: id, isPrimary: true });
  for (let index = 0; index < 7; index++) {
    const userId = `${id}-${index}`;
    await db.insert(users).values({ id: userId, email: `${userId}@example.test`, displayName: "합성 회원", role: "USER", createdAt: now, updatedAt: now });
    await db.insert(voteEvents).values({ id: userId, placeId: id, userId, value: 1, eventType: "CREATE", source: "GENERAL", createdAt: now });
    await db.insert(currentVotes).values({ placeId: id, userId, eventId: userId, value: 1, updatedAt: now });
  }
  return { db, id };
}

describe("public rating summary", () => {
  it("keeps eligible counts and the actual prior time while suppressing a revoked reviewer's stale score", async () => {
    const { db, id } = await seed();
    const reviewerId = `${id}-reviewer`;
    await db.insert(users).values({ id: reviewerId, email: `${reviewerId}@example.test`, displayName: "합성 리뷰어", role: "REVIEWER", createdAt: now, updatedAt: now });
    const { reviewId } = await seedApprovedReviewerVote(db, { reviewerId, placeId: id, eventId: reviewerId, value: 1, now });
    const snapshot = await recomputePlaceRating(db, { placeId: id, now });
    expect(snapshot.overallSampleCount).toBe(8);
    expect((await listPlaces(db, { query: id }))[0]).toMatchObject({ ratingScore: snapshot.overallScore, ratingSampleCount: 8, ratingIsStale: false, ratingComputedAt: now });

    await db.update(reviewerVisitReviews).set({ status: "PENDING", updatedAt: "2026-11-18T03:00:00.000Z" }).where(eq(reviewerVisitReviews.id, reviewId));
    const listing = (await listPlaces(db, { query: id }))[0];
    const detail = await getPlaceBySlug(db, id);
    for (const result of [listing, detail]) {
      expect(result).toMatchObject({ positive: 7, reviewerPositive: 0, ratingScore: null, ratingSampleCount: 7, userRatingSampleCount: 7, reviewerRatingSampleCount: 0, ratingIsStale: true, ratingComputedAt: now });
    }
    expect(await db.query.currentVotes.findFirst({ where: eq(currentVotes.eventId, reviewerId) })).toBeDefined();
  });

  it("represents eligible reactions without a snapshot as uncalculated rather than zero or a new timestamp", async () => {
    const { db, id } = await seed();
    expect(await getPlaceBySlug(db, id)).toMatchObject({ ratingScore: null, ratingSampleCount: 7, userRatingSampleCount: 7, reviewerRatingSampleCount: 0, ratingIsStale: true, ratingComputedAt: null });
  });

  it("keeps the current public result's own time when a newer stale snapshot exists", async () => {
    const { db, id } = await seed();
    const current = await recomputePlaceRating(db, { placeId: id, now });
    await db.insert(ratingSnapshots).values({ ...current, id: `${id}-stale`, inputHash: `${id}-stale`, overallScore: 99, isStale: true, computedAt: "2026-11-18T04:00:00.000Z" });
    for (const result of [(await listPlaces(db, { query: id }))[0], await getPlaceBySlug(db, id)]) {
      expect(result).toMatchObject({ ratingScore: current.overallScore, ratingSampleCount: 7, ratingIsStale: false, ratingComputedAt: now });
    }
  });

  it("loads 100 places in bounded batches without per-place metadata queries", async () => {
    const db = createDb(env.DB);
    const select = vi.spyOn(db, "select");
    const inputs = Array.from({ length: 100 }, (_, index) => ({ id: `no-snapshot-${index}`, positive: 9, negative: 3, userPositive: 9, userNegative: 3, reviewerPositive: 0, reviewerNegative: 0 }));
    const results = await attachLatestNonStaleRatingSnapshots(db, inputs);
    expect(results).toHaveLength(100);
    expect(results[99]).toMatchObject({ ratingScore: null, ratingSampleCount: 12, ratingIsStale: true, ratingComputedAt: null });
    expect(select.mock.calls.length).toBeLessThanOrEqual(4);
    select.mockRestore();
  });
});
