import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { reviewerPhotoCleanupJobs, reviewerVisitPhotos, reviewerVisitReviews } from "../../db/schema";
import { deleteReviewerPhotoObjects, type PhotoObjectStore, type ReviewerPhotoStorageCode } from "./reviewer-photo.server";

const DELETE_PAGE_SIZE = 100;
const CLEANUP_PAGE_SIZE = 25;
const CLEANUP_RETRY_DELAY_MS = 60 * 60 * 1000;
type DeletionObjectStore = Pick<PhotoObjectStore, "delete">;

export type ReviewerPhotoDeletionResult = { deleted: number };
export type ReviewerPhotoDeletionErrorCode = ReviewerPhotoStorageCode;
export type ReviewerPhotoCleanupRecoveryResult = { deleted: number; pending: number; failed: number };

function parsePlannedObjectKeys(reviewId: string, value: string, maximum = DELETE_PAGE_SIZE) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("REVIEW_PHOTO_CLEANUP_PAYLOAD_INVALID"); }
  if (!Array.isArray(parsed) || parsed.length > maximum || parsed.some((key) => typeof key !== "string")) {
    throw new Error("REVIEW_PHOTO_CLEANUP_PAYLOAD_INVALID");
  }
  const keys = parsed as string[];
  const expectedPrefix = `reviews/${reviewId}/`;
  if (new Set(keys).size !== keys.length || keys.some((key) => !key.startsWith(expectedPrefix) || !/^[A-Za-z0-9_\-/]+\.jpg$/.test(key))) {
    throw new Error("REVIEW_PHOTO_CLEANUP_PAYLOAD_INVALID");
  }
  return keys;
}

/** Returns an unexecuted query for the caller's atomic hide/withdraw batch. */
export function buildReviewerPhotoDeletionPlan(db: AppDb, input: { reviewId: string; now: string }) {
  const currentKeys = sql<string>`(select coalesce(json_group_array(object_key),'[]') from reviewer_visit_photos where review_id=${input.reviewId})`;
  return db.insert(reviewerPhotoCleanupJobs).values({
    reviewId: input.reviewId,
    purpose: "DELETE",
    objectKeysJson: currentKeys,
    nextAttemptAt: input.now,
    attemptCount: 0,
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoUpdate({
    target: reviewerPhotoCleanupJobs.reviewId,
    set: {
      purpose: "DELETE",
      // Preserve both an earlier ambiguous upload and current metadata keys.
      objectKeysJson: sql`(select json_group_array(value) from (select value from json_each(${reviewerPhotoCleanupJobs.objectKeysJson}) union select value from json_each(${currentKeys})))`,
      nextAttemptAt: input.now,
      updatedAt: input.now,
    },
  });
}

export async function enqueueReviewerPhotoDeletion(db: AppDb, input: { reviewId: string; now: string }) {
  await buildReviewerPhotoDeletionPlan(db, input);
}

export async function enqueueReviewerPhotoDeletionForUser(db: AppDb, input: { reviewerUserId: string; now: string }) {
  let cursor: string | undefined;
  while (true) {
    const reviews = await db.select({ id: reviewerVisitReviews.id }).from(reviewerVisitReviews)
      .where(and(eq(reviewerVisitReviews.reviewerUserId, input.reviewerUserId), cursor ? gt(reviewerVisitReviews.id, cursor) : undefined))
      .orderBy(asc(reviewerVisitReviews.id)).limit(DELETE_PAGE_SIZE);
    if (!reviews.length) return;
    await db.batch(reviews.map((review) => buildReviewerPhotoDeletionPlan(db, { reviewId: review.id, now: input.now })) as never);
    cursor = reviews.at(-1)!.id;
  }
}

type CleanupJob = typeof reviewerPhotoCleanupJobs.$inferSelect;
async function processCleanupJob(db: AppDb, bucket: DeletionObjectStore, job: CleanupJob) {
  const keys = parsePlannedObjectKeys(job.reviewId, job.objectKeysJson, job.purpose === "ORPHAN" ? 5 : DELETE_PAGE_SIZE);
  const referenced = keys.length ? await db.select({ id: reviewerVisitPhotos.id, objectKey: reviewerVisitPhotos.objectKey })
    .from(reviewerVisitPhotos).where(and(eq(reviewerVisitPhotos.reviewId, job.reviewId), inArray(reviewerVisitPhotos.objectKey, keys))) : [];
  const referencedKeys = new Set(referenced.map((photo) => photo.objectKey));
  const objectKeys = job.purpose === "DELETE" ? keys : keys.filter((key) => !referencedKeys.has(key));
  // A committed private/pending review is not an orphan. Approval and storage
  // commit are separate: ORPHAN cleanup removes only keys with no metadata.
  await deleteReviewerPhotoObjects(bucket, objectKeys);
  const samePlan = and(eq(reviewerPhotoCleanupJobs.reviewId, job.reviewId), eq(reviewerPhotoCleanupJobs.purpose, job.purpose), eq(reviewerPhotoCleanupJobs.objectKeysJson, job.objectKeysJson));
  if (job.purpose === "DELETE" && referenced.length) {
    await db.batch([
      db.delete(reviewerVisitPhotos).where(inArray(reviewerVisitPhotos.id, referenced.map((photo) => photo.id))),
      db.update(reviewerVisitReviews).set({
        photoCount: sql`(select count(*) from reviewer_visit_photos p where p.review_id=${reviewerVisitReviews.id} and p.content_version=${reviewerVisitReviews.contentVersion})`,
      }).where(eq(reviewerVisitReviews.id, job.reviewId)),
      db.delete(reviewerPhotoCleanupJobs).where(samePlan),
    ]);
  } else {
    await db.delete(reviewerPhotoCleanupJobs).where(samePlan);
  }
  return { deleted: job.purpose === "DELETE" ? referenced.length : objectKeys.length, worked: objectKeys.length > 0 };
}

/** Compensate an ambiguous upload only while it is still an ORPHAN plan.
 * Referenced keys are preserved, even when publication confirmation failed. */
export async function cleanupUncommittedReviewerPhotoUpload(db: AppDb, bucket: DeletionObjectStore, reviewId: string) {
  const job=await db.query.reviewerPhotoCleanupJobs.findFirst({where:and(eq(reviewerPhotoCleanupJobs.reviewId,reviewId),eq(reviewerPhotoCleanupJobs.purpose,"ORPHAN"))});
  if(job) await processCleanupJob(db,bucket,job);
}

/** Exact-key recovery for both ambiguous uploads and durable user deletions. */
export async function recoverPendingReviewerPhotoCleanup(db: AppDb, bucket: DeletionObjectStore, options: { now: string; limit?: number; reviewId?:string }): Promise<ReviewerPhotoCleanupRecoveryResult> {
  const jobs = await db.select().from(reviewerPhotoCleanupJobs)
    .where(and(lte(reviewerPhotoCleanupJobs.nextAttemptAt, options.now),options.reviewId?eq(reviewerPhotoCleanupJobs.reviewId,options.reviewId):undefined))
    .orderBy(asc(reviewerPhotoCleanupJobs.nextAttemptAt), asc(reviewerPhotoCleanupJobs.createdAt))
    .limit(Math.max(1, Math.min(options.limit ?? CLEANUP_PAGE_SIZE, CLEANUP_PAGE_SIZE)));
  let deleted = 0;
  let pending = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await processCleanupJob(db, bucket, job);
      if (result.worked) deleted += 1;
    } catch {
      failed += 1;
      pending += 1;
      await db.update(reviewerPhotoCleanupJobs).set({
        attemptCount: sql`${reviewerPhotoCleanupJobs.attemptCount} + 1`,
        nextAttemptAt: new Date(Date.parse(options.now) + CLEANUP_RETRY_DELAY_MS).toISOString(),
        updatedAt: options.now,
      }).where(eq(reviewerPhotoCleanupJobs.reviewId, job.reviewId));
    }
  }
  return { deleted, pending, failed };
}

export async function deletePublishedReviewerVisitPhotos(db: AppDb, bucket: DeletionObjectStore, reviewId: string): Promise<ReviewerPhotoDeletionResult> {
  await enqueueReviewerPhotoDeletion(db, { reviewId, now: new Date().toISOString() });
  const job = await db.query.reviewerPhotoCleanupJobs.findFirst({ where: eq(reviewerPhotoCleanupJobs.reviewId, reviewId) });
  if (!job) return { deleted: 0 };
  return { deleted: (await processCleanupJob(db, bucket, job)).deleted };
}

export async function deleteReviewerPhotoObjectsForUser(db: AppDb, bucket: DeletionObjectStore, reviewerUserId: string): Promise<ReviewerPhotoDeletionResult> {
  let deleted = 0;
  let cursor: string | undefined;
  while (true) {
    const reviews = await db.select({ id: reviewerVisitReviews.id }).from(reviewerVisitReviews)
      .where(and(eq(reviewerVisitReviews.reviewerUserId, reviewerUserId), cursor ? gt(reviewerVisitReviews.id, cursor) : undefined))
      .orderBy(asc(reviewerVisitReviews.id)).limit(DELETE_PAGE_SIZE);
    if (!reviews.length) return { deleted };
    for (const review of reviews) deleted += (await deletePublishedReviewerVisitPhotos(db, bucket, review.id)).deleted;
    cursor = reviews.at(-1)!.id;
  }
}
