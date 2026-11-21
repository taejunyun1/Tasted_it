import { createHash } from "node:crypto";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { enrollPrivatePlaceIntake } from "../../scripts/place-intake-enrollment.mjs";
import { createDb } from "../../app/db/client.server";
import { listPlaces } from "../../app/features/places/place.server";

const now = "2026-11-21T00:00:00.000Z";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const subject = {
  name: "합성 광주 식당",
  address: "광주광역시 동구 합성로 1 (동명동)",
  latitude: 35.15,
  longitude: 126.91,
};
const row = {
  ...subject, neighborhood: "동명동", categoryLabel: "한식", categorySlug: "korean-general", kind: "DINING",
  source: "SHARED_MAP", selection: "CANDIDATE", reason: null, note: null, photo: "NOT_SUPPLIED",
};
const newCafe = "합성 전북 반입 카페";
const outside = "합성 타지역 장소";
const input = JSON.stringify({ format: "retaste-place-intake-v1", label: "합성 연결", rows: [
  { ...row, position: 1 },
  { ...row, position: 2, name: newCafe, address: "전북특별자치도 전주시 합성길 2 (효자동)",
    neighborhood: "효자동", latitude: 35.81, longitude: 127.11, kind: "CAFE", categoryLabel: "카페", categorySlug: "cafe" },
  { ...row, position: 3, name: outside, address: "경기도 광주시 합성로 3" },
] });
const plan = JSON.stringify({ format: "retaste-intake-enrollment-v1", intakeSha256: hash(input), entries: [
  { mode: "LINK", position: 1, workItemId: "intake.test-work", licenseId: "intake-test-license", stageVersion: 5, subject },
  { mode: "CREATE", position: 2 },
] });
const options = { actorUserId: "intake-test-admin", approvedPlanSha256: hash(plan) };

it("links existing work without changing its stage, creates a private draft, and rolls back enrollment on drift", async () => {
  const db = env.DB;
  const appDb = createDb(db);
  await expect(enrollPrivatePlaceIntake(db, input, plan, options)).rejects.toThrow("PLACE_INTAKE_ADMIN_REQUIRED");
  expect(await db.prepare("SELECT count(*) AS n FROM place_intake_batches WHERE label='합성 연결'").first("n")).toBe(0);

  await db.batch([
    db.prepare(`INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at)
      VALUES('intake-test-admin','intake-enroll@example.test','관리자','ADMIN',?,?,?)`).bind(now, now, now),
    db.prepare(`INSERT INTO business_licenses(id,source_type,source_management_no,business_name,normalized_status,
      road_address,latitude,longitude,region_code,raw_payload,first_seen_at,last_seen_at,created_at,updated_at)
      VALUES('intake-test-license','GENERAL_RESTAURANT','intake-test-permit',?,'OPEN',?,?,?,'GWANGJU','{}',?,?,?,?)`)
      .bind(subject.name, subject.address, subject.latitude, subject.longitude, now, now, now, now),
    db.prepare(`INSERT INTO place_review_work_items(id,business_license_id,source_kind,stage,status,stage_version,created_at,updated_at)
      VALUES('intake.test-work','intake-test-license','PUBLIC_DATA','FINAL_APPROVAL','ACTIVE',6,?,?)`).bind(now, now),
  ]);

  const wrongSubject = JSON.stringify({ ...JSON.parse(plan), entries: [
    { ...JSON.parse(plan).entries[0], stageVersion: 6, subject: { ...subject, latitude: 35.16 } },
    JSON.parse(plan).entries[1],
  ] });
  await expect(enrollPrivatePlaceIntake(db, input, wrongSubject, { ...options, approvedPlanSha256: hash(wrongSubject) }))
    .rejects.toThrow("PLACE_INTAKE_ENROLLMENT_REJECTED");
  await expect(enrollPrivatePlaceIntake(db, input, plan, options)).rejects.toThrow("PLACE_INTAKE_ENROLLMENT_REJECTED");
  expect(await db.prepare("SELECT count(*) AS n FROM places WHERE name=?").bind(newCafe).first("n")).toBe(0);
  expect(await db.prepare("SELECT count(*) AS n FROM place_intake_review_links").first("n")).toBe(0);

  await db.prepare("UPDATE place_review_work_items SET stage_version=5 WHERE id='intake.test-work'").run();
  const result = await enrollPrivatePlaceIntake(db, input, plan, options);
  expect(result).toMatchObject({ total: 3, linked: 1, created: 1, state: "ENROLLED" });
  expect(await enrollPrivatePlaceIntake(db, input, plan, options)).toMatchObject({ state: "EXISTING" });
  const links = await db.prepare(`SELECT l.mode,w.stage,w.stage_version,p.status FROM place_intake_review_links l
      JOIN place_review_work_items w ON w.id=l.work_item_id LEFT JOIN places p ON p.id=w.place_id
      WHERE l.batch_id=? ORDER BY l.position`).bind(result.batchId).all();
  expect(links.results).toEqual([
    { mode: "LINK", stage: "FINAL_APPROVAL", stage_version: 5, status: null },
    { mode: "CREATE", stage: "SOURCE_REVIEW", stage_version: 0, status: "DRAFT" },
  ]);
  expect(await db.prepare("SELECT count(*) AS n FROM places WHERE name=?").bind(outside).first("n")).toBe(0);
  expect(await db.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE action='PLACE_INTAKE_REVIEW_ENROLL'").first("n")).toBe(1);
  expect(await listPlaces(appDb, { query: newCafe })).toHaveLength(0);
});
