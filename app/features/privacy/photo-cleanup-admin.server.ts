import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../../db/client.server";
import { reviewerPhotoCleanupJobs } from "../../db/schema";
import { ownerDeletionAuthorized, parsePlannedObjectKeys } from "../ratings/reviewer-photo-deletion.server";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";
import { decodePrivacyCursor, encodePrivacyCursor } from "./privacy-request.server";

type Operator = { actorUserId: string; sessionId: string; now: string };
async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join(""); }
async function ownerAuthorized(database: D1Database, reviewId: string) {
  return Boolean(await createDb(database).get(sql`select 1 as authorized where ${ownerDeletionAuthorized(reviewId)}`));
}
export async function listPhotoCleanupJobs(database: D1Database, cursor: string | null, now: string) {
  const after = decodePrivacyCursor(cursor), db = createDb(database);
  const rows = await db.select().from(reviewerPhotoCleanupJobs).where(after ? sql`${reviewerPhotoCleanupJobs.updatedAt}<${after.at} OR (${reviewerPhotoCleanupJobs.updatedAt}=${after.at} AND ${reviewerPhotoCleanupJobs.reviewId}<${after.id})` : undefined)
    .orderBy(sql`${reviewerPhotoCleanupJobs.updatedAt} desc`, sql`${reviewerPhotoCleanupJobs.reviewId} desc`).limit(26);
  const page = await Promise.all(rows.slice(0, 25).map(async (row) => {
    let count: number | null = null;
    try { count = parsePlannedObjectKeys(row.reviewId, row.objectKeysJson, row.purpose === "ORPHAN" ? 5 : 100).length; } catch {}
    const authorized = row.purpose === "DELETE" && await ownerAuthorized(database, row.reviewId);
    return { id: row.reviewId, purpose: row.purpose, revision: row.revision, count, attemptCount: row.attemptCount,
      status: row.status === "RUNNING" && (!row.leaseExpiresAt || row.leaseExpiresAt <= now) ? "UNKNOWN" : row.status,
      nextAttemptAt: row.nextAttemptAt, updatedAt: row.updatedAt, leaseExpiresAt: row.leaseExpiresAt,
      canRetry: authorized && count !== null && row.status !== "RUNNING", authorized };
  }));
  const last = rows.slice(0, 25).at(-1);
  const completed = await database.prepare("SELECT id,target_id AS target,created_at AS createdAt FROM admin_audit_logs WHERE action='PHOTO_CLEANUP_COMPLETED' AND target_type='REVIEW_PHOTO_CLEANUP' ORDER BY created_at DESC,id DESC LIMIT 10").all<{ id: string; target: string; createdAt: string }>();
  return { rows: page, nextCursor: rows.length > 25 && last ? encodePrivacyCursor(last.updatedAt, last.reviewId) : null, completed: completed.results };
}
const snapshotSchema = z.object({ reviewId: z.string().min(1).max(128), revision: z.number().int().positive(),
  previousStatus: z.enum(["PENDING", "FAILED"]), planHash: z.string().length(64), count: z.number().int().min(0).max(100) });
export async function preparePhotoCleanupRetry(database: D1Database, input: Operator & { reviewId: string }) {
  if (!input.reviewId || input.reviewId.length > 128) throw new Error("PHOTO_CLEANUP_UNAVAILABLE");
  const row = await createDb(database).query.reviewerPhotoCleanupJobs.findFirst({ where: eq(reviewerPhotoCleanupJobs.reviewId, input.reviewId) });
  if (!row || row.purpose !== "DELETE" || row.status === "RUNNING" || !await ownerAuthorized(database, row.reviewId)) throw new Error("PHOTO_CLEANUP_UNAVAILABLE");
  const count = parsePlannedObjectKeys(row.reviewId, row.objectKeysJson).length;
  const payload = snapshotSchema.parse({ reviewId: row.reviewId, revision: row.revision, previousStatus: row.status, planHash: await digest(row.objectKeysJson), count });
  return { ...await prepareAdminOperation(database, { ...input, kind: "PHOTO_CLEANUP_RETRY", payload,
    summary: { title: "본인 요청 사진 삭제 재시도 대기", count: 1 } }), ...payload };
}
export async function readPhotoCleanupRetry(database: D1Database, input: Operator & { operationId: string }) {
  const operation = await getVerifiedAdminOperation(database, { ...input, kind: "PHOTO_CLEANUP_RETRY" });
  return { ...snapshotSchema.parse(operation.status === "COMMITTED" ? operation.result : operation.payload), operationId: operation.id, status: operation.status };
}
export async function commitPhotoCleanupRetry(database: D1Database, input: Operator & { operationId: string }) {
  return commitAdminOperation(database, { ...input, kind: "PHOTO_CLEANUP_RETRY" }, async (operation) => {
    const s = snapshotSchema.parse(operation.payload), db = createDb(database);
    const row = await db.query.reviewerPhotoCleanupJobs.findFirst({ where: eq(reviewerPhotoCleanupJobs.reviewId, s.reviewId) });
    if (!row || await digest(row.objectKeysJson) !== s.planHash) throw new Error("ADMIN_OPERATION_CONFLICT");
    return { checks: [database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?, 'photo_cleanup_scope', CASE WHEN EXISTS(SELECT 1 FROM reviewer_photo_cleanup_jobs WHERE review_id=? AND purpose='DELETE' AND revision=? AND status=? AND object_keys_json=?) THEN 1 ELSE 0 END`)
      .bind(operation.id, s.reviewId, s.revision, s.previousStatus, row.objectKeysJson),
      database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?, 'photo_cleanup_owner', CASE WHEN EXISTS(SELECT 1 FROM reviewer_visit_reviews r JOIN users u ON u.id=r.reviewer_user_id WHERE r.id=?
      AND (u.email='withdrawn.'||u.id||'@invalid.local' OR EXISTS(SELECT 1 FROM reviewer_review_transitions t WHERE t.review_id=r.id AND t.operation='WITHDRAW' AND t.actor_user_id=r.reviewer_user_id))) THEN 1 ELSE 0 END`).bind(operation.id, s.reviewId)],
      statements: [database.prepare("UPDATE reviewer_photo_cleanup_jobs SET revision=revision+1,status='PENDING',lease_id=NULL,lease_expires_at=NULL,last_error=NULL,next_attempt_at=?,updated_at=? WHERE review_id=?")
        .bind(input.now, input.now, s.reviewId)], result: s };
  });
}
