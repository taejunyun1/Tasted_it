import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { places } from "../../app/db/schema";
import { ADMIN_OPERATION_POLICY, prepareAdminOperation } from "../../app/features/operations/admin-operation.server";
import { B17_REQUIRED_COLUMNS, compareB17Snapshots } from "../../scripts/b17-rollout-evidence.mjs";
import { seedApprovedReviewerVote } from "./reviewer-public-fixtures";

const MIGRATED_TABLES = [
  "admin_operations", "admin_operation_commits", "admin_operation_checks",
  "rating_recompute_jobs", "public_data_sync_runs", "parking_sync_runs", "reviewer_photo_cleanup_jobs",
] as const;
const UNCHANGED_TABLES = [
  "users", "sessions", "places", "rating_configs", "rating_snapshots", "reviewer_visit_reviews",
  "vote_events", "current_votes", "parking_data_snapshots", "naver_local_category_runs", "admin_audit_logs",
] as const;
const UPGRADE_NAMES = [
  "0050_admin_rating_job_control.sql", "0051_admin_public_sync.sql", "0052_admin_parking_job_control.sql",
  "0053_provider_usage.sql", "0054_admin_feature_stop.sql", "0055_admin_privacy_operations.sql",
  "0056_admin_reliability.sql", "0059_email_domain_control.sql", "0060_rating_config_eligibility.sql",
];

async function capture(database: D1Database) {
  const tables: Record<string, { columns: string[]; rows: Record<string, unknown>[] }> = {};
  for (const table of MIGRATED_TABLES) {
    const columns = (await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((c) => c.name);
    const rows = (await database.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all<Record<string, unknown>>()).results;
    tables[table] = { columns: ["rowid", ...columns], rows };
  }
  return { tables };
}

it("preserves a populated 0049 database through all nine B17 migrations without invoking providers", async () => {
  const database = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  await applyD1Migrations(database, env.TEST_MIGRATIONS.filter((migration) => migration.name < "0050"));
  const now = new Date().toISOString(), expires = new Date(Date.now() + 600_000).toISOString();
  const actorUserId = "b17-rehearsal-admin", sessionId = "b17-rehearsal-session";
  await database.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,'합성 운영자','ADMIN',?,?,?)")
    .bind(actorUserId, "b17-rehearsal@example.test", now, now, now).run();
  await database.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(sessionId, actorUserId, expires, now).run();
  for (const [rowid, id] of [[101, "b17-pending"], [203, "b17-completed"]] as const) {
    await database.prepare(`INSERT INTO admin_operations(rowid,id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at)
      VALUES(?,?,'RATING_RECOMPUTE',?,?,'{"fixture":"preserve"}','fixture-hash','{"title":"합성 보존","count":1}',0,?,?)`)
      .bind(rowid, id, actorUserId, sessionId, now, expires).run();
  }
  await database.prepare("INSERT INTO admin_operation_commits(rowid,operation_id,actor_user_id,session_id,kind,committed_at) VALUES(307,'b17-completed',?,?,'RATING_RECOMPUTE',?)")
    .bind(actorUserId, sessionId, now).run();
  await database.prepare("INSERT INTO admin_operation_checks(rowid,operation_id,check_name,passed) VALUES(409,'b17-completed','preserve',1)").run();
  await database.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json='{}',committed_at=? WHERE id='b17-completed'").bind(now).run();
  await database.prepare("UPDATE admin_operations SET session_id=NULL WHERE id='b17-pending'").run();
  await database.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at) VALUES('b17-existing-audit',?,'ADMIN_OPERATION_COMMITTED','ADMIN_OPERATION','b17-completed','{}',?)")
    .bind(actorUserId, now).run();

  const db = createDb(database), placeId = "b17-rehearsal-place";
  await db.insert(places).values({ id: placeId, slug: placeId, name: "합성 장소", status: "PUBLISHED", address: "합성 주소", neighborhood: "합성", latitude: 35.1, longitude: 126.9, searchText: placeId, createdAt: now, updatedAt: now });
  const { reviewId } = await seedApprovedReviewerVote(db, { reviewerId: actorUserId, placeId, eventId: "b17-source-vote", value: 1, now, projectVote: true });
  await database.prepare(`INSERT INTO rating_snapshots(id,place_id,config_id,input_hash,overall_score,user_score,reviewer_score,overall_sample_count,user_sample_count,reviewer_sample_count,reviewer_raw_weight,reviewer_combined_weight,reviewer_weight_share,reasons_json,computed_at,created_at,updated_at)
    VALUES('b17-existing-snapshot',?,'rating-config-v2','b17-input',81,NULL,81,8,0,8,8,8,1,'[]',?,?,?)`)
    .bind(placeId, now, now, now).run();
  for (const [index, status] of ["PENDING", "RUNNING", "COMPLETED", "FAILED"].entries()) {
    await database.prepare(`INSERT INTO rating_recompute_jobs(rowid,id,place_id,config_id,scope,status,reason,attempts,error_summary,started_at,finished_at,created_at,updated_at)
      VALUES(?,?,?,'rating-config-v2','PLACE',?,'PRESERVE',?,?,?, ?,?,?)`)
      .bind(503 + index * 7, `b17-rating-${status}`, placeId, status, index, index === 3 ? "PRESERVE_ERROR" : null, index ? now : null, index > 1 ? now : null, now, now).run();
  }
  await database.prepare(`INSERT INTO public_data_sync_runs(rowid,id,source_type,region_code,address_field,status,next_page,total_count,fetched_count,inserted_count,updated_count,skipped_count,started_at,created_at,updated_at)
    VALUES(607,'b17-public-legacy','REST_CAFE','GWANGJU_JEONNAM','LOTNO_ADDR','RUNNING',71,39416,7000,6500,400,100,?,?,?)`)
    .bind(now, now, now).run();
  for (const [index, status] of ["RUNNING", "COMPLETED", "FAILED"].entries()) {
    const snapshotId = `b17-parking-snapshot-${index}`;
    await database.prepare("INSERT INTO parking_data_snapshots(rowid,id,source,status,row_count,created_at,updated_at) VALUES(?,?,'PARKING',?,250,?,?)")
      .bind(701 + index, snapshotId, index === 0 ? "STAGING" : index === 1 ? "ACTIVE" : "FAILED", now, now).run();
    await database.prepare(`INSERT INTO parking_sync_runs(rowid,id,source,status,snapshot_id,next_page,total_count,fetched_count,accepted_count,skipped_count,started_at,finished_at,error_summary,created_at,updated_at)
      VALUES(?,?,'PARKING',?,?,4,500,300,250,50,?,?,?,?,?)`)
      .bind(809 + index, `b17-parking-${index}`, status, snapshotId, now, index ? now : null, index === 2 ? "PRESERVE_ERROR" : null, now, now).run();
  }
  await database.prepare(`INSERT INTO reviewer_photo_cleanup_jobs(rowid,review_id,purpose,object_keys_json,next_attempt_at,attempt_count,created_at,updated_at)
    VALUES(907,?,'DELETE',?, ?,2,?,?)`)
    .bind(reviewId, JSON.stringify([`reviewer-visits/${actorUserId}/${reviewId}/photo.jpg`]), now, now, now).run();
  await database.prepare("INSERT INTO naver_local_category_runs(id,mode,scope,status,requested_limit,api_call_count,region_code,started_at) VALUES('b17-legacy-usage','APPLY','PENDING','COMPLETED',1,7,NULL,'2026-01-10T01:00:00.000Z')").run();

  const before = await capture(database);
  for (const table of MIGRATED_TABLES) {
    expect([...before.tables[table].columns].sort()).toEqual([...B17_REQUIRED_COLUMNS[table]].sort());
  }
  const unchanged = () => Promise.all(UNCHANGED_TABLES.map(async (table) => (await database.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()).results));
  const beforeUnchanged = await unchanged();
  for (const [index, rows] of beforeUnchanged.entries()) {
    expect(rows.length, `${UNCHANGED_TABLES[index]} must contain a preservation fixture`).toBeGreaterThan(0);
  }
  const upgrades = env.TEST_MIGRATIONS.filter((migration) => UPGRADE_NAMES.includes(migration.name));
  expect(upgrades.map((migration) => migration.name)).toEqual(UPGRADE_NAMES);
  await applyD1Migrations(database, upgrades);
  const after = await capture(database);
  const result = compareB17Snapshots(before, after);
  expect(result.ok).toBe(true);
  expect(result.mismatchCount).toBe(0);
  expect(await unchanged()).toEqual(beforeUnchanged);
  expect((await database.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  expect(after.tables.public_data_sync_runs.rows[0]).toMatchObject({ status: "RUNNING", attempts: 0, request_count: 0, retry_count: 0, lease_id: null });
  expect(after.tables.parking_sync_runs.rows.every((row) => row.attempts === 1 && row.lease_version === 0 && row.lease_expires_at === null)).toBe(true);
  expect(after.tables.reviewer_photo_cleanup_jobs.rows[0]).toMatchObject({ status: "PENDING", revision: 1, attempt_count: 2, lease_id: null });
  expect(await database.prepare("SELECT stopped,version FROM admin_feature_stops").first()).toEqual({ stopped: 0, version: 0 });
  expect(await database.prepare("SELECT legacy_total,legacy_gwangju,legacy_jeonnam,cutover_state FROM provider_daily_quotas WHERE utc_day='2026-01-10'").first())
    .toEqual({ legacy_total: 7, legacy_gwangju: 7, legacy_jeonnam: 7, cutover_state: "CLOSED_LEGACY_UNCERTAIN" });
  expect(await database.prepare("SELECT count(*) FROM provider_daily_quotas WHERE is_cutover_anchor=1 AND cutover_verified_at IS NULL AND ready_after_utc_day IS NULL AND cutover_receipt_ref IS NULL").first("count(*)")).toBe(1);
  await expect(database.prepare("UPDATE admin_operations SET result_json='[]' WHERE id='b17-completed'").run()).rejects.toThrow("IMMUTABLE");
  await expect(database.prepare("DELETE FROM admin_operation_commits WHERE operation_id='b17-completed'").run()).rejects.toThrow("IMMUTABLE");

  // Final operation-kind constraints must accept every compiled policy, not only
  // the kind introduced by the last migration. These previews invoke no job.
  for (const kind of Object.keys(ADMIN_OPERATION_POLICY) as (keyof typeof ADMIN_OPERATION_POLICY)[]) {
    const preview = await prepareAdminOperation(database, { actorUserId, sessionId, now, kind, payload: {}, summary: { title: "합성 종류 확인", count: 1 } });
    expect(await database.prepare("SELECT kind FROM admin_operations WHERE id=?").bind(preview.operationId).first("kind")).toBe(kind);
    await database.prepare("DELETE FROM admin_operations WHERE id=? AND status='PENDING'").bind(preview.operationId).run();
  }
  await database.prepare("UPDATE reviewer_visit_reviews SET status='WITHDRAWN',updated_at=? WHERE id=?").bind(now, reviewId).run();
  expect(await database.prepare("SELECT is_stale FROM rating_snapshots WHERE id='b17-existing-snapshot'").first("is_stale")).toBe(1);
  expect(await database.prepare("SELECT count(*) FROM rating_recompute_jobs WHERE place_id=? AND reason='REVIEW_MODERATION'").bind(placeId).first("count(*)")).toBe(0);

  const tampered = structuredClone(after);
  tampered.tables.public_data_sync_runs.rows[0]!.fetched_count = 9999;
  expect(compareB17Snapshots(before, tampered).ok).toBe(false);
});
