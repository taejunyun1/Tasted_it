import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { businessLicenses, categories, placeReviewWorkItems, places } from "../../app/db/schema";
import { prepareAdminOperation } from "../../app/features/operations/admin-operation.server";
import { confirmLocalDiningReview } from "../../app/features/places/local-dining-review.server";
import { commitPlaceAdminOperation, getPlaceAdminOperation, preparePlaceAdminOperation } from "../../app/features/places/place-admin.server";
import { newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";

const now = "2026-11-14T09:00:00.000Z";
const reason = "합성 관리 변경 사유";
const diningReason = "현장에서 좌석과 식사 제공을 확인했으며 독립적으로 운영하는 지역 식당입니다.";
const db = createDb(env.DB);

async function user(role: "USER" | "ADMIN" = "USER") {
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

async function place(status: "PUBLISHED" | "HIDDEN" = "PUBLISHED") {
  const id = crypto.randomUUID(), name = `합성 식당 ${id}`;
  await db.insert(places).values({ id, slug: id, name, status, address: "광주광역시 동구 동명로 10 (동명동)",
    neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: name, createdAt: now, updatedAt: now });
  return id;
}

async function publication(actorUserId: string, kind: "PLACE" | "LICENSE" = "PLACE") {
  const categoryId = crypto.randomUUID();
  await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "한식", emoji: "🍚", sortOrder: 0, createdAt: now, updatedAt: now });
  const id = kind === "PLACE" ? await place("HIDDEN") : crypto.randomUUID();
  if (kind === "LICENSE") await db.insert(businessLicenses).values({
    id, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: id, businessName: `지역식당 ${id}`, businessSubtype: "한식",
    salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
    roadAddress: "광주광역시 동구 동명로 10 (동명동)", latitude: 35.15, longitude: 126.92, regionCode: "GWANGJU", sourceUpdatedAt: now,
    rawPayload: "{}", reviewStatus: "PENDING", firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
  });
  const item = newReviewWorkItemValues(kind === "PLACE" ? { placeId: id, sourceKind: "PLACE_SUGGESTION", now } : { businessLicenseId: id, sourceKind: "PUBLIC_DATA", now });
  await db.insert(placeReviewWorkItems).values({ ...item, stage: "CATEGORY_CONFIRMATION", selectedCategoryId: categoryId });
  await confirmLocalDiningReview(db, { workItemIds: [item.id], expectedVersions: { [item.id]: 0 }, actorUserId, reason: diningReason, confirmed: true, now });
  await db.update(placeReviewWorkItems).set({ stage: "FINAL_APPROVAL" }).where(eq(placeReviewWorkItems.id, item.id));
  return { id, workItemId: item.id, categoryId };
}

async function mergeFixture() {
  const sourcePlaceId = await place(), targetPlaceId = await place(), userId = await user(), eventId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO vote_events(id,place_id,user_id,value,event_type,source,created_at) VALUES(?,?,?,1,'CREATE','GENERAL',?)")
    .bind(eventId, sourcePlaceId, userId, now).run();
  await env.DB.prepare("INSERT INTO current_votes(place_id,user_id,event_id,value,updated_at) VALUES(?,?,?,1,?)")
    .bind(sourcePlaceId, userId, eventId, now).run();
  await env.DB.prepare("INSERT INTO saved_places(user_id,place_id,created_at) VALUES(?,?,?)").bind(userId, sourcePlaceId, now).run();
  return { sourcePlaceId, targetPlaceId, userId, eventId };
}

async function placeRow(id: string) {
  return env.DB.prepare("SELECT * FROM places WHERE id=?").bind(id).first();
}

async function workItemRow(id: string) {
  return env.DB.prepare("SELECT * FROM place_review_work_items WHERE id=?").bind(id).first();
}

async function receiptCount(operationId: string) {
  return env.DB.prepare("SELECT count(*) AS n FROM admin_operation_commits WHERE operation_id=?").bind(operationId).first<number>("n");
}

async function auditCount(operationId: string) {
  return env.DB.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE action='ADMIN_OPERATION_COMMITTED' AND target_type='ADMIN_OPERATION' AND target_id=?")
    .bind(operationId).first<number>("n");
}

async function expectPending(operationId: string) {
  expect(await receiptCount(operationId)).toBe(0);
  expect(await auditCount(operationId)).toBe(0);
  expect(await env.DB.prepare("SELECT status FROM admin_operations WHERE id=?").bind(operationId).first("status")).toBe("PENDING");
}

describe("single-place administrative operations", () => {
  it("previews without publication and commits one durable result that replays", async () => {
    const actor = await admin(), target = await publication(actor.actorUserId);
    const beforePlace = await placeRow(target.id), beforeWorkItem = await workItemRow(target.workItemId);
    const prepared = await preparePlaceAdminOperation(env.DB, { ...actor, command: { change: "PUBLISH", workItemId: target.workItemId, reason: "" } });
    const input = { ...actor, operationId: prepared.operationId };
    expect(await getPlaceAdminOperation(env.DB, input)).toMatchObject({ status: "PENDING", change: "PUBLISH" });
    expect(await placeRow(target.id)).toEqual(beforePlace);
    expect(await workItemRow(target.workItemId)).toEqual(beforeWorkItem);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM place_categories WHERE place_id=?").bind(target.id).first("n")).toBe(0);
    await expectPending(prepared.operationId);

    const first = await commitPlaceAdminOperation(env.DB, input), replay = await commitPlaceAdminOperation(env.DB, input);
    expect(first).toMatchObject({ replayed: false, result: { change: "PUBLISH", requestedCount: 1, appliedCount: 1, skippedCount: 0, targetId: target.id } });
    expect(replay).toMatchObject({ replayed: true, result: first.result });
    expect(await placeRow(target.id)).toMatchObject({ status: "PUBLISHED" });
    expect(await workItemRow(target.workItemId)).toMatchObject({ status: "COMPLETED" });
    expect(await env.DB.prepare("SELECT category_id FROM place_categories WHERE place_id=? AND is_primary=1").bind(target.id).first("category_id")).toBe(target.categoryId);
    expect(await receiptCount(prepared.operationId)).toBe(1);
    expect(await auditCount(prepared.operationId)).toBe(1);
    expect(await getPlaceAdminOperation(env.DB, input)).toMatchObject({ status: "COMMITTED", result: first.result });
    expect(JSON.stringify(first.result)).not.toMatch(/private-|@example|합성 관리 변경 사유|현장에서/);

    const alreadyPublished = await publication(actor.actorUserId);
    await env.DB.prepare("UPDATE places SET status='PUBLISHED' WHERE id=?").bind(alreadyPublished.id).run();
    await env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,?,1)").bind(alreadyPublished.id, target.categoryId).run();
    const reclassify = await preparePlaceAdminOperation(env.DB, { ...actor, command: { change: "PUBLISH", workItemId: alreadyPublished.workItemId, reason: "" } });
    await commitPlaceAdminOperation(env.DB, { ...actor, operationId: reclassify.operationId });
    expect(await placeRow(alreadyPublished.id)).toMatchObject({ status: "PUBLISHED" });
    expect(await workItemRow(alreadyPublished.workItemId)).toMatchObject({ status: "COMPLETED" });
    expect(await env.DB.prepare("SELECT category_id FROM place_categories WHERE place_id=? AND is_primary=1").bind(alreadyPublished.id).first("category_id")).toBe(alreadyPublished.categoryId);
  });

  it("rechecks existing-place and license publication policy without changing rejected targets", async () => {
    const actor = await admin();
    for (const kind of ["PLACE", "LICENSE"] as const) {
      const target = await publication(actor.actorUserId, kind);
      const beforeItem = await workItemRow(target.workItemId);
      const beforeSubject = kind === "PLACE" ? await placeRow(target.id)
        : await env.DB.prepare("SELECT * FROM business_licenses WHERE id=?").bind(target.id).first();
      const prepared = await preparePlaceAdminOperation(env.DB, { ...actor, command: { change: "PUBLISH", workItemId: target.workItemId, reason: "" } });
      await db.update(categories).set({ isActive: false, updatedAt: now }).where(eq(categories.id, target.categoryId));
      await expect(commitPlaceAdminOperation(env.DB, { ...actor, operationId: prepared.operationId })).rejects.toThrow();
      expect(await workItemRow(target.workItemId)).toEqual(beforeItem);
      expect(kind === "PLACE" ? await placeRow(target.id)
        : await env.DB.prepare("SELECT * FROM business_licenses WHERE id=?").bind(target.id).first()).toEqual(beforeSubject);
      expect(await env.DB.prepare("SELECT count(*) AS n FROM place_source_links WHERE business_license_id=?").bind(target.id).first("n")).toBe(0);
      await expectPending(prepared.operationId);
      await expect(preparePlaceAdminOperation(env.DB, { ...actor, command: { change: "PUBLISH", workItemId: target.workItemId, reason: "" } })).rejects.toThrow();
    }
    const valid = await publication(actor.actorUserId, "LICENSE");
    const prepared = await preparePlaceAdminOperation(env.DB, { ...actor, command: { change: "PUBLISH", workItemId: valid.workItemId, reason: "" } });
    const committed = await commitPlaceAdminOperation(env.DB, { ...actor, operationId: prepared.operationId });
    const linked = (await env.DB.prepare("SELECT place_id FROM place_source_links WHERE business_license_id=?").bind(valid.id).all<{ place_id: string }>()).results;
    expect(linked).toHaveLength(1);
    expect(await placeRow(linked[0]!.place_id)).toMatchObject({ status: "PUBLISHED" });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM places WHERE name=(SELECT business_name FROM business_licenses WHERE id=?)").bind(valid.id).first("n")).toBe(1);
    expect(await env.DB.prepare("SELECT review_status FROM business_licenses WHERE id=?").bind(valid.id).first("review_status")).toBe("APPROVED");
    expect(committed).toMatchObject({ result: { change: "PUBLISH", targetId: linked[0]!.place_id } });
  });

  it("previews merge impact without moving relationships and applies each relationship once", async () => {
    const actor = await admin(), fixture = await mergeFixture();
    const existingAlias = `alias-${crypto.randomUUID()}`;
    await env.DB.prepare("INSERT INTO place_slug_redirects(old_slug,place_id,created_at) VALUES(?,?,?)").bind(existingAlias, fixture.sourcePlaceId, now).run();
    const prepared = await preparePlaceAdminOperation(env.DB, { ...actor, command: { change: "MERGE", sourcePlaceId: fixture.sourcePlaceId, targetPlaceId: fixture.targetPlaceId, reason } });
    const input = { ...actor, operationId: prepared.operationId };
    expect(await getPlaceAdminOperation(env.DB, input)).toMatchObject({ status: "PENDING", change: "MERGE", impact: {
      generalVotes: 1, memberSaves: 1, generalVotesForwarded: 1, sourceGeneralVotesRemoved: 1, reviewerVotesTransferred: 0,
    } });
    expect(await placeRow(fixture.sourcePlaceId)).toMatchObject({ status: "PUBLISHED" });
    expect(await env.DB.prepare("SELECT place_id FROM saved_places WHERE user_id=?").bind(fixture.userId).first("place_id")).toBe(fixture.sourcePlaceId);
    await expectPending(prepared.operationId);
    const first = await commitPlaceAdminOperation(env.DB, input);
    expect(first).toMatchObject({ replayed: false, result: { change: "MERGE", targetId: fixture.targetPlaceId, sourceId: fixture.sourcePlaceId } });
    expect(await commitPlaceAdminOperation(env.DB, input)).toMatchObject({ replayed: true, result: first.result });
    expect(await placeRow(fixture.sourcePlaceId)).toMatchObject({ status: "HIDDEN" });
    expect(await env.DB.prepare("SELECT place_id FROM saved_places WHERE user_id=?").bind(fixture.userId).first("place_id")).toBe(fixture.targetPlaceId);
    expect(await env.DB.prepare("SELECT value FROM current_votes WHERE user_id=? AND place_id=?").bind(fixture.userId, fixture.targetPlaceId).first("value")).toBe(1);
    expect(await env.DB.prepare("SELECT place_id FROM vote_events WHERE id=?").bind(fixture.eventId).first("place_id")).toBe(fixture.sourcePlaceId);
    expect(await env.DB.prepare("SELECT place_id FROM place_slug_redirects WHERE old_slug=?").bind(fixture.sourcePlaceId).first("place_id")).toBe(fixture.targetPlaceId);
    expect(await env.DB.prepare("SELECT place_id FROM place_slug_redirects WHERE old_slug=?").bind(existingAlias).first("place_id")).toBe(fixture.targetPlaceId);
    expect(await receiptCount(prepared.operationId)).toBe(1);
    expect(await auditCount(prepared.operationId)).toBe(1);
  });

  it("rejects same-timestamp edits both before commit and at the atomic-write boundary", async () => {
    const actor = await admin(), placeId = await place();
    const prepared = await preparePlaceAdminOperation(env.DB, { ...actor, command: { change: "RECALL", placeId, reason } });
    await env.DB.prepare("UPDATE places SET name='동일 시각 수정',updated_at=? WHERE id=?").bind(now, placeId).run();
    expect(await getPlaceAdminOperation(env.DB, { ...actor, operationId: prepared.operationId })).toMatchObject({ stale: true });
    await expect(commitPlaceAdminOperation(env.DB, { ...actor, operationId: prepared.operationId })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await placeRow(placeId)).toMatchObject({ status: "PUBLISHED", name: "동일 시각 수정" });
    await expectPending(prepared.operationId);

    const next = await preparePlaceAdminOperation(env.DB, { ...actor, command: { change: "RECALL", placeId, reason } });
    let raced = false;
    const boundaryDb = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch") return async (statements: D1PreparedStatement[]) => {
          if (!raced) {
            raced = true;
            await env.DB.prepare("UPDATE places SET address='광주광역시 동구 다른 주소',updated_at=? WHERE id=?").bind(now, placeId).run();
          }
          return target.batch(statements);
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(commitPlaceAdminOperation(boundaryDb, { ...actor, operationId: next.operationId })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(raced).toBe(true);
    expect(await placeRow(placeId)).toMatchObject({ status: "PUBLISHED", address: "광주광역시 동구 다른 주소" });
    await expectPending(next.operationId);
  });

  it("restores only the exact current recall receipt and refuses intervening edits", async () => {
    const actor = await admin(), restoringAdmin = await admin(), placeId = await place();
    const recall = await preparePlaceAdminOperation(env.DB, { ...actor, command: { change: "RECALL", placeId, reason } });
    const recalled = await commitPlaceAdminOperation(env.DB, { ...actor, operationId: recall.operationId });
    expect(await placeRow(placeId)).toMatchObject({ status: "HIDDEN" });
    await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(actor.sessionId).run();
    expect(await env.DB.prepare("SELECT session_id FROM admin_operations WHERE id=?").bind(recall.operationId).first("session_id")).toBeNull();

    // Synthetic durable-looking receipt has the real result but no central audit proof.
    const forged = await prepareAdminOperation(env.DB, { ...restoringAdmin, kind: "PLACE_ADMIN_CHANGE", payload: {}, summary: { title: "합성 회수 영수증", count: 1 } });
    await env.DB.prepare("INSERT INTO admin_operation_commits(operation_id,actor_user_id,session_id,kind,committed_at) VALUES(?,?,?,'PLACE_ADMIN_CHANGE',?)")
      .bind(forged.operationId, restoringAdmin.actorUserId, restoringAdmin.sessionId, now).run();
    await env.DB.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json=?,committed_at=? WHERE id=?")
      .bind(JSON.stringify({ ...recalled.result, recallOperationId: forged.operationId }), now, forged.operationId).run();
    await expect(preparePlaceAdminOperation(env.DB, { ...restoringAdmin, command: { change: "RESTORE_RECALL", recallOperationId: forged.operationId, reason } })).rejects.toThrow();

    const restore = await preparePlaceAdminOperation(env.DB, { ...restoringAdmin, command: { change: "RESTORE_RECALL", recallOperationId: recall.operationId, reason } });
    expect(await placeRow(placeId)).toMatchObject({ status: "HIDDEN" });
    expect(await commitPlaceAdminOperation(env.DB, { ...restoringAdmin, operationId: restore.operationId })).toMatchObject({ result: { change: "RESTORE_RECALL", targetId: placeId, recallOperationId: recall.operationId } });
    expect(await placeRow(placeId)).toMatchObject({ status: "PUBLISHED" });
    await expect(preparePlaceAdminOperation(env.DB, { ...restoringAdmin, command: { change: "RESTORE_RECALL", recallOperationId: crypto.randomUUID(), reason } })).rejects.toThrow();

    const nextRecall = await preparePlaceAdminOperation(env.DB, { ...restoringAdmin, command: { change: "RECALL", placeId, reason } });
    await commitPlaceAdminOperation(env.DB, { ...restoringAdmin, operationId: nextRecall.operationId });
    await expect(preparePlaceAdminOperation(env.DB, { ...restoringAdmin, command: { change: "RESTORE_RECALL", recallOperationId: recall.operationId, reason } })).rejects.toThrow();
    const nextRestore = await preparePlaceAdminOperation(env.DB, { ...restoringAdmin, command: { change: "RESTORE_RECALL", recallOperationId: nextRecall.operationId, reason } });
    await env.DB.prepare("UPDATE places SET name='회수 이후 편집',updated_at=? WHERE id=?").bind(now, placeId).run();
    await expect(commitPlaceAdminOperation(env.DB, { ...restoringAdmin, operationId: nextRestore.operationId })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await placeRow(placeId)).toMatchObject({ status: "HIDDEN", name: "회수 이후 편집" });
    await expectPending(nextRestore.operationId);
  });

  it("requires current authority, recent authentication, the original session and one target", async () => {
    const actor = await admin(false), other = await admin(), placeId = await place();
    const command = { change: "RECALL" as const, placeId, reason };
    const prepared = await preparePlaceAdminOperation(env.DB, { ...actor, command });
    await expect(commitPlaceAdminOperation(env.DB, { ...actor, operationId: prepared.operationId })).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
    await expect(getPlaceAdminOperation(env.DB, { ...other, operationId: prepared.operationId })).rejects.toThrow();
    const secondSession = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)")
      .bind(secondSession, actor.actorUserId, "2099-01-01T00:00:00.000Z", now).run();
    await expect(getPlaceAdminOperation(env.DB, { ...actor, sessionId: secondSession, operationId: prepared.operationId })).rejects.toThrow();
    await expect(prepareAdminOperation(env.DB, { ...other, kind: "PLACE_ADMIN_CHANGE", payload: {}, summary: { title: "합성 두 대상", count: 2 } })).rejects.toThrow("ADMIN_OPERATION_INPUT_INVALID");
    await expect(preparePlaceAdminOperation(env.DB, { ...other, command: { ...command, placeId: [placeId, await place()] } as never })).rejects.toThrow();
    await env.DB.prepare("UPDATE users SET role='USER',updated_at=? WHERE id=?").bind(now, actor.actorUserId).run();
    await expect(commitPlaceAdminOperation(env.DB, { ...actor, operationId: prepared.operationId })).rejects.toThrow("ADMIN_REQUIRED");
    expect(await placeRow(placeId)).toMatchObject({ status: "PUBLISHED" });
    await expectPending(prepared.operationId);
  });

  it("rejects a merge that would create participation for an actively restricted voter or save-choice author", async () => {
    const actor = await admin(false);
    for (const kind of ["GENERAL", "SAVE_CHOICE"] as const) {
      const fixture = kind === "GENERAL" ? await mergeFixture()
        : { sourcePlaceId: await place(), targetPlaceId: await place(), userId: await user(), eventId: null };
      if (kind === "SAVE_CHOICE") await env.DB.prepare("INSERT INTO member_save_choices(user_id,place_id,saved,updated_at) VALUES(?,?,1,?)")
        .bind(fixture.userId, fixture.sourcePlaceId, now).run();
      const at = new Date();
      await env.DB.prepare("INSERT INTO member_access_restrictions(user_id,version,reason,starts_at,expires_at,updated_by,updated_at) VALUES(?,1,'synthetic active restriction',?,?,?,?)")
        .bind(fixture.userId, new Date(at.getTime() - 60_000).toISOString(), new Date(at.getTime() + 600_000).toISOString(), actor.actorUserId, at.toISOString()).run();
      const beforeSource = await placeRow(fixture.sourcePlaceId), beforeTarget = await placeRow(fixture.targetPlaceId);
      const beforeVotes = (await env.DB.prepare("SELECT * FROM current_votes WHERE place_id IN (?,?) ORDER BY place_id,user_id")
        .bind(fixture.sourcePlaceId, fixture.targetPlaceId).all()).results;
      const beforeChoices = (await env.DB.prepare("SELECT * FROM member_save_choices WHERE user_id=? ORDER BY place_id").bind(fixture.userId).all()).results;
      await expect(preparePlaceAdminOperation(env.DB, { ...actor, now: at.toISOString(), command: {
        change: "MERGE", sourcePlaceId: fixture.sourcePlaceId, targetPlaceId: fixture.targetPlaceId, reason,
      } })).rejects.toThrow("PLACE_ADMIN_RESTRICTED_PARTICIPANT");
      expect(await placeRow(fixture.sourcePlaceId)).toEqual(beforeSource);
      expect(await placeRow(fixture.targetPlaceId)).toEqual(beforeTarget);
      expect((await env.DB.prepare("SELECT * FROM current_votes WHERE place_id IN (?,?) ORDER BY place_id,user_id")
        .bind(fixture.sourcePlaceId, fixture.targetPlaceId).all()).results).toEqual(beforeVotes);
      expect((await env.DB.prepare("SELECT * FROM member_save_choices WHERE user_id=? ORDER BY place_id").bind(fixture.userId).all()).results).toEqual(beforeChoices);
      expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_operations WHERE actor_user_id=?").bind(actor.actorUserId).first("n")).toBe(0);
    }
  });

  it("rolls merge relationships, receipt and audit back together when the final audit fails", async () => {
    const actor = await admin(), fixture = await mergeFixture();
    const prepared = await preparePlaceAdminOperation(env.DB, { ...actor, command: { change: "MERGE", sourcePlaceId: fixture.sourcePlaceId, targetPlaceId: fixture.targetPlaceId, reason } });
    await env.DB.exec("CREATE TRIGGER fail_b09_operation_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='ADMIN_OPERATION_COMMITTED' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
    try {
      await expect(commitPlaceAdminOperation(env.DB, { ...actor, operationId: prepared.operationId })).rejects.toThrow();
    } finally {
      await env.DB.exec("DROP TRIGGER fail_b09_operation_audit");
    }
    expect(await placeRow(fixture.sourcePlaceId)).toMatchObject({ status: "PUBLISHED" });
    expect(await env.DB.prepare("SELECT place_id FROM saved_places WHERE user_id=?").bind(fixture.userId).first("place_id")).toBe(fixture.sourcePlaceId);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM current_votes WHERE place_id=?").bind(fixture.targetPlaceId).first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM place_slug_redirects WHERE old_slug=?").bind(fixture.sourcePlaceId).first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM place_revisions WHERE place_id IN (?,?)").bind(fixture.sourcePlaceId, fixture.targetPlaceId).first("n")).toBe(0);
    await expectPending(prepared.operationId);
    expect(await commitPlaceAdminOperation(env.DB, { ...actor, operationId: prepared.operationId })).toMatchObject({ replayed: false, result: { change: "MERGE" } });
    expect(await receiptCount(prepared.operationId)).toBe(1);
  });
});
