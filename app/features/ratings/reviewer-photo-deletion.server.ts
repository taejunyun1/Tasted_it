import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { reviewerPhotoCleanupJobs, reviewerVisitPhotos, reviewerVisitReviews } from "../../db/schema";
import {
  deleteReviewerPhotoObjects,
  type PhotoObjectStore,
  type ReviewerPhotoStorageCode,
} from "./reviewer-photo.server";

const DELETE_PAGE_SIZE = 100;
const CLEANUP_PAGE_SIZE = 25;
const CLEANUP_RETRY_DELAY_MS = 60 * 60 * 1000;

type DeletionObjectStore = Pick<PhotoObjectStore, "delete">;
type StoredPhotoReference = { id: string; objectKey: string };

async function deleteStoredPhotoPage(
  db: AppDb,
  bucket: DeletionObjectStore,
  photos: StoredPhotoReference[],
) {
  if (photos.length === 0) return 0;

  // R2 delete is idempotent. Metadata is removed only when the exact set of
  // associated objects has been accepted for deletion, so a retry never loses
  // the keys required for cleanup.
  await deleteReviewerPhotoObjects(bucket, photos.map((photo) => photo.objectKey));
  await db.delete(reviewerVisitPhotos).where(inArray(
    reviewerVisitPhotos.id,
    photos.map((photo) => photo.id),
  ));
  return photos.length;
}

export type ReviewerPhotoDeletionResult = { deleted: number };
export type ReviewerPhotoDeletionErrorCode = ReviewerPhotoStorageCode;
export type ReviewerPhotoCleanupRecoveryResult = { deleted: number; pending: number; failed: number };

function cleanupRetryAt(now: string) {
  return new Date(Date.parse(now) + CLEANUP_RETRY_DELAY_MS).toISOString();
}

function parsePlannedObjectKeys(reviewId: string, value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("REVIEW_PHOTO_CLEANUP_PAYLOAD_INVALID");
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 5 || parsed.some((key) => typeof key !== "string")) {
    throw new Error("REVIEW_PHOTO_CLEANUP_PAYLOAD_INVALID");
  }
  const keys = parsed as string[];
  const expectedPrefix = `reviews/${reviewId}/`;
  if (new Set(keys).size !== keys.length || keys.some((key) => !key.startsWith(expectedPrefix) || !/^[A-Za-z0-9_\-/]+\.jpg$/.test(key))) {
    throw new Error("REVIEW_PHOTO_CLEANUP_PAYLOAD_INVALID");
  }
  return keys;
}

/**
 * Recovers unpublished objects whose D1 review batch did not commit. It uses
 * only keys captured before R2 upload; it never lists or scans the bucket.
 */
export async function recoverPendingReviewerPhotoCleanup(
  db: AppDb,
  bucket: DeletionObjectStore,
  options: { now: string; limit?: number },
): Promise<ReviewerPhotoCleanupRecoveryResult> {
  const jobs = await db.select({
    reviewId: reviewerPhotoCleanupJobs.reviewId,
    objectKeysJson: reviewerPhotoCleanupJobs.objectKeysJson,
  }).from(reviewerPhotoCleanupJobs)
    .where(lte(reviewerPhotoCleanupJobs.nextAttemptAt, options.now))
    .orderBy(asc(reviewerPhotoCleanupJobs.nextAttemptAt), asc(reviewerPhotoCleanupJobs.createdAt))
    .limit(Math.max(1, Math.min(options.limit ?? CLEANUP_PAGE_SIZE, CLEANUP_PAGE_SIZE)));

  let deleted = 0;
  let pending = 0;
  let failed = 0;
  for (const job of jobs) {
    const review = await db.query.reviewerVisitReviews.findFirst({
      where: eq(reviewerVisitReviews.id, job.reviewId),
      columns: { id: true },
    });
    if (review) {
      await db.delete(reviewerPhotoCleanupJobs).where(eq(reviewerPhotoCleanupJobs.reviewId, job.reviewId));
      continue;
    }
    try {
      await deleteReviewerPhotoObjects(bucket, parsePlannedObjectKeys(job.reviewId, job.objectKeysJson));
      await db.delete(reviewerPhotoCleanupJobs).where(eq(reviewerPhotoCleanupJobs.reviewId, job.reviewId));
      deleted += 1;
    } catch {
      failed += 1;
      pending += 1;
      await db.update(reviewerPhotoCleanupJobs).set({
        attemptCount: sql`${reviewerPhotoCleanupJobs.attemptCount} + 1`,
        nextAttemptAt: cleanupRetryAt(options.now),
        updatedAt: options.now,
      }).where(eq(reviewerPhotoCleanupJobs.reviewId, job.reviewId));
    }
  }
  return { deleted, pending, failed };
}

/**
 * Deletes a single published review's exact R2 objects and metadata. It does
 * not delete the review itself; a future review/account deletion transaction
 * must call this boundary before it removes its parent data.
 */
export async function deletePublishedReviewerVisitPhotos(
  db: AppDb,
  bucket: DeletionObjectStore,
  reviewId: string,
): Promise<ReviewerPhotoDeletionResult> {
  const photos = await db.select({
    id: reviewerVisitPhotos.id,
    objectKey: reviewerVisitPhotos.objectKey,
  }).from(reviewerVisitPhotos)
    .where(eq(reviewerVisitPhotos.reviewId, reviewId))
    .orderBy(asc(reviewerVisitPhotos.position))
    .limit(DELETE_PAGE_SIZE);

  return { deleted: await deleteStoredPhotoPage(db, bucket, photos) };
}

/**
 * Deletes one reviewer's photo objects in bounded metadata pages. It never
 * lists the bucket, so it cannot remove an object not represented by this
 * user's review-photo row.
 */
export async function deleteReviewerPhotoObjectsForUser(
  db: AppDb,
  bucket: DeletionObjectStore,
  reviewerUserId: string,
): Promise<ReviewerPhotoDeletionResult> {
  let deleted = 0;

  while (true) {
    const photos = await db.select({
      id: reviewerVisitPhotos.id,
      objectKey: reviewerVisitPhotos.objectKey,
    }).from(reviewerVisitPhotos)
      .innerJoin(reviewerVisitReviews, eq(reviewerVisitReviews.id, reviewerVisitPhotos.reviewId))
      .where(and(eq(reviewerVisitReviews.reviewerUserId, reviewerUserId)))
      .orderBy(asc(reviewerVisitPhotos.id))
      .limit(DELETE_PAGE_SIZE);

    if (photos.length === 0) break;
    deleted += await deleteStoredPhotoPage(db, bucket, photos);
  }

  return { deleted };
}
