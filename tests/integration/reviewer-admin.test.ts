import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { listPublishedPlaceReviewPhotos } from "../../app/features/ratings/reviewer-visit.server";
import { commitReviewerAdmin, getReviewerAdminPreview, prepareReviewerAdmin } from "../../app/features/reviewers/reviewer-admin.server";

const now = "2026-11-14T09:00:00.000Z";
const oldActivity = "2026-05-01T09:00:00.000Z";
const reason = "합성 운영 검토 사유";

async function user(role = "USER") {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id, `${id}@example.test`, "private-display-name", role, now, now, now).run();
  return id;
}
async function admin(fresh = true) {
  const actorUserId = await user("ADMIN"), sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(sessionId, actorUserId, "2099-01-01T00:00:00.000Z", now).run();
  if (fresh) await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)")
    .bind(sessionId, actorUserId, now, "2026-11-14T09:10:00.000Z").run();
  return { actorUserId, sessionId, now };
}
async function profile(status: "ACTIVE" | "DORMANT" | "SUSPENDED" = "ACTIVE", lastActivityAt = now, role = status === "ACTIVE" ? "REVIEWER" : "USER") {
  const id = await user(role);
  await env.DB.prepare(`INSERT INTO reviewer_profiles(user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,created_at,updated_at)
    VALUES(?,?,?,'시험','시험 취향','GWANGJU','[]',?,?,?,?)`)
    .bind(id, `reviewer-${id}`, status, lastActivityAt, oldActivity, now, now).run();
  return id;
}
async function application(storedCount: number) {
  const userId = await user(), id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO reviewer_applications(id,user_id,status,statement,occupation,taste_direction,region_code,specialty_slugs,approved_suggestion_count,created_at,updated_at)
    VALUES(?,?,'APPLIED','private-application-statement','시험','시험 취향','GWANGJU','[]',?,?,?)`)
    .bind(id, userId, storedCount, now, now).run();
  return { id, userId };
}
async function category() {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO categories(id,slug,name,emoji,sort_order,created_at,updated_at) VALUES(?,?,?,'🍽️',0,?,?)")
    .bind(id, id, "합성 분류", now, now).run();
  return id;
}
async function approvedSuggestions(userId: string, count: number) {
  const categoryId = await category(), ids = Array.from({ length: count }, () => crypto.randomUUID());
  if (ids.length) await env.DB.batch(ids.map((id) => env.DB.prepare(`INSERT INTO place_suggestions(id,user_id,status,name,normalized_name,address,normalized_address,neighborhood,category_id,created_at,updated_at)
    VALUES(?,?,'APPROVED','합성 장소','합성장소','합성 주소','합성주소','동명동',?,?,?)`).bind(id, userId, categoryId, now, now)));
  return ids;
}
async function operationId(prepared: Awaited<ReturnType<typeof prepareReviewerAdmin>>) {
  expect(prepared.operationId).toBeTruthy();
  return prepared.operationId!;
}
async function receiptCount(id: string) {
  return env.DB.prepare("SELECT count(*) AS n FROM admin_operation_commits WHERE operation_id=?").bind(id).first<number>("n");
}
async function centralAuditCount(id: string) {
  return env.DB.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE action='ADMIN_OPERATION_COMMITTED' AND target_type='ADMIN_OPERATION' AND target_id=?").bind(id).first<number>("n");
}

describe("reviewer administrator batches", () => {
  it("records ready and skipped items once and replays the same committed result", async () => {
    const actor = await admin(), ready = await profile(), alreadyDormant = await profile("DORMANT");
    const prepared = await prepareReviewerAdmin(env.DB, { ...actor, change: "DORMANT", targetIds: [ready, alreadyDormant], reason });
    expect(prepared.preview.items.filter((item) => item.outcome === "READY")).toHaveLength(1);
    expect(prepared.preview.items.filter((item) => item.outcome === "SKIPPED")).toHaveLength(1);
    const id = await operationId(prepared), input = { ...actor, operationId: id };
    await env.DB.prepare("UPDATE reviewer_profiles SET status='ACTIVE',updated_at=? WHERE user_id=?").bind(now, alreadyDormant).run();
    const reread = await getReviewerAdminPreview(env.DB, input);
    expect(reread).toMatchObject({ committed: false, items: expect.arrayContaining([
      expect.objectContaining({ outcome: "SKIPPED", previousStatus: "DORMANT" }),
    ]) });
    const first = await commitReviewerAdmin(env.DB, input), replay = await commitReviewerAdmin(env.DB, input);
    expect(first).toMatchObject({ replayed: false, result: { change: "DORMANT", requestedCount: 2, appliedCount: 1, skippedCount: 1 } });
    expect(replay).toMatchObject({ replayed: true, result: first.result });
    expect(first.result.results.map((item) => item.outcome).sort()).toEqual(["APPLIED", "SKIPPED"]);
    expect(JSON.stringify(first.result)).not.toMatch(/private-|@example|합성 운영 검토 사유/);
    expect(first.result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: ready, targetType: "PROFILE", outcome: "APPLIED" }),
      expect.objectContaining({ targetId: alreadyDormant, targetType: "PROFILE", outcome: "SKIPPED" }),
    ]));
    expect(await env.DB.prepare("SELECT status FROM reviewer_profiles WHERE user_id=?").bind(ready).first("status")).toBe("DORMANT");
    expect(await env.DB.prepare("SELECT status FROM reviewer_profiles WHERE user_id=?").bind(alreadyDormant).first("status")).toBe("ACTIVE");
    expect(await env.DB.prepare("SELECT role FROM users WHERE id=?").bind(ready).first("role")).toBe("USER");
    expect(await receiptCount(id)).toBe(1);
    expect(await centralAuditCount(id)).toBe(1);
    await env.DB.prepare("UPDATE users SET display_name='현재 표시 이름' WHERE id=?").bind(ready).run();
    const readyRef = first.result.results.find((item) => item.targetId === ready)!.targetRef;
    expect(await getReviewerAdminPreview(env.DB, input)).toMatchObject({ committed: true, displayNames: { [readyRef]: "현재 표시 이름" } });
  });

  it("rejects a same-timestamp version change and rolls every intended item back", async () => {
    const actor = await admin(), first = await profile(), second = await profile();
    const prepared = await prepareReviewerAdmin(env.DB, { ...actor, change: "SUSPENDED", targetIds: [first, second], reason });
    const id = await operationId(prepared);
    const previous = await env.DB.prepare("SELECT version FROM reviewer_profiles WHERE user_id=?").bind(first).first<number>("version");
    await env.DB.prepare("UPDATE reviewer_profiles SET taste_direction='동일 시각의 다른 변경',updated_at=? WHERE user_id=?").bind(now, first).run();
    expect(await env.DB.prepare("SELECT version FROM reviewer_profiles WHERE user_id=?").bind(first).first("version")).toBe(Number(previous) + 1);
    await expect(commitReviewerAdmin(env.DB, { ...actor, operationId: id })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    for (const userId of [first, second]) {
      expect(await env.DB.prepare("SELECT status FROM reviewer_profiles WHERE user_id=?").bind(userId).first("status")).toBe("ACTIVE");
      expect(await env.DB.prepare("SELECT role FROM users WHERE id=?").bind(userId).first("role")).toBe("REVIEWER");
    }
    expect(await receiptCount(id)).toBe(0); expect(await centralAuditCount(id)).toBe(0);
    expect(await env.DB.prepare("SELECT status FROM admin_operations WHERE id=?").bind(id).first("status")).toBe("PENDING");
  });

  it("keeps the stored-ten approval rule and displays submitted and current evidence separately", async () => {
    const actor = await admin(), storedTen = await application(10), currentTen = await application(0);
    await approvedSuggestions(currentTen.userId, 10);
    const prepared = await prepareReviewerAdmin(env.DB, { ...actor, change: "APPROVE", targetIds: [storedTen.id, currentTen.id], reason: "" });
    expect(prepared.preview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: "READY", submittedCount: 10, currentCount: 0 }),
      expect.objectContaining({ outcome: "SKIPPED", submittedCount: 0, currentCount: 10 }),
    ]));
    const result = await commitReviewerAdmin(env.DB, { ...actor, operationId: await operationId(prepared) });
    expect(result.result).toMatchObject({ requestedCount: 2, appliedCount: 1, skippedCount: 1 });
    expect(await env.DB.prepare("SELECT status FROM reviewer_applications WHERE id=?").bind(storedTen.id).first("status")).toBe("APPROVED");
    expect(await env.DB.prepare("SELECT status FROM reviewer_applications WHERE id=?").bind(currentTen.id).first("status")).toBe("APPLIED");
    expect(await env.DB.prepare("SELECT role FROM users WHERE id=?").bind(currentTen.userId).first("role")).toBe("USER");
  });

  it("does not approve against changed current suggestion evidence", async () => {
    const actor = await admin(), target = await application(10), [suggestion] = await approvedSuggestions(target.userId, 1);
    const prepared = await prepareReviewerAdmin(env.DB, { ...actor, change: "APPROVE", targetIds: [target.id], reason: "" });
    const id = await operationId(prepared);
    await env.DB.prepare("UPDATE place_suggestions SET status='REJECTED',updated_at=? WHERE id=?").bind(now, suggestion).run();
    await expect(commitReviewerAdmin(env.DB, { ...actor, operationId: id })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await env.DB.prepare("SELECT status FROM reviewer_applications WHERE id=?").bind(target.id).first("status")).toBe("APPLIED");
    expect(await env.DB.prepare("SELECT user_id FROM reviewer_profiles WHERE user_id=?").bind(target.userId).first()).toBeNull();
    expect(await receiptCount(id)).toBe(0);
  });

  it("approves one of two legacy open applications for the same user without a profile collision", async () => {
    const actor = await admin(), first = await application(10), secondId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO reviewer_applications(id,user_id,status,statement,occupation,taste_direction,region_code,specialty_slugs,approved_suggestion_count,created_at,updated_at)
      VALUES(?,?,'APPLIED','private-duplicate-statement','시험','시험 취향','GWANGJU','[]',10,?,?)`)
      .bind(secondId, first.userId, now, now).run();
    const prepared = await prepareReviewerAdmin(env.DB, { ...actor, change: "APPROVE", targetIds: [first.id, secondId], reason: "" });
    expect(prepared.preview.items.filter((item) => item.outcome === "READY")).toHaveLength(1);
    expect(prepared.preview.items.filter((item) => item.code === "DUPLICATE_APPLICANT")).toHaveLength(1);
    const result = await commitReviewerAdmin(env.DB, { ...actor, operationId: await operationId(prepared) });
    expect(result.result).toMatchObject({ requestedCount: 2, appliedCount: 1, skippedCount: 1 });
    expect(await env.DB.prepare("SELECT count(*) FROM reviewer_profiles WHERE user_id=?").bind(first.userId).first("count(*)")).toBe(1);
    const applications = (await env.DB.prepare("SELECT status FROM reviewer_applications WHERE id IN (?,?)").bind(first.id, secondId).all<{ status: string }>()).results;
    expect(applications.map((item) => item.status).sort()).toEqual(["APPLIED", "APPROVED"]);
  });

  it("keeps a newly active reviewer out of a previously prepared dormancy batch", async () => {
    const actor = await admin(), target = await profile("ACTIVE", oldActivity);
    const prepared = await prepareReviewerAdmin(env.DB, { ...actor, change: "AUTO_DORMANCY", targetIds: [target], reason: "" });
    const id = await operationId(prepared);
    await env.DB.prepare("UPDATE reviewer_profiles SET last_activity_at=?,updated_at=? WHERE user_id=?").bind(now, now, target).run();
    await expect(commitReviewerAdmin(env.DB, { ...actor, operationId: id })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await env.DB.prepare("SELECT status FROM reviewer_profiles WHERE user_id=?").bind(target).first("status")).toBe("ACTIVE");
    expect(await receiptCount(id)).toBe(0);
  });

  it("enforces recent authentication, session ownership and selection bounds without touching protected administrators", async () => {
    const actor = await admin(false), other = await admin(), target = await profile();
    const prepared = await prepareReviewerAdmin(env.DB, { ...actor, change: "SUSPENDED", targetIds: [target], reason });
    const id = await operationId(prepared);
    await expect(commitReviewerAdmin(env.DB, { ...actor, operationId: id })).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
    await expect(getReviewerAdminPreview(env.DB, { ...other, operationId: id })).rejects.toThrow();
    await expect(prepareReviewerAdmin(env.DB, { ...other, change: "SUSPENDED", targetIds: Array.from({ length: 26 }, () => crypto.randomUUID()), reason })).rejects.toThrow();
    await expect(prepareReviewerAdmin(env.DB, { ...other, change: "SUSPENDED", targetIds: [target, target], reason })).rejects.toThrow();
    const protectedTarget = await profile("ACTIVE", now, "ADMIN");
    const protectedPreview = await prepareReviewerAdmin(env.DB, { ...other, change: "SUSPENDED", targetIds: [protectedTarget], reason });
    expect(protectedPreview.preview.items).toEqual([expect.objectContaining({ outcome: "SKIPPED" })]);
    expect(await env.DB.prepare("SELECT role FROM users WHERE id=?").bind(protectedTarget).first("role")).toBe("ADMIN");
    expect(await receiptCount(id)).toBe(0);
    const demoted = await admin();
    const demotedPreview = await prepareReviewerAdmin(env.DB, { ...demoted, change: "SUSPENDED", targetIds: [target], reason });
    const demotedOperation = await operationId(demotedPreview);
    await env.DB.prepare("UPDATE users SET role='USER',updated_at=? WHERE id=?").bind(now, demoted.actorUserId).run();
    await expect(commitReviewerAdmin(env.DB, { ...demoted, operationId: demotedOperation })).rejects.toThrow("ADMIN_REQUIRED");
    expect(await receiptCount(demotedOperation)).toBe(0);
    expect(await env.DB.prepare("SELECT status FROM reviewer_profiles WHERE user_id=?").bind(target).first("status")).toBe("ACTIVE");
  });

  it("reactivates membership without republishing withdrawn reviews or photos", async () => {
    const actor = await admin(), target = await profile("DORMANT", oldActivity), categoryId = await category();
    const placeId = crypto.randomUUID(), reviewId = crypto.randomUUID(), photoId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,'합성 장소','PUBLISHED','합성 주소','동명동',35.1,126.9,'합성',?,?)")
      .bind(placeId, placeId, now, now).run();
    await env.DB.prepare(`INSERT INTO reviewer_visit_reviews(id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,status,is_current,published_at,created_at,updated_at)
      VALUES(?,?,?,?,'RECOMMEND','[]',1,'WITHDRAWN',1,?,?,?)`).bind(reviewId, placeId, target, categoryId, now, now, now).run();
    await env.DB.prepare("INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,created_at,updated_at) VALUES(?,?,?,'image/jpeg',4,0,?,?)")
      .bind(photoId, reviewId, `synthetic/${photoId}.jpg`, now, now).run();
    const prepared = await prepareReviewerAdmin(env.DB, { ...actor, change: "ACTIVE", targetIds: [target], reason });
    await commitReviewerAdmin(env.DB, { ...actor, operationId: await operationId(prepared) });
    expect(await env.DB.prepare("SELECT status FROM reviewer_profiles WHERE user_id=?").bind(target).first("status")).toBe("ACTIVE");
    expect(await env.DB.prepare("SELECT status FROM reviewer_visit_reviews WHERE id=?").bind(reviewId).first("status")).toBe("WITHDRAWN");
    expect(await env.DB.prepare("SELECT object_key FROM reviewer_visit_photos WHERE id=?").bind(photoId).first("object_key")).toBe(`synthetic/${photoId}.jpg`);
    expect(await listPublishedPlaceReviewPhotos(createDb(env.DB), placeId)).toEqual([]);
  });
});
