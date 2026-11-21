import { and, asc, eq, gt, inArray, lte, ne, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import { adminAuditLogs, reviewerPhotoCleanupGuards, reviewerPhotoCleanupJobs, reviewerVisitPhotos, reviewerVisitReviews } from "../../db/schema";
import { deleteReviewerPhotoObjects, type PhotoObjectStore, type ReviewerPhotoStorageCode } from "./reviewer-photo.server";

const DELETE_PAGE_SIZE = 100;
const CLEANUP_PAGE_SIZE = 25;
const CLEANUP_RETRY_DELAY_MS = 60 * 60 * 1000;
const CLEANUP_LEASE_MS = 10 * 60 * 1000;
type DeletionObjectStore = Pick<PhotoObjectStore, "delete">;
export type ReviewerPhotoDeletionResult = { deleted: number };
export type ReviewerPhotoDeletionErrorCode = ReviewerPhotoStorageCode;
export type ReviewerPhotoCleanupRecoveryResult = { deleted: number; pending: number; failed: number };

export function parsePlannedObjectKeys(reviewId: string, value: string, maximum = DELETE_PAGE_SIZE) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("REVIEW_PHOTO_CLEANUP_PAYLOAD_INVALID"); }
  if (!Array.isArray(parsed) || parsed.length > maximum || parsed.some((key) => typeof key !== "string")) throw new Error("REVIEW_PHOTO_CLEANUP_PAYLOAD_INVALID");
  const keys = parsed as string[], expectedPrefix = `reviews/${reviewId}/`;
  if (new Set(keys).size !== keys.length || keys.some((key) => !key.startsWith(expectedPrefix) || !/^[A-Za-z0-9_\-/]+\.jpg$/.test(key))) throw new Error("REVIEW_PHOTO_CLEANUP_PAYLOAD_INVALID");
  return keys;
}

/** Only an actual owner withdrawal or account withdrawal authorizes DELETE. */
export function ownerDeletionAuthorized(reviewId: string) {
  return sql`exists(select 1 from reviewer_visit_reviews r join users u on u.id=r.reviewer_user_id where r.id=${reviewId}
    and (u.email='withdrawn.'||u.id||'@invalid.local' or exists(select 1 from reviewer_review_transitions t
      where t.review_id=r.id and t.operation='WITHDRAW' and t.actor_user_id=r.reviewer_user_id)))`;
}

/** Returns an unexecuted query for the caller's atomic hide/withdraw batch. */
export function buildReviewerPhotoDeletionPlan(db: AppDb, input: { reviewId: string; now: string }) {
  const currentKeys = sql<string>`(select coalesce(json_group_array(object_key),'[]') from reviewer_visit_photos where review_id=${input.reviewId})`;
  return db.insert(reviewerPhotoCleanupJobs).values({
    reviewId: input.reviewId, purpose: "DELETE", objectKeysJson: currentKeys,
    nextAttemptAt: input.now, attemptCount: 0, createdAt: input.now, updatedAt: input.now,
  }).onConflictDoUpdate({ target: reviewerPhotoCleanupJobs.reviewId,
    setWhere: sql`${reviewerPhotoCleanupJobs.purpose}<>'DELETE' OR EXISTS(SELECT value FROM json_each(${currentKeys}) EXCEPT SELECT value FROM json_each(${reviewerPhotoCleanupJobs.objectKeysJson}))`,
    set: {
    purpose: "DELETE",
    objectKeysJson: sql`(select json_group_array(value) from (select value from json_each(${reviewerPhotoCleanupJobs.objectKeysJson}) union select value from json_each(${currentKeys})))`,
    revision: sql`${reviewerPhotoCleanupJobs.revision}+1`, status: "PENDING", leaseId: null, leaseExpiresAt: null, lastError: null,
    nextAttemptAt: input.now, updatedAt: input.now,
  } });
}
export async function enqueueReviewerPhotoDeletion(db: AppDb, input: { reviewId: string; now: string }) { await buildReviewerPhotoDeletionPlan(db, input); }
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
async function processCleanupJob(db: AppDb, bucket: DeletionObjectStore, candidate: CleanupJob, now: string, force = false) {
  const keys = parsePlannedObjectKeys(candidate.reviewId, candidate.objectKeysJson, candidate.purpose === "ORPHAN" ? 5 : DELETE_PAGE_SIZE);
  const leaseId = crypto.randomUUID();
  const [job] = await db.update(reviewerPhotoCleanupJobs).set({
    status: "RUNNING", leaseId, leaseExpiresAt: new Date(Date.parse(now) + CLEANUP_LEASE_MS).toISOString(),
    attemptCount: sql`${reviewerPhotoCleanupJobs.attemptCount}+1`, lastError: null, updatedAt: now,
  }).where(and(eq(reviewerPhotoCleanupJobs.reviewId, candidate.reviewId), eq(reviewerPhotoCleanupJobs.revision, candidate.revision),
    eq(reviewerPhotoCleanupJobs.objectKeysJson, candidate.objectKeysJson), eq(reviewerPhotoCleanupJobs.purpose, candidate.purpose),
    ne(reviewerPhotoCleanupJobs.status, "RUNNING"), force ? undefined : lte(reviewerPhotoCleanupJobs.nextAttemptAt, now),
    candidate.purpose === "DELETE" ? ownerDeletionAuthorized(candidate.reviewId) : undefined)).returning();
  if (!job) return { deleted: 0, worked: false };
  const owned = and(eq(reviewerPhotoCleanupJobs.reviewId, job.reviewId), eq(reviewerPhotoCleanupJobs.revision, job.revision),
    eq(reviewerPhotoCleanupJobs.leaseId, leaseId), eq(reviewerPhotoCleanupJobs.status, "RUNNING"));
  try {
    const referenced = await loadInD1Chunks(keys, (chunk) => db.select({ id: reviewerVisitPhotos.id, objectKey: reviewerVisitPhotos.objectKey }).from(reviewerVisitPhotos)
      .where(and(eq(reviewerVisitPhotos.reviewId, job.reviewId), inArray(reviewerVisitPhotos.objectKey, chunk))), { reservedBindings: 1 });
    const referencedKeys = new Set(referenced.map((photo) => photo.objectKey));
    const objectKeys = job.purpose === "DELETE" ? keys : keys.filter((key) => !referencedKeys.has(key));
    if (!await db.query.reviewerPhotoCleanupJobs.findFirst({ where: owned, columns: { reviewId: true } })) return { deleted: 0, worked: false };
    await deleteReviewerPhotoObjects(bucket, objectKeys);
    const guard = db.insert(reviewerPhotoCleanupGuards).values({ id: leaseId,
      passed: sql`case when exists(select 1 from reviewer_photo_cleanup_jobs where review_id=${job.reviewId} and revision=${job.revision} and lease_id=${leaseId} and status='RUNNING') then 1 else 0 end` });
    const metadataDeletes = [];
    for (let offset = 0; offset < referenced.length; offset += 99) metadataDeletes.push(db.delete(reviewerVisitPhotos)
      .where(and(eq(reviewerVisitPhotos.reviewId, job.reviewId), inArray(reviewerVisitPhotos.id, referenced.slice(offset, offset + 99).map((photo) => photo.id)))));
    await db.batch([
      guard,
      ...(job.purpose === "DELETE" && referenced.length ? [
        ...metadataDeletes,
        db.update(reviewerVisitReviews).set({ photoCount: sql`(select count(*) from reviewer_visit_photos p where p.review_id=${reviewerVisitReviews.id} and p.content_version=${reviewerVisitReviews.contentVersion})` }).where(eq(reviewerVisitReviews.id, job.reviewId)),
      ] : []),
      db.insert(adminAuditLogs).values({ id: leaseId, action: "PHOTO_CLEANUP_COMPLETED", targetType: "REVIEW_PHOTO_CLEANUP", targetId: job.reviewId,
        afterState: JSON.stringify({ purpose: job.purpose, revision: job.revision, attempt: job.attemptCount, objects: objectKeys.length, metadata: job.purpose === "DELETE" ? referenced.length : 0 }), createdAt: now }),
      db.delete(reviewerPhotoCleanupJobs).where(owned),
      db.delete(reviewerPhotoCleanupGuards).where(eq(reviewerPhotoCleanupGuards.id, leaseId)),
    ] as never);
    return { deleted: job.purpose === "DELETE" ? referenced.length : objectKeys.length, worked: objectKeys.length > 0 };
  } catch (error) {
    // A committed completion receipt wins over a lost D1 response. No new R2 call.
    if (await db.query.adminAuditLogs.findFirst({ where: eq(adminAuditLogs.id, leaseId), columns: { id: true } }).catch(() => null)) return { deleted: 0, worked: true };
    const [failed] = await db.update(reviewerPhotoCleanupJobs).set({ status: "FAILED", leaseId: null, leaseExpiresAt: null,
      lastError: "PHOTO_CLEANUP_FAILED", nextAttemptAt: new Date(Date.parse(now) + CLEANUP_RETRY_DELAY_MS).toISOString(), updatedAt: now }).where(owned).returning({ reviewId: reviewerPhotoCleanupJobs.reviewId });
    if (!failed) return { deleted: 0, worked: false };
    throw error;
  }
}

/** Re-establish exact-key compensation after a late PUT outlives its first plan. */
export async function ensureUncommittedPhotoRecovery(db: AppDb, input: { reviewId: string; objectKeys: string[]; now: string }) {
  const keys = JSON.stringify(input.objectKeys);
  parsePlannedObjectKeys(input.reviewId, keys, 5);
  await db.$client.prepare(`INSERT INTO reviewer_photo_cleanup_jobs(review_id,purpose,object_keys_json,next_attempt_at,attempt_count,created_at,updated_at)
    SELECT ?,'ORPHAN',?,?,1,?,? WHERE NOT EXISTS(SELECT 1 FROM reviewer_visit_reviews WHERE id=?)
    ON CONFLICT(review_id) DO NOTHING`).bind(input.reviewId, keys, input.now, input.now, input.now, input.reviewId).run();
}

/** Compensation may remove only unreferenced keys from the exact ORPHAN plan. */
export async function cleanupUncommittedReviewerPhotoUpload(db: AppDb, bucket: DeletionObjectStore, reviewId: string, now = new Date().toISOString()) {
  const job = await db.query.reviewerPhotoCleanupJobs.findFirst({ where: and(eq(reviewerPhotoCleanupJobs.reviewId, reviewId), eq(reviewerPhotoCleanupJobs.purpose, "ORPHAN")) });
  if (job) await processCleanupJob(db, bucket, job, now, true);
}

/** Running leases, including expired/unknown runs, are not blindly reclaimed. */
export async function recoverPendingReviewerPhotoCleanup(db: AppDb, bucket: DeletionObjectStore, options: { now: string; limit?: number; reviewId?: string }): Promise<ReviewerPhotoCleanupRecoveryResult> {
  const jobs = await db.select().from(reviewerPhotoCleanupJobs).where(and(lte(reviewerPhotoCleanupJobs.nextAttemptAt, options.now), ne(reviewerPhotoCleanupJobs.status, "RUNNING"), options.reviewId ? eq(reviewerPhotoCleanupJobs.reviewId, options.reviewId) : undefined))
    .orderBy(asc(reviewerPhotoCleanupJobs.nextAttemptAt), asc(reviewerPhotoCleanupJobs.reviewId)).limit(Math.max(1, Math.min(options.limit ?? CLEANUP_PAGE_SIZE, CLEANUP_PAGE_SIZE)));
  let deleted = 0, pending = 0, failed = 0;
  for (const job of jobs) {
    try { const result = await processCleanupJob(db, bucket, job, options.now); if (result.worked) deleted += 1; }
    catch { failed += 1; pending += 1; }
  }
  return { deleted, pending, failed };
}

export async function deletePublishedReviewerVisitPhotos(db: AppDb, bucket: DeletionObjectStore, reviewId: string): Promise<ReviewerPhotoDeletionResult> {
  const now = new Date().toISOString();
  await enqueueReviewerPhotoDeletion(db, { reviewId, now });
  const job = await db.query.reviewerPhotoCleanupJobs.findFirst({ where: eq(reviewerPhotoCleanupJobs.reviewId, reviewId) });
  return { deleted: job ? (await processCleanupJob(db, bucket, job, now, true)).deleted : 0 };
}
export async function deleteReviewerPhotoObjectsForUser(db: AppDb, bucket: DeletionObjectStore, reviewerUserId: string): Promise<ReviewerPhotoDeletionResult> {
  let deleted = 0, cursor: string | undefined;
  while (true) {
    const reviews = await db.select({ id: reviewerVisitReviews.id }).from(reviewerVisitReviews).where(and(eq(reviewerVisitReviews.reviewerUserId, reviewerUserId), cursor ? gt(reviewerVisitReviews.id, cursor) : undefined)).orderBy(asc(reviewerVisitReviews.id)).limit(DELETE_PAGE_SIZE);
    if (!reviews.length) return { deleted };
    for (const review of reviews) deleted += (await deletePublishedReviewerVisitPhotos(db, bucket, review.id)).deleted;
    cursor = reviews.at(-1)!.id;
  }
}
