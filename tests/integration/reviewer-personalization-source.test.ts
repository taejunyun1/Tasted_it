import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { categories, currentVotes, placeCategories, places, reviewerVisitReviews, userTasteBadges, users, voteEvents } from "../../app/db/schema";
import { getMemberTasteProfile } from "../../app/features/members/profile-taste.server";
import { refreshInferredTasteSignals } from "../../app/features/members/taste-learning.server";
import { loadRecommendationCandidateContext } from "../../app/features/places/recommendation-candidates.server";
import { getPublicationEpoch } from "../../app/features/ratings/reviewer-publication.server";
import { seedApprovedReviewerVote } from "./reviewer-public-fixtures";

const now = "2026-11-13T00:00:00.000Z";
let userId: string;
let categoryId: string;
let sequence = 0;

beforeEach(async () => {
  const db = createDb(env.DB);
  userId = `personalization-${crypto.randomUUID()}`;
  categoryId = `${userId}-category`;
  sequence = 0;
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, displayName: "합성 리뷰어", role: "REVIEWER", createdAt: now, updatedAt: now });
  await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "라멘", emoji: "🍜", sortOrder: 1, isActive: true, createdAt: now, updatedAt: now });
});

async function createPlace() {
  const db = createDb(env.DB);
  const id = `${userId}-place-${sequence++}`;
  await db.insert(places).values({ id, slug: id, name: "합성 라멘", status: "PUBLISHED", address: "광주광역시 동구", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: id, createdAt: now, updatedAt: now });
  await db.insert(placeCategories).values({ placeId: id, categoryId, isPrimary: true });
  return id;
}

async function candidateContext() {
  return loadRecommendationCandidateContext(createDb(env.DB), { userId, bbox: [126.8, 35.0, 127, 35.2], categorySlug: categoryId, now, goldenContext: "omit", tasteBadgeIds: ["food-udon"] });
}

async function profile() {
  return getMemberTasteProfile(createDb(env.DB), { userId, displayName: "합성 리뷰어", saved: [], rated: [], tasteGraph: { status: "LEARNING", placeCount: 0, dimensions: [] } });
}

async function manualTaste() {
  await createDb(env.DB).insert(userTasteBadges).values({ userId, badgeId: "food-pizza", source: "USER", score: 0.9, evidenceJson: "{\"selected\":true}", createdAt: now, updatedAt: now });
}

describe("reviewer source isolation in personalization", () => {
  it("reserves the publication rule binding when loading more than one D1 chunk of dislikes", async () => {
    const db = createDb(env.DB);
    const ids: string[] = [];
    for (let index = 0; index < 101; index++) {
      const placeId = await createPlace();
      const eventId = `${placeId}-general`;
      ids.push(placeId);
      await db.insert(voteEvents).values({ id: eventId, userId, placeId, value: -1, eventType: "CREATE", source: "GENERAL", createdAt: now });
      await db.insert(currentVotes).values({ userId, placeId, eventId, value: -1, updatedAt: now });
    }
    const result = await candidateContext();
    expect(result.dislikedPlaceIds.sort()).toEqual(ids.sort());
    expect(result.candidates).toEqual([]);
  });

  it("keeps explicit GENERAL dislikes but excludes legacy and pending reviewer dislikes", async () => {
    const db = createDb(env.DB);
    const legacy = await createPlace();
    const pending = await createPlace();
    const general = await createPlace();
    for (const [placeId, source] of [[legacy, "LEGACY_REVIEWER"], [general, "GENERAL"]] as const) {
      const eventId = `${placeId}-event`;
      await db.insert(voteEvents).values({ id: eventId, userId, placeId, value: -1, eventType: "CREATE", source, createdAt: now });
      await db.insert(currentVotes).values({ userId, placeId, eventId, value: -1, updatedAt: now });
    }
    const { reviewId } = await seedApprovedReviewerVote(db, { reviewerId: userId, placeId: pending, eventId: `${pending}-event`, value: -1, now });
    await db.update(reviewerVisitReviews).set({ status: "PENDING", approvedContentVersion: null }).where(eq(reviewerVisitReviews.id, reviewId));

    const result = await candidateContext();
    expect(result.dislikedPlaceIds).toEqual([general]);
    expect(result.candidates.map(place => place.id).sort()).toEqual([legacy, pending].sort());
  });

  it("reads only current stamped INFERRED evidence while preserving manual and guest choices", async () => {
    const db = createDb(env.DB);
    const moderationEpoch = await getPublicationEpoch(db);
    await env.DB.prepare("INSERT INTO taste_learning_states(user_id,version_token,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET version_token=excluded.version_token").bind(userId,"current-test-token",now,now).run();
    await manualTaste();
    await db.insert(userTasteBadges).values([
      { userId, badgeId: "food-gukbap", source: "INFERRED", score: 0.9, evidenceJson: "{\"algorithm\":\"activity-v1\"}", createdAt: now, updatedAt: now },
      { userId, badgeId: "food-ramen", source: "INFERRED", score: 0.9, evidenceJson: "not-json", createdAt: now, updatedAt: now },
      { userId, badgeId: "food-sushi", source: "INFERRED", score: 0.9, evidenceJson: JSON.stringify({ algorithm: "activity-v1", moderationEpoch: moderationEpoch - 1 }), createdAt: now, updatedAt: now },
      { userId, badgeId: "food-soba", source: "INFERRED", score: 0.9, evidenceJson: JSON.stringify({ algorithm: "activity-v1", moderationEpoch,versionToken:"current-test-token" }), createdAt: now, updatedAt: now },
    ]);

    expect((await candidateContext()).tasteSignals.map(signal => signal.badgeId).sort()).toEqual(["food-pizza", "food-soba", "food-udon"].sort());
    expect((await profile()).vector.map(signal => signal.id).sort()).toEqual(["food-pizza", "food-soba"].sort());
    expect(await db.select().from(userTasteBadges).where(eq(userTasteBadges.userId, userId))).toHaveLength(5);
  });

  it("stops reading a formerly approved review's stored inference immediately after re-review", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace();
    const { reviewId } = await seedApprovedReviewerVote(db, { reviewerId: userId, placeId, eventId: `${placeId}-event`, value: 1, now });
    await manualTaste();
    await refreshInferredTasteSignals(db, userId, now);
    const before = await db.select().from(userTasteBadges).where(eq(userTasteBadges.userId, userId));
    const inferred = before.find(row => row.source === "INFERRED" && row.badgeId === "food-ramen");
    expect(inferred).toBeDefined();
    expect(JSON.parse(inferred!.evidenceJson!)).toEqual({ algorithm: "activity-v1", moderationEpoch: await getPublicationEpoch(db), versionToken: expect.any(String) });
    expect((await candidateContext()).tasteSignals.some(signal => signal.badgeId === "food-ramen")).toBe(true);

    await db.update(reviewerVisitReviews).set({ status: "CHANGES_REQUESTED", approvedContentVersion: null }).where(eq(reviewerVisitReviews.id, reviewId));

    expect((await candidateContext()).tasteSignals.map(signal => signal.badgeId).sort()).toEqual(["food-pizza", "food-udon"].sort());
    expect((await profile()).vector.map(signal => signal.id)).toEqual(["food-pizza"]);
    expect(await db.select().from(userTasteBadges).where(eq(userTasteBadges.userId, userId))).toEqual(before);
  });

  it("does not write inference from a snapshot invalidated by moderation during refresh", async () => {
    const db = createDb(env.DB);
    const placeId = await createPlace();
    const { reviewId } = await seedApprovedReviewerVote(db, { reviewerId: userId, placeId, eventId: `${placeId}-event`, value: 1, now });
    await manualTaste();

    await refreshInferredTasteSignals(db, userId, now, { afterSnapshot: async () => {
      await db.update(reviewerVisitReviews).set({ status: "PENDING", approvedContentVersion: null }).where(eq(reviewerVisitReviews.id, reviewId));
    } });

    expect((await db.select().from(userTasteBadges).where(eq(userTasteBadges.userId, userId))).map(row => row.source)).toEqual(["USER"]);
    expect((await candidateContext()).tasteSignals.map(signal => signal.badgeId).sort()).toEqual(["food-pizza", "food-udon"].sort());
  });
});
