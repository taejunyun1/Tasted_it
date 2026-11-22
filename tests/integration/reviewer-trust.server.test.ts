import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { currentVotes, places, ratingSnapshots, reviewerReliabilitySnapshots, reviewerSimilarityEdges, users, voteEvents } from "../../app/db/schema";
import { refreshReviewerTrust } from "../../app/features/ratings/reviewer-trust.server";
import { enqueueRatingRecompute, getLatestRatingSnapshot, processRatingJob, recomputePlaceRating } from "../../app/features/ratings/recompute.server";
import { getPublicationEpoch, getPlaceVoteRevision } from "../../app/features/ratings/reviewer-publication.server";
import { castVote } from "../../app/features/ratings/vote.server";

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

  it.each(["2026-08-06T12:20:00.000Z", "2026-08-06T12:10:00.000Z"])(
    "restores the prior trust input and an independent public rating at %s", async (restoredAt) => {
      const db = createDb(env.DB);
      const prefix = `returning-trust-${crypto.randomUUID()}`;
      const firstAt = "2026-08-06T12:00:00.000Z";
      const changedAt = "2026-08-06T12:10:00.000Z";
      const reviewerId = `${prefix}-reviewer`;
      const voters = Array.from({ length: 8 }, (_, index) => `${prefix}-voter-${index}`);
      const placeIds = Array.from({ length: 6 }, (_, index) => `${prefix}-place-${index}`);
      const target = placeIds[5]!;
      await db.insert(users).values([reviewerId, ...voters].map(id => ({
        id, email: `${id}@example.test`, displayName: id, role: id === reviewerId ? "REVIEWER" as const : "USER" as const,
        createdAt: firstAt, updatedAt: firstAt,
      })));
      for (const placeId of placeIds) {
        await db.insert(places).values({ id: placeId, slug: placeId, name: placeId, status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: placeId, createdAt: firstAt, updatedAt: firstAt });
        for (const [index, userId] of voters.entries()) {
          const eventId = `${placeId}-${userId}-initial`;
          // Five venues establish consensus. The independent sixth venue stays tied.
          const value = placeId === target && index < 4 ? -1 : 1;
          await db.insert(voteEvents).values({ id: eventId, placeId, userId, value, eventType: "CREATE", createdAt: firstAt });
          await db.insert(currentVotes).values({ placeId, userId, eventId, value, updatedAt: firstAt });
        }
        await seedApprovedReviewerVote(db, { reviewerId, placeId, eventId: `${placeId}-review`, value: 1, now: firstAt });
      }
      const initialEpoch = await getPublicationEpoch(db);
      const initialTargetRevision = await getPlaceVoteRevision(db, target);
      const readTrust = () => db.select().from(reviewerReliabilitySnapshots).where(eq(reviewerReliabilitySnapshots.reviewerUserId, reviewerId));
      const changeMajority = async (value: -1 | 1, step: string, now: string, comparisonCount = 5) => {
        for (const placeId of placeIds.slice(0, comparisonCount)) {
          for (const userId of voters.slice(0, 5)) await castVote(db, { placeId, userId, value, eventId: `${placeId}-${userId}-${step}`, now });
        }
      };

      await refreshReviewerTrust(db, { now: firstAt });
      const [firstTrust] = await readTrust();
      expect(firstTrust).toMatchObject({ eligibleCount: 5, correctCount: 5, computedAt: firstAt });
      const initialSnapshot = await recomputePlaceRating(db, { placeId: target, now: firstAt });
      expect(initialSnapshot.overallScore).toBe(55);

      await changeMajority(-1, "wrong", changedAt);
      expect((await refreshReviewerTrust(db, { now: changedAt })).changedPlaces).toBeGreaterThanOrEqual(6);
      expect(await getLatestRatingSnapshot(db, target, changedAt)).toBeUndefined();
      const [changedTrust] = (await readTrust()).filter(row => row.correctCount === 0);
      expect(changedTrust).toMatchObject({ eligibleCount: 5, correctCount: 0, computedAt: changedAt });
      expect((await recomputePlaceRating(db, { placeId: target, now: changedAt })).overallScore).toBe(53);

      await changeMajority(1, "restored", restoredAt);
      const reactivated = await refreshReviewerTrust(db, { now: restoredAt });
      const targetBeforeRecompute = await getLatestRatingSnapshot(db, target, restoredAt);
      expect(await recomputePlaceRating(db, { placeId: target, now: restoredAt })).toMatchObject({ id: initialSnapshot.id, overallScore: 55, isStale: false });
      expect(reactivated.changedPlaces).toBe(6);
      expect(targetBeforeRecompute).toBeUndefined();
      expect(await getPublicationEpoch(db)).toBe(initialEpoch);
      expect(await getPlaceVoteRevision(db, target)).toBe(initialTargetRevision);
      const after = await readTrust();
      expect(after).toHaveLength(2);
      expect(after.find(row => row.id === firstTrust!.id)).toMatchObject({ correctCount: 5, computedAt: restoredAt });
      expect(after.find(row => row.id === changedTrust!.id)).toEqual(changedTrust);

      const repeatedAt = "2026-08-06T12:30:00.000Z";
      expect((await refreshReviewerTrust(db, { now: repeatedAt })).changedPlaces).toBe(0);
      expect(await readTrust()).toEqual(after);
      expect(await getLatestRatingSnapshot(db, target, repeatedAt)).toMatchObject({ id: initialSnapshot.id, overallScore: 55, isStale: false });

      const inFlightAt = "2026-08-06T12:40:00.000Z";
      const newerAt = "2026-08-06T12:41:00.000Z";
      await changeMajority(-1, "in-flight-wrong", inFlightAt, 1);
      await refreshReviewerTrust(db, { now: inFlightAt });
      const job = await enqueueRatingRecompute(db, { placeId: target, reason: "REVIEWER_TRUST_REFRESH", now: inFlightAt });
      const racingDb = createDb(env.DB);
      const insertSnapshot = racingDb.batch.bind(racingDb);
      const race = vi.spyOn(racingDb, "batch").mockImplementationOnce(async (...writes) => {
        await changeMajority(1, "in-flight-restored", newerAt, 1);
        await refreshReviewerTrust(db, { now: newerAt });
        return insertSnapshot(...writes);
      });
      try {
        expect(await processRatingJob(racingDb, { jobId: job.id, placeId: target, configId: job.configId, now: inFlightAt }))
          .toMatchObject({ status: "PENDING", claimed: true, job: { attempts: 1, errorSummary: "RATING_REVIEWER_TRUST_CHANGED" } });
      } finally {
        race.mockRestore();
      }
      expect(await getLatestRatingSnapshot(db, target, newerAt)).toBeUndefined();
      expect(await processRatingJob(db, { jobId: job.id, placeId: target, configId: job.configId, now: newerAt }))
        .toMatchObject({ status: "COMPLETED", claimed: true, job: { attempts: 2 } });
      expect(await getLatestRatingSnapshot(db, target, newerAt)).toMatchObject({ id: initialSnapshot.id, overallScore: 55 });
      expect(await db.select().from(ratingSnapshots).where(eq(ratingSnapshots.placeId, target))).toHaveLength(2);
    },
  );
});
