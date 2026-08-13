import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { places, ratingRecomputeJobs, reviewerPhotoCleanupJobs } from "../../app/db/schema";
import { getReviewerPhotoObjectKey } from "../../app/features/ratings/reviewer-photo.server";
import { enqueueRatingRecompute } from "../../app/features/ratings/recompute.server";
import { runScheduledRatingMaintenance } from "../../app/features/ratings/scheduled-rating.server";

describe("rating scheduler", () => {
  it("processes pending jobs in a bounded maintenance run", async () => {
    const db = createDb(env.DB); const id = `scheduler-place-${crypto.randomUUID()}`; const now = "2026-08-06T12:00:00.000Z";
    await db.insert(places).values({ id, slug: id, name: id, status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: id, createdAt: now, updatedAt: now });
    await enqueueRatingRecompute(db, { placeId: id, reason: "TEST", now });
    const result = await runScheduledRatingMaintenance(env, { now, jobLimit: 10 });
    expect(result.jobs).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect((await db.select().from(ratingRecomputeJobs)).find((job) => job.placeId === id)?.status).toBe("COMPLETED");
  });

  it("retries exact unpublished R2 photo cleanup within the existing daily maintenance", async () => {
    const db = createDb(env.DB); const now = "2026-08-13T00:00:00.000Z";
    const reviewId = `scheduler-photo-${crypto.randomUUID()}`;
    const photoId = `scheduler-photo-id-${crypto.randomUUID()}`;
    const objectKey = getReviewerPhotoObjectKey(reviewId, photoId);
    await env.REVIEW_PHOTOS.put(objectKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { httpMetadata: { contentType: "image/jpeg" } });
    await db.insert(reviewerPhotoCleanupJobs).values({
      reviewId,
      objectKeysJson: JSON.stringify([objectKey]),
      nextAttemptAt: now,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    const result = await runScheduledRatingMaintenance(env, { now, jobLimit: 10 });
    expect(result.photoCleanup).toEqual({ deleted: 1, pending: 0, failed: 0 });
    await expect(env.REVIEW_PHOTOS.head(objectKey)).resolves.toBeNull();
    await expect(db.select().from(reviewerPhotoCleanupJobs)).resolves.not.toContainEqual(expect.objectContaining({ reviewId }));
  });
});
