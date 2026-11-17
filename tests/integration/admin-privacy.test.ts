import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { readAdminActivity } from "../../app/features/operations/admin-activity.server";
import { parseActivityQuery } from "../../app/features/operations/admin-activity";
import { grantAdminAssurance } from "../../app/features/auth/admin-assurance.server";
import { createPrivacyRequest, commitPrivacyRequestUpdate, listOwnPrivacyRequests, preparePrivacyRequestUpdate } from "../../app/features/privacy/privacy-request.server";
import { listPhotoCleanupJobs, preparePhotoCleanupRetry, commitPhotoCleanupRetry } from "../../app/features/privacy/photo-cleanup-admin.server";
import { deletePublishedReviewerVisitPhotos, enqueueReviewerPhotoDeletion, recoverPendingReviewerPhotoCleanup } from "../../app/features/ratings/reviewer-photo-deletion.server";

const now = "2026-11-18T03:00:00.000Z";
async function fixture() {
  const suffix = crypto.randomUUID(), owner = `owner-${suffix}`, admin = `admin-${suffix}`, sessionId = crypto.randomUUID();
  for (const [id, role] of [[owner, "REVIEWER"], [admin, "ADMIN"]]) await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id, `${id}@example.test`, "합성 계정", role, now, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',?)").bind(sessionId, admin, now).run();
  const operator = { actorUserId: admin, sessionId, now };
  return { owner, admin, operator, db: createDb(env.DB), suffix };
}
async function storedReview(f: Awaited<ReturnType<typeof fixture>>) {
  const reviewId = `privacy-${f.suffix}`, key = `reviews/${reviewId}/photo.jpg`;
  await env.DB.prepare("INSERT OR IGNORE INTO categories(id,slug,name,emoji,sort_order,is_active,created_at,updated_at) VALUES('privacy-cat','privacy-cat','라멘','x',1,1,?,?)").bind(now, now).run();
  await env.DB.prepare("INSERT OR IGNORE INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES('privacy-place','privacy-place','합성','PUBLISHED','광주','동명동',35,126,'합성',?,?)").bind(now, now).run();
  await env.DB.prepare("INSERT INTO reviewer_visit_reviews(id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,published_at,created_at,updated_at) VALUES(?,'privacy-place',?,'privacy-cat','RECOMMEND','[]',1,?,?,?)").bind(reviewId, f.owner, now, now, now).run();
  await env.DB.prepare("INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,created_at,updated_at) VALUES(?,?,?,'image/jpeg',4,0,?,?)").bind(`photo-${f.suffix}`, reviewId, key, now, now).run();
  await env.REVIEW_PHOTOS.put(key, new Uint8Array([1,2,3,4]));
  await enqueueReviewerPhotoDeletion(f.db, { reviewId, now });
  return { reviewId, key };
}
async function authorizeOwner(f: Awaited<ReturnType<typeof fixture>>) { await env.DB.prepare("UPDATE users SET email='withdrawn.'||id||'@invalid.local' WHERE id=?").bind(f.owner).run(); }

describe("B13 privacy operations", () => {
  it("deduplicates verified-account intake and separates status records from actual data deletion", async () => {
    const f = await fixture();
    const [a,b] = await Promise.all([createPrivacyRequest(env.DB, { userId: f.owner, kind: "DELETION", now }), createPrivacyRequest(env.DB, { userId: f.owner, kind: "DELETION", now })]);
    expect(a.id).toBe(b.id);
    const preview = await preparePrivacyRequestUpdate(env.DB, { ...f.operator, requestId: a.id, decision: "POLICY_UNRESOLVED" });
    const competing = await preparePrivacyRequestUpdate(env.DB, { ...f.operator, requestId: a.id, decision: "REVIEW_STARTED" });
    await expect(commitPrivacyRequestUpdate(env.DB, { ...f.operator, operationId: preview.operationId })).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
    await grantAdminAssurance(env.DB, { ...f.operator, now: new Date(now), method: "PASSWORD" });
    await commitPrivacyRequestUpdate(env.DB, { ...f.operator, operationId: preview.operationId });
    await expect(commitPrivacyRequestUpdate(env.DB, { ...f.operator, operationId: competing.operationId })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await listOwnPrivacyRequests(env.DB, f.owner)).toMatchObject([{ id: a.id, status: "POLICY_HOLD" }]);
    expect(await listOwnPrivacyRequests(env.DB, f.admin)).toEqual([]);
    const activity = await readAdminActivity(env.DB, parseActivityQuery(new URLSearchParams({ view: "operations", operation: preview.operationId }), now), now);
    expect(activity.detail?.title).toBe("개인정보 요청 처리 기록");
    expect(activity.detail?.fields).toContainEqual({ label: "기록한 처리", value: "정책 확인 대기" });
    expect(JSON.stringify(activity.detail)).not.toContain(f.owner);
    expect(await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(f.owner).first()).toEqual({ email: `${f.owner}@example.test` });
    await expect(createPrivacyRequest(env.DB, { userId: f.owner, kind: "UNSUPPORTED", now })).rejects.toThrow("PRIVACY_REQUEST_INPUT_INVALID");
  });

  it("denies a forged deletion plan without owner withdrawal while preserving the exact file", async () => {
    const f = await fixture(), item = await storedReview(f);
    expect(await recoverPendingReviewerPhotoCleanup(f.db, env.REVIEW_PHOTOS, { now })).toEqual({ deleted: 0, pending: 0, failed: 0 });
    expect(await env.REVIEW_PHOTOS.head(item.key)).toBeTruthy();
    await expect(preparePhotoCleanupRetry(env.DB, { ...f.operator, reviewId: item.reviewId })).rejects.toThrow("PHOTO_CLEANUP_UNAVAILABLE");
    expect(JSON.stringify(await listPhotoCleanupJobs(env.DB, null, now))).not.toContain(item.key);
  });

  it("claims one deletion for concurrent cron and manual callers, and records completion", async () => {
    const f = await fixture(), item = await storedReview(f); await authorizeOwner(f);
    let start!: () => void, release!: () => void, calls = 0;
    const started = new Promise<void>((resolve) => { start = resolve; }), paused = new Promise<void>((resolve) => { release = resolve; });
    const bucket = { delete: async (keys: string | string[]) => { calls++; start(); await paused; await env.REVIEW_PHOTOS.delete(keys); } };
    const first = recoverPendingReviewerPhotoCleanup(f.db, bucket, { now }); await started;
    expect(await recoverPendingReviewerPhotoCleanup(f.db, bucket, { now })).toEqual({ deleted: 0, pending: 0, failed: 0 });
    expect(await deletePublishedReviewerVisitPhotos(f.db, bucket, item.reviewId)).toEqual({ deleted: 0 });
    expect(calls).toBe(1); release(); expect(await first).toEqual({ deleted: 1, pending: 0, failed: 0 });
    expect(await env.REVIEW_PHOTOS.head(item.key)).toBeNull();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM reviewer_photo_cleanup_guards").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE action='PHOTO_CLEANUP_COMPLETED' AND target_id=?").bind(item.reviewId).first()).toEqual({ n: 1 });
  });

  it("preserves metadata when the plan changes during R2, then safely retries the new revision", async () => {
    const f = await fixture(), item = await storedReview(f); await authorizeOwner(f);
    let start!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; }), paused = new Promise<void>((resolve) => { release = resolve; });
    const first = recoverPendingReviewerPhotoCleanup(f.db, { delete: async (keys) => { start(); await paused; await env.REVIEW_PHOTOS.delete(keys); } }, { now }); await started;
    const secondKey = `reviews/${item.reviewId}/new-photo.jpg`;
    await env.REVIEW_PHOTOS.put(secondKey, new Uint8Array([1,2]));
    await env.DB.prepare("INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,created_at,updated_at) VALUES(?,?,?,'image/jpeg',2,1,?,?)")
      .bind(`new-${f.suffix}`, item.reviewId, secondKey, now, now).run();
    await enqueueReviewerPhotoDeletion(f.db, { reviewId: item.reviewId, now }); release();
    expect(await first).toEqual({ deleted: 0, pending: 0, failed: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM reviewer_visit_photos WHERE review_id=?").bind(item.reviewId).first()).toEqual({ n: 2 });
    await grantAdminAssurance(env.DB, { ...f.operator, now: new Date(now), method: "PASSWORD" });
    const preview = await preparePhotoCleanupRetry(env.DB, { ...f.operator, reviewId: item.reviewId });
    await commitPhotoCleanupRetry(env.DB, { ...f.operator, operationId: preview.operationId });
    const activity = await readAdminActivity(env.DB, parseActivityQuery(new URLSearchParams({ view: "operations", operation: preview.operationId }), now), now);
    expect(activity.detail?.title).toBe("본인 사진 삭제 재시도");
    expect(activity.detail?.fields).toContainEqual({ label: "처리 범위", value: "기존 본인 삭제 계획의 재시도 접수 · 삭제 완료 아님" });
    expect(JSON.stringify(activity.detail)).not.toContain(item.key);
    expect(await recoverPendingReviewerPhotoCleanup(f.db, env.REVIEW_PHOTOS, { now })).toEqual({ deleted: 1, pending: 0, failed: 0 });
  });

  it("does not reclaim expired RUNNING deletions or accept stale administrator previews", async () => {
    const f = await fixture(), item = await storedReview(f); await authorizeOwner(f);
    const preview = await preparePhotoCleanupRetry(env.DB, { ...f.operator, reviewId: item.reviewId });
    await env.DB.prepare("UPDATE reviewer_photo_cleanup_jobs SET status='RUNNING',lease_id='old',lease_expires_at='2000-01-01T00:00:00.000Z',revision=revision+1 WHERE review_id=?").bind(item.reviewId).run();
    await grantAdminAssurance(env.DB, { ...f.operator, now: new Date(now), method: "PASSWORD" });
    await expect(commitPhotoCleanupRetry(env.DB, { ...f.operator, operationId: preview.operationId })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect((await listPhotoCleanupJobs(env.DB, null, now)).rows.find((row) => row.id === item.reviewId)).toMatchObject({ status: "UNKNOWN", canRetry: false });
    expect(await recoverPendingReviewerPhotoCleanup(f.db, { delete: async () => { throw new Error("must not delete"); } }, { now })).toEqual({ deleted: 0, pending: 0, failed: 0 });
  });
});

it("deletes an exact 100-key owner plan within D1 binding limits", async () => {
  const f = await fixture(), item = await storedReview(f); await authorizeOwner(f);
  const statements = Array.from({ length: 4 }, (_, index) => {
    const key = `reviews/${item.reviewId}/photo-${index}.jpg`;
    return env.DB.prepare("INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,created_at,updated_at) VALUES(?,?,?,'image/jpeg',4,?,?,?)")
      .bind(`photo-${index}-${f.suffix}`, item.reviewId, key, index + 1, now, now);
  });
  await env.DB.batch(statements);
  await Promise.all(Array.from({ length: 99 }, (_, index) => env.REVIEW_PHOTOS.put(`reviews/${item.reviewId}/photo-${index}.jpg`, new Uint8Array([1,2,3,4]))));
  await enqueueReviewerPhotoDeletion(f.db, { reviewId: item.reviewId, now });
  // A deletion plan may retain old upload keys beyond the current five metadata rows.
  const plannedKeys = [item.key, ...Array.from({ length: 99 }, (_, index) => `reviews/${item.reviewId}/photo-${index}.jpg`)];
  await env.DB.prepare("UPDATE reviewer_photo_cleanup_jobs SET object_keys_json=?,revision=revision+1 WHERE review_id=?")
    .bind(JSON.stringify(plannedKeys), item.reviewId).run();
  expect(await recoverPendingReviewerPhotoCleanup(f.db, env.REVIEW_PHOTOS, { now, reviewId: item.reviewId })).toEqual({ deleted: 1, pending: 0, failed: 0 });
  expect(await env.DB.prepare("SELECT count(*) AS n FROM reviewer_visit_photos WHERE review_id=?").bind(item.reviewId).first()).toEqual({ n: 0 });
  expect(await env.REVIEW_PHOTOS.head(`reviews/${item.reviewId}/photo-98.jpg`)).toBeNull();
});
