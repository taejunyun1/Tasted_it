import { createHash } from "node:crypto";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { enrollPrivatePlaceIntake } from "../../scripts/place-intake-enrollment.mjs";
import { reopenHeldPlaceIntakeReview } from "../../scripts/place-intake-held-review.mjs";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

it("reopens only the approved held license with recent password assurance and one atomic audit", async () => {
  const db = env.DB;
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 60_000).toISOString();
  const expires = new Date(Date.now() + 60_000).toISOString();
  const operator = "held-reopen-admin";
  const workItemId = "held-reopen-work";
  const licenseId = "held-reopen-license";
  const auditId = "held-reopen-audit";
  const selectedCategoryId = await db.prepare("SELECT id FROM categories WHERE slug='other'").first<string>("id");
  expect(selectedCategoryId).toBeTruthy();
  const subject = { name: "합성 보류 식당", address: "광주광역시 동구 합성로 1 (동명동)", latitude: 35.15, longitude: 126.91 };
  const input = JSON.stringify({ format: "retaste-place-intake-v1", label: "합성 보류 재검수", rows: [{
    ...subject, position: 1, neighborhood: "동명동", categoryLabel: "양식", categorySlug: "western-general", kind: "DINING",
    source: "SHARED_MAP", selection: "CANDIDATE", reason: null, note: null, photo: "NOT_SUPPLIED",
  }] });
  const enrollment = JSON.stringify({ format: "retaste-intake-enrollment-v1", intakeSha256: hash(input), entries: [
    { mode: "LINK", position: 1, workItemId, licenseId, stageVersion: 5, subject },
  ] });

  await db.batch([
    db.prepare(`INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at)
      VALUES(?,'held-reopen@example.test','관리자','ADMIN',?,?,?)`).bind(operator, earlier, earlier, earlier),
    db.prepare(`INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,created_at)
      VALUES('held-reopen-designation',?,'OPERATOR_ADMIN_PROVISIONED','USER',?,?)`).bind(operator, operator, earlier),
    db.prepare(`INSERT INTO sessions(id,user_id,created_at,expires_at)
      VALUES('held-reopen-session',?,?,?)`).bind(operator, earlier, expires),
    db.prepare(`INSERT INTO business_licenses(id,source_type,source_management_no,business_name,normalized_status,
      road_address,latitude,longitude,region_code,raw_payload,first_seen_at,last_seen_at,created_at,updated_at)
      VALUES(?,'GENERAL_RESTAURANT','held-reopen-permit',?,'OPEN',?,?,?,'GWANGJU','{}',?,?,?,?)`)
      .bind(licenseId, subject.name, subject.address, subject.latitude, subject.longitude, earlier, earlier, earlier, earlier),
    db.prepare(`INSERT INTO place_review_work_items(id,business_license_id,source_kind,stage,status,stage_version,
      selected_category_id,category_override_reason,manual_evidence_reason,local_dining_evidence_json,created_at,updated_at)
      VALUES(?,?,'PUBLIC_DATA','FINAL_APPROVAL','ACTIVE',5,?,'former category','manual evidence','{}',?,?)`)
      .bind(workItemId, licenseId, selectedCategoryId, earlier, earlier),
  ]);
  const { batchId } = await enrollPrivatePlaceIntake(db, input, enrollment, { actorUserId: operator, approvedPlanSha256: hash(enrollment) });
  await db.prepare(`UPDATE place_review_work_items SET status='ON_HOLD',hold_code='ADMIN_REVIEW_HOLD',hold_note='original hold'
    WHERE id=?`).bind(workItemId).run();
  const plan = { batchId, position: 1, workItemId, licenseId, stageVersion: 5, stage: "FINAL_APPROVAL",
    categoryId: selectedCategoryId, targetCategorySlug: "western-general", actorUserId: operator, auditId,
    reason: "Matched permit and in-person dining source evidence." };
  const planText = JSON.stringify(plan);
  const reopen = (text = planText, approval = hash(text)) =>
    reopenHeldPlaceIntakeReview(db, text, { approvedPlanSha256: approval, now });
  const readWork = () => db.prepare("SELECT * FROM place_review_work_items WHERE id=?").bind(workItemId).first();
  const readAudit = () => db.prepare("SELECT * FROM admin_audit_logs WHERE id=?").bind(auditId).first();

  await expect(reopen()).rejects.toThrow("PLACE_INTAKE_REOPEN_REJECTED");
  await db.prepare(`INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at)
    VALUES('held-reopen-session',?,'PASSWORD',?,?)`).bind(operator, earlier, expires).run();
  await expect(reopen(`${planText} `, hash(planText))).rejects.toThrow("PLACE_INTAKE_REOPEN_PLAN_NOT_APPROVED");
  await expect(reopen(JSON.stringify({ ...plan, stageVersion: 4 }))).rejects.toThrow("PLACE_INTAKE_REOPEN_REJECTED");
  await db.prepare("UPDATE business_licenses SET latitude=35.16 WHERE id=?").bind(licenseId).run();
  await expect(reopen()).rejects.toThrow("PLACE_INTAKE_REOPEN_REJECTED");
  await db.prepare("UPDATE business_licenses SET latitude=? WHERE id=?").bind(subject.latitude, licenseId).run();

  const orphanId = "held-reopen-orphan-audit";
  const orphanPlan = JSON.stringify({ ...plan, auditId: orphanId });
  const orphanAfter = JSON.stringify({ status: "ACTIVE", stage: "CATEGORY_CONFIRMATION", stageVersion: 6,
    categoryId: null, targetCategorySlug: plan.targetCategorySlug, reason: plan.reason, approvedPlanSha256: hash(orphanPlan) });
  await db.batch([
    db.prepare(`INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at)
      VALUES(?,?,'PLACE_INTAKE_REVIEW_REOPEN','PLACE_REVIEW_WORK_ITEM',?,?,?)`).bind(orphanId, operator, workItemId, orphanAfter, now),
    db.prepare("UPDATE admin_session_assurances SET expires_at=? WHERE session_id='held-reopen-session'").bind(earlier),
  ]);
  await expect(reopen(orphanPlan)).rejects.toThrow("PLACE_INTAKE_REOPEN_REJECTED");
  expect(await readWork()).toMatchObject({ status: "ON_HOLD", stage_version: 5 });
  await db.prepare("UPDATE admin_session_assurances SET expires_at=? WHERE session_id='held-reopen-session'").bind(expires).run();
  await expect(reopen(orphanPlan)).rejects.toThrow("UNIQUE constraint failed");
  expect(await readWork()).toMatchObject({ status: "ON_HOLD", stage_version: 5 });

  await db.prepare(`CREATE TRIGGER test_held_reopen_guard BEFORE UPDATE OF status ON place_review_work_items
    WHEN OLD.status='ON_HOLD' AND NEW.status='ACTIVE' BEGIN SELECT RAISE(IGNORE); END`).run();
  await expect(reopen()).rejects.toThrow("PLACE_INTAKE_REOPEN_REJECTED");
  expect(await readAudit()).toBeNull();
  expect(await readWork()).toMatchObject({ status: "ON_HOLD", stage_version: 5 });
  await db.prepare("DROP TRIGGER test_held_reopen_guard").run();

  await expect(reopen()).resolves.toEqual({ applied: 1, state: "REOPENED" });
  await expect(reopen()).resolves.toEqual({ applied: 0, state: "EXISTING" });
  expect(await readWork()).toMatchObject({ status: "ACTIVE", stage: "CATEGORY_CONFIRMATION", stage_version: 6,
    selected_category_id: null, category_override_reason: null, manual_evidence_reason: "manual evidence",
    local_dining_evidence_json: "{}", hold_code: null, hold_note: null, last_transition_by: operator });
  const audit = await readAudit();
  expect(audit).toMatchObject({ action: "PLACE_INTAKE_REVIEW_REOPEN", target_id: workItemId, actor_user_id: operator });
  expect(JSON.parse(audit!.before_state as string)).toMatchObject({ status: "ON_HOLD", stage: "FINAL_APPROVAL",
    stageVersion: 5, categoryId: selectedCategoryId, categoryReason: "former category", holdNote: "original hold" });
  expect(await db.prepare("SELECT subject_address FROM place_intake_review_links WHERE work_item_id=?").bind(workItemId)
    .first("subject_address")).toBe(subject.address);
  expect(await db.prepare("SELECT count(*) AS n FROM place_source_links WHERE business_license_id=?").bind(licenseId)
    .first("n")).toBe(0);

  await db.prepare("UPDATE place_review_work_items SET status='ON_HOLD',hold_code='ADMIN_REVIEW_HOLD' WHERE id=?")
    .bind(workItemId).run();
  const categoryPlan = JSON.stringify({ ...plan, stage: "CATEGORY_CONFIRMATION", stageVersion: 6, categoryId: null,
    auditId: "held-reopen-category-audit" });
  await expect(reopen(categoryPlan)).resolves.toEqual({ applied: 1, state: "REOPENED" });
  expect(await readWork()).toMatchObject({ status: "ACTIVE", stage: "CATEGORY_CONFIRMATION", stage_version: 7,
    selected_category_id: null });
});

it.each([false, true])("reopens a matching held draft at NAVER verification with a unit correction %s", async (correctUnit) => {
  const db = env.DB;
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 60_000).toISOString();
  const expires = new Date(Date.now() + 60_000).toISOString();
  const prefix = correctUnit ? "held-unit" : "held-create";
  const operator = `${prefix}-admin`;
  const session = `${prefix}-session`;
  const auditId = `${prefix}-reopen-audit`;
  const revisionId = "bc785dcb-cbbd-4587-ad1c-c5da703458db";
  const selectedCategoryId = await db.prepare("SELECT id FROM categories WHERE slug='other'").first<string>("id");
  expect(selectedCategoryId).toBeTruthy();
  const subject = { name: correctUnit ? "합성 호수 보류 카페" : "합성 보류 카페",
    address: "전북특별자치도 전주시 합성로 1 (효자동)", latitude: 35.81, longitude: 127.11 };
  const input = JSON.stringify({ format: "retaste-place-intake-v1", label: "합성 초안 재검수", rows: [{
    ...subject, position: 1, neighborhood: "효자동", categoryLabel: "카페", categorySlug: "cafe", kind: "CAFE",
    source: "SHARED_MAP", selection: "CANDIDATE", reason: null, note: null, photo: "NOT_SUPPLIED",
  }] });
  const enrollment = JSON.stringify({ format: "retaste-intake-enrollment-v1", intakeSha256: hash(input), entries: [{ mode: "CREATE", position: 1 }] });
  await db.batch([
    db.prepare(`INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at)
      VALUES(?,?,'관리자','ADMIN',?,?,?)`).bind(operator, `${prefix}@example.test`, earlier, earlier, earlier),
    db.prepare(`INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,created_at)
      VALUES(?,?,'OPERATOR_ADMIN_PROVISIONED','USER',?,?)`).bind(`${prefix}-designation`, operator, operator, earlier),
    db.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)").bind(session, operator, earlier, expires),
    db.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)")
      .bind(session, operator, earlier, expires),
  ]);
  const { batchId } = await enrollPrivatePlaceIntake(db, input, enrollment,
    { actorUserId: operator, approvedPlanSha256: hash(enrollment) });
  const draft = await db.prepare(`SELECT w.id,w.place_id FROM place_intake_review_links l
    JOIN place_review_work_items w ON w.id=l.work_item_id WHERE l.batch_id=? AND l.position=1`).bind(batchId)
    .first<{ id: string; place_id: string }>();
  expect(draft).toBeTruthy();
  const { id: workItemId, place_id: placeId } = draft!;
  await db.prepare(`UPDATE place_review_work_items SET stage='NAVER_VERIFICATION',status='ON_HOLD',stage_version=2,
    hold_code='ADMIN_REVIEW_HOLD',selected_category_id=?,category_override_reason='category evidence',
    manual_evidence_reason='manual evidence',local_dining_evidence_json='{}' WHERE id=?`).bind(selectedCategoryId, workItemId).run();

  const plan = { mode: "CREATE", batchId, position: 1, workItemId, placeId, stageVersion: 2,
    stage: "NAVER_VERIFICATION", categoryId: selectedCategoryId, targetCategorySlug: "cafe", actorUserId: operator,
    auditId, reason: "Matched the archived draft and current in-person service evidence.",
    ...(correctUnit ? { unitCorrection: { revisionId, originalAddress: subject.address, unit: 2 } } : {}),
  };
  const planText = JSON.stringify(plan);
  const reopen = (text = planText) => reopenHeldPlaceIntakeReview(db, text, { approvedPlanSha256: hash(text), now });
  const readRevision = () => db.prepare("SELECT * FROM place_revisions WHERE id=?").bind(revisionId).first();
  await db.prepare("UPDATE places SET address='changed source' WHERE id=?").bind(placeId).run();
  await expect(reopen()).rejects.toThrow("PLACE_INTAKE_REOPEN_REJECTED");
  expect(await db.prepare("SELECT id FROM admin_audit_logs WHERE id=?").bind(auditId).first()).toBeNull();
  await db.prepare("UPDATE places SET address=? WHERE id=?").bind(subject.address, placeId).run();

  if (correctUnit) {
    await expect(reopen(JSON.stringify({ ...plan, unitCorrection: { revisionId, originalAddress: "다른 주소 2 (효자동)", unit: 2 } })))
      .rejects.toThrow("PLACE_INTAKE_REOPEN_REJECTED");
    await expect(reopen(JSON.stringify({ ...plan, unitCorrection: { revisionId, originalAddress: subject.address, unit: -1 } })))
      .rejects.toThrow("PLACE_INTAKE_REOPEN_PLAN_INVALID");
    await db.prepare(`CREATE TRIGGER test_held_unit_guard BEFORE UPDATE OF address ON places
      WHEN NEW.id=OLD.id BEGIN SELECT RAISE(IGNORE); END`).run();
    await expect(reopen()).rejects.toThrow("PLACE_INTAKE_REOPEN_REJECTED");
    expect(await db.prepare("SELECT id FROM admin_audit_logs WHERE id=?").bind(auditId).first()).toBeNull();
    expect(await readRevision()).toBeNull();
    expect(await db.prepare("SELECT status,stage_version FROM place_review_work_items WHERE id=?").bind(workItemId).first())
      .toEqual({ status: "ON_HOLD", stage_version: 2 });
    await db.prepare("DROP TRIGGER test_held_unit_guard").run();
  }

  await expect(reopen()).resolves.toEqual({ applied: 1, state: "REOPENED" });
  await expect(reopen()).resolves.toEqual({ applied: 0, state: "EXISTING" });
  expect(await db.prepare("SELECT * FROM place_review_work_items WHERE id=?").bind(workItemId).first()).toMatchObject({
    place_id: placeId, business_license_id: null, status: "ACTIVE", stage: "NAVER_VERIFICATION", stage_version: 3,
    selected_category_id: selectedCategoryId, category_override_reason: "category evidence",
    manual_evidence_reason: "manual evidence", local_dining_evidence_json: "{}", hold_code: null,
  });
  const expectedAddress = correctUnit ? "전북특별자치도 전주시 합성로 1, 2호 (효자동)" : subject.address;
  expect(await db.prepare("SELECT status,address,search_text,latitude,longitude FROM places WHERE id=?").bind(placeId).first()).toEqual({
    status: "DRAFT", address: expectedAddress, search_text: `${subject.name} ${expectedAddress} 효자동`,
    latitude: subject.latitude, longitude: subject.longitude,
  });
  expect(await db.prepare("SELECT subject_address FROM place_intake_review_links WHERE work_item_id=?").bind(workItemId)
    .first("subject_address")).toBe(subject.address);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action='PLACE_INTAKE_REVIEW_REOPEN' AND target_id=?")
    .bind(workItemId).first("n")).toBe(1);
  if (correctUnit) {
    expect(await readRevision()).toMatchObject({ id: revisionId, place_id: placeId, actor_user_id: operator, action: "CORRECTION",
      source_type: "INTAKE_UNIT_CORRECTION", source_id: workItemId, reason: plan.reason,
      before_json: JSON.stringify({ address: subject.address }),
      after_json: JSON.stringify({ address: expectedAddress, batchId, position: 1, unit: 2, approvedPlanSha256: hash(planText) }),
    });
    await db.prepare("DELETE FROM place_revisions WHERE id=?").bind(revisionId).run();
    await expect(reopen()).rejects.toThrow("PLACE_INTAKE_REOPEN_REJECTED");
  } else {
    expect(await readRevision()).toBeNull();
  }
});
