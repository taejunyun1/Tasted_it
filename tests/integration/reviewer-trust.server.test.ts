import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { currentVotes, places, reviewerReliabilitySnapshots, reviewerSimilarityEdges, users, voteEvents } from "../../app/db/schema";
import { refreshReviewerTrust } from "../../app/features/ratings/reviewer-trust.server";

describe("reviewer trust refresh", () => {
  it("derives reliability and similarity from active role-separated votes", async () => {
    const db = createDb(env.DB); const prefix = `trust-${crypto.randomUUID()}`; const now = "2026-08-06T12:00:00.000Z";
    const reviewerIds = [`${prefix}-reviewer-a`, `${prefix}-reviewer-b`];
    await db.insert(users).values(reviewerIds.map((id) => ({ id, email: `${id}@example.com`, displayName: id, role: "REVIEWER" as const, createdAt: now, updatedAt: now })));
    for (let placeIndex = 0; placeIndex < 10; placeIndex += 1) {
      const placeId = `${prefix}-place-${placeIndex}`;
      await db.insert(places).values({ id: placeId, slug: placeId, name: placeId, status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: placeId, createdAt: now, updatedAt: now });
      for (let userIndex = 0; userIndex < 8; userIndex += 1) {
        const userId = `${prefix}-user-${placeIndex}-${userIndex}`; const eventId = `${userId}-event`;
        await db.insert(users).values({ id: userId, email: `${userId}@example.com`, displayName: userId, role: "USER", createdAt: now, updatedAt: now });
        await db.insert(voteEvents).values({ id: eventId, placeId, userId, value: 1, eventType: "CREATE", createdAt: now });
        await db.insert(currentVotes).values({ placeId, userId, eventId, value: 1, updatedAt: now });
      }
      for (const [reviewerIndex, reviewerId] of reviewerIds.entries()) {
        const eventId = `${prefix}-reviewer-event-${placeIndex}-${reviewerIndex}`;
        const value = reviewerIndex === 1 && placeIndex === 9 ? -1 : 1;
        await db.insert(voteEvents).values({ id: eventId, placeId, userId: reviewerId, value, eventType: "CREATE", createdAt: now });
        await db.insert(currentVotes).values({ placeId, userId: reviewerId, eventId, value, updatedAt: now });
      }
    }
    const result = await refreshReviewerTrust(db, { now });
    expect(result).toMatchObject({ reviewers: 2, similarityClusters: 1, similarityEdges: 1 });
    const reliability = await db.select().from(reviewerReliabilitySnapshots);
    expect(reliability.filter((row) => reviewerIds.includes(row.reviewerUserId))).toEqual(expect.arrayContaining([
      expect.objectContaining({ eligibleCount: 10, correctCount: 10, calibrationStatus: "ACTIVE" }),
      expect.objectContaining({ eligibleCount: 10, correctCount: 9, calibrationStatus: "ACTIVE" }),
    ]));
    expect((await db.select().from(reviewerSimilarityEdges)).some((edge) => edge.overlapCount === 10 && edge.agreementRate === 0.9)).toBe(true);
    const repeated = await refreshReviewerTrust(db, { now: "2026-08-06T12:05:00.000Z" });
    expect(repeated.changedPlaces).toBe(0);
    expect((await db.select().from(reviewerReliabilitySnapshots)).filter((row) => reviewerIds.includes(row.reviewerUserId))).toHaveLength(2);
  });
});
