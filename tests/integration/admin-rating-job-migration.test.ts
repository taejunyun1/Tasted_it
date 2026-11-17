import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { places } from "../../app/db/schema";
import { prepareAdminOperation } from "../../app/features/operations/admin-operation.server";
import { recomputePlaceRating } from "../../app/features/ratings/recompute.server";
import { seedApprovedReviewerVote } from "./reviewer-public-fixtures";

it("preserves populated 0049 job and receipt rows, constraints, and publication trigger across 0050", async () => {
  const database = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  const upgrade = env.TEST_MIGRATIONS.filter((migration) => migration.name.startsWith("0050"));
  expect(upgrade).toHaveLength(1);
  await applyD1Migrations(database, env.TEST_MIGRATIONS.filter((migration) => migration.name < "0050"));
  const at = new Date().toISOString(), expires = new Date(Date.now() + 600_000).toISOString();
  const actor = { actorUserId: "b10-migration-admin", sessionId: "b10-migration-session", now: at };
  await database.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES (?,'b10-migration@example.test','Migration test','ADMIN',?,?)")
    .bind(actor.actorUserId, at, at).run();
  await database.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES (?,?,?,?)")
    .bind(actor.sessionId, actor.actorUserId, at, expires).run();
  for (const [id, rowid] of [["b10-pending", 301], ["b10-committed", 409]] as const) {
    await database.prepare(`INSERT INTO admin_operations(rowid,id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at)
      VALUES (?,?,'RATING_RECOMPUTE',?,?,'{"target":"preserve"}','test-hash','{"title":"Preserve","count":1}',0,?,?)`)
      .bind(rowid, id, actor.actorUserId, actor.sessionId, at, expires).run();
  }
  await database.prepare("INSERT INTO admin_operation_commits(rowid,operation_id,actor_user_id,session_id,kind,committed_at) VALUES (503,'b10-committed',?,?,'RATING_RECOMPUTE',?)")
    .bind(actor.actorUserId, actor.sessionId, at).run();
  await database.prepare("INSERT INTO admin_operation_checks(rowid,operation_id,check_name,passed) VALUES (607,'b10-committed','preserved',1)").run();
  await database.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json=?,committed_at=? WHERE id='b10-committed'")
    .bind(JSON.stringify({ jobId: "preserve" }), at).run();
  await database.prepare("UPDATE admin_operations SET session_id=NULL WHERE id='b10-pending'").run();
  const db = createDb(database);
  await db.insert(places).values(["b10-migration-place", "b10-trigger-place"].map((id) => ({
    id, slug: id, name: id, status: "PUBLISHED" as const, address: "합성 주소", neighborhood: "합성", latitude: 35.1, longitude: 126.9, searchText: id, createdAt: at, updatedAt: at,
  })));
  for (const [index, status] of ["PENDING", "RUNNING", "COMPLETED", "FAILED"].entries()) {
    await database.prepare(`INSERT INTO rating_recompute_jobs(rowid,id,place_id,config_id,scope,status,reason,attempts,error_summary,started_at,finished_at,created_at,updated_at)
      VALUES (?,?,'b10-migration-place','rating-config-v2','PLACE',?,'PRESERVE_REASON',?,?,?, ?,?,?)`)
      .bind(701 + index * 13, `b10-job-${status}`, status, index, index === 3 ? "PRESERVE_ERROR" : null, index > 0 ? at : null, index > 1 ? at : null, at, at).run();
  }
  await seedApprovedReviewerVote(db, { reviewerId: actor.actorUserId, placeId: "b10-trigger-place", eventId: "b10-trigger-event", value: 1, now: at, projectVote: false });
  const tables = ["admin_operations", "admin_operation_commits", "admin_operation_checks", "rating_recompute_jobs"];
  const snapshot = async () => Promise.all(tables.map(async (table) => (await database.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()).results));
  const previous = await snapshot();
  const triggerBefore = await database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='reviewer_publication_recompute'").first("sql");
  await applyD1Migrations(database, upgrade);
  const current = await snapshot();
  const jobs = current[3]!;
  expect(jobs.every((job) => job.lease_expires_at === null)).toBe(true);
  current[3] = jobs.map(({ lease_expires_at: _lease, ...job }) => job);
  expect(current).toEqual(previous);
  expect((await database.prepare("PRAGMA foreign_key_check").all()).results).toHaveLength(0);
  expect(await database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='reviewer_publication_recompute'").first("sql")).toEqual(triggerBefore);

  await expect(database.prepare("UPDATE admin_operations SET result_json='{}' WHERE id='b10-committed'").run()).rejects.toThrow("IMMUTABLE");
  await expect(database.prepare("DELETE FROM admin_operation_commits WHERE operation_id='b10-committed'").run()).rejects.toThrow("IMMUTABLE");
  await expect(database.prepare("INSERT INTO admin_operation_checks VALUES ('b10-committed','invalid',0)").run()).rejects.toThrow();
  await expect(database.prepare("UPDATE rating_recompute_jobs SET status='INVALID' WHERE id='b10-job-FAILED'").run()).rejects.toThrow();
  await expect(database.prepare("UPDATE rating_recompute_jobs SET config_id='missing' WHERE id='b10-job-FAILED'").run()).rejects.toThrow();
  await database.prepare("UPDATE rating_recompute_jobs SET status='CANCELLED' WHERE id='b10-job-PENDING'").run();
  expect(await database.prepare("SELECT status FROM rating_recompute_jobs WHERE id='b10-job-PENDING'").first("status")).toBe("CANCELLED");
  const preview = await prepareAdminOperation(database, { ...actor, kind: "RATING_JOB_CONTROL", payload: {}, summary: { title: "새 작업 종류", count: 1 } });
  expect(await database.prepare("SELECT requires_recent_auth FROM admin_operations WHERE id=?").bind(preview.operationId).first("requires_recent_auth")).toBe(1);

  await recomputePlaceRating(db, { placeId: "b10-trigger-place", now: at });
  await database.prepare("UPDATE reviewer_visit_reviews SET status='WITHDRAWN',updated_at=? WHERE id='review-b10-trigger-event'").bind(at).run();
  expect(await database.prepare("SELECT count(*) FROM rating_recompute_jobs WHERE place_id='b10-trigger-place' AND status='PENDING' AND reason='REVIEW_MODERATION' AND lease_expires_at IS NULL").first("count(*)")).toBe(1);
  expect(await database.prepare("SELECT is_stale FROM rating_snapshots WHERE place_id='b10-trigger-place'").first("is_stale")).toBe(1);
  await database.prepare("DELETE FROM sessions WHERE id=?").bind(actor.sessionId).run();
  expect(await database.prepare("SELECT session_id FROM admin_operations WHERE id='b10-committed'").first("session_id")).toBeNull();
  await expect(database.prepare("UPDATE admin_operations SET session_id='rebinding' WHERE id='b10-committed'").run()).rejects.toThrow("IMMUTABLE");
  expect((await database.prepare("PRAGMA foreign_key_check").all()).results).toHaveLength(0);
});
