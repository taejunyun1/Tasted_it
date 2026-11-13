import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { currentVotes, places, ratingSnapshots, reviewerReliabilitySnapshots, reviewerSimilarityEdges, users, voteEvents } from "../../app/db/schema";
import { refreshReviewerTrust } from "../../app/features/ratings/reviewer-trust.server";
import { recomputePlaceRating } from "../../app/features/ratings/recompute.server";

import { seedApprovedReviewerVote } from "./reviewer-public-fixtures";

describe("reviewer trust refresh", () => {
  it("carries approved-source trust and damping into fixed rating snapshots without duplication", async () => {
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
        await seedApprovedReviewerVote(db, { reviewerId, placeId, eventId, value: value as -1 | 1, now });
      }
    }
    const result = await refreshReviewerTrust(db, { now });
    expect(result).toMatchObject({ reviewers: 2, similarityClusters: 1, similarityEdges: 1 });
    const reliability = await db.select().from(reviewerReliabilitySnapshots);
    expect(reliability.filter((row) => reviewerIds.includes(row.reviewerUserId))).toEqual(expect.arrayContaining([
      expect.objectContaining({ eligibleCount: 10, correctCount: 10, calibrationStatus: "ACTIVE" }),
      expect.objectContaining({ eligibleCount: 10, correctCount: 9, calibrationStatus: "ACTIVE" }),
    ]));
    const firstReviewer = reliability.find((row) => row.reviewerUserId === reviewerIds[0]);
    const secondReviewer = reliability.find((row) => row.reviewerUserId === reviewerIds[1]);
    expect(firstReviewer?.posteriorAccuracy).toBeCloseTo(0.8571428571428571, 8);
    expect(firstReviewer?.reliabilityWeight).toBeCloseTo(1.2857142857142858, 8);
    expect(secondReviewer?.posteriorAccuracy).toBeCloseTo(0.7857142857142857, 8);
    expect(secondReviewer?.reliabilityWeight).toBeCloseTo(1.2285714285714286, 8);
    const edge = (await db.select().from(reviewerSimilarityEdges)).find((row) =>
      row.leftReviewerUserId === reviewerIds[0] && row.rightReviewerUserId === reviewerIds[1]);
    expect(edge).toMatchObject({ overlapCount: 10, agreementRate: 0.9 });
    expect(edge?.damping).toBeCloseTo(0.7071067811865475, 8);
    const repeated = await refreshReviewerTrust(db, { now: "2026-08-06T12:05:00.000Z" });
    expect(repeated.changedPlaces).toBe(0);
    expect((await db.select().from(reviewerReliabilitySnapshots)).filter((row) => reviewerIds.includes(row.reviewerUserId))).toHaveLength(2);

    // Independent DEC-03 expectations are derived in the accompanying evidence.
    for (const [placeIndex, overallScore] of [[0, 85], [9, 79]] as const) {
      const placeId = `${prefix}-place-${placeIndex}`;
      const first = await recomputePlaceRating(db, { placeId, now });
      const second = await recomputePlaceRating(db, { placeId, now: "2026-08-06T12:10:00.000Z" });
      expect(first).toMatchObject({ overallSampleCount: 10, userSampleCount: 8, reviewerSampleCount: 2, overallScore, userScore: 83, reviewerScore: null });
      expect(first.reviewerRawWeight).toBeCloseTo(1.7778684784118908, 8);
      expect(first.reviewerCombinedWeight).toBeCloseTo(1.7778684784118908, 8);
      expect(second).toMatchObject({ id: first.id, inputHash: first.inputHash, overallScore, isStale: false });
      expect(await db.select().from(ratingSnapshots).where(eq(ratingSnapshots.placeId, placeId))).toHaveLength(1);
    }
  });
});
