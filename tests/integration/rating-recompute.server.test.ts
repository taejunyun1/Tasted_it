import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { currentVotes, integrityCases, invalidatedVoteEvents, places, ratingRecomputeJobs, ratingSnapshots, users, voteEvents } from "../../app/db/schema";
import { enqueueRatingRecompute, processRatingJobs, recomputePlaceRating } from "../../app/features/ratings/recompute.server";

const now = "2026-08-06T00:00:00.000Z";
const placeId = "rating-recompute-place";

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(places).values({
    id: placeId, slug: placeId, name: "재계산 장소", status: "PUBLISHED", address: "광주 동구",
    neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "재계산 장소", createdAt: now, updatedAt: now,
  }).onConflictDoNothing();
});

async function seedVotes() {
  const db = createDb(env.DB);
  for (let index = 0; index < 8; index += 1) {
    const userId = `rating-user-${index}`;
    const eventId = `rating-event-${index}`;
    await db.insert(users).values({
      id: userId, email: `${userId}@example.com`, displayName: userId,
      role: index < 6 ? "USER" : "REVIEWER", createdAt: now, updatedAt: now,
    }).onConflictDoNothing();
    await db.insert(voteEvents).values({ id: eventId, placeId, userId, value: index === 7 ? -1 : 1, eventType: "CREATE", createdAt: now }).onConflictDoNothing();
    await db.insert(currentVotes).values({ placeId, userId, eventId, value: index === 7 ? -1 : 1, updatedAt: now }).onConflictDoNothing();
  }
}

describe("rating recomputation", () => {
  it("writes a deterministic role-separated snapshot and reuses the same input", async () => {
    const db = createDb(env.DB);
    await seedVotes();

    const first = await recomputePlaceRating(db, { placeId, now });
    const second = await recomputePlaceRating(db, { placeId, now: "2026-08-06T00:01:00.000Z" });
    const rows = await db.select().from(ratingSnapshots);

    expect(first).toMatchObject({ overallSampleCount: 8, userSampleCount: 6, reviewerSampleCount: 2, overallScore: 75, userScore: null, reviewerScore: null, isStale: false });
    expect(first.inputHash).toBe(second.inputHash);
    expect(rows.filter((row) => row.placeId === placeId)).toHaveLength(1);
    expect(JSON.parse(first.reasonsJson)).toMatchObject({ algorithmVersion: "rating-v2.0" });
  });

  it("excludes an invalidated active vote without deleting its raw event", async () => {
    const db = createDb(env.DB);
    await seedVotes();
    await db.insert(integrityCases).values({
      id: "rating-case", signalType: "TEST", subjectType: "USER", subjectId: "rating-user-0",
      dedupeKey: "rating-case", status: "CONFIRMED", evidenceJson: "{}", createdAt: now, updatedAt: now,
    }).onConflictDoNothing();
    await db.insert(invalidatedVoteEvents).values({
      voteEventId: "rating-event-0", integrityCaseId: "rating-case", reason: "테스트 무효화",
      invalidatedAt: now,
    }).onConflictDoNothing();

    const snapshot = await recomputePlaceRating(db, { placeId, now });
    const raw = await db.select().from(voteEvents);

    expect(snapshot.overallSampleCount).toBe(7);
    expect(snapshot.overallScore).toBeNull();
    expect(raw.some((event) => event.id === "rating-event-0")).toBe(true);
  });

  it("deduplicates pending jobs and processes them in a bounded batch", async () => {
    const db = createDb(env.DB);
    await seedVotes();
    await enqueueRatingRecompute(db, { placeId, reason: "VOTE_CHANGED", now, jobId: "rating-job-1" });
    await enqueueRatingRecompute(db, { placeId, reason: "VOTE_CHANGED", now, jobId: "rating-job-2" });

    expect((await db.select().from(ratingRecomputeJobs)).filter((job) => job.placeId === placeId && job.status === "PENDING")).toHaveLength(1);
    const result = await processRatingJobs(db, { now, limit: 1 });

    expect(result).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect((await db.select().from(ratingRecomputeJobs)).find((job) => job.placeId === placeId)?.status).toBe("COMPLETED");
  });
});
