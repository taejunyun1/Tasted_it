import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

it("preserves populated parking history, data, receipts and constraints across 0052", async () => {
  const db = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < "0052"));
  const upgrade = env.TEST_MIGRATIONS.filter((m) => m.name.startsWith("0052"));
  expect(upgrade).toHaveLength(1);
  const now = new Date().toISOString(), expires = new Date(Date.now() + 600_000).toISOString();
  await db.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES ('migration-parking-admin','migration-parking@example.test','Test','ADMIN',?,?)").bind(now, now).run();
  await db.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES ('migration-parking-session','migration-parking-admin',?,?)").bind(now, expires).run();
  await db.prepare(`INSERT INTO admin_operations(rowid,id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at)
    VALUES (51,'migration-parking-operation','RATING_RECOMPUTE','migration-parking-admin','migration-parking-session','{}','preserve','{"title":"Test","count":1}',0,?,?)`).bind(now, expires).run();
  await db.prepare("INSERT INTO admin_operation_commits(rowid,operation_id,actor_user_id,session_id,kind,committed_at) VALUES (72,'migration-parking-operation','migration-parking-admin','migration-parking-session','RATING_RECOMPUTE',?)").bind(now).run();
  await db.prepare("INSERT INTO admin_operation_checks(rowid,operation_id,check_name,passed) VALUES (95,'migration-parking-operation','preserve',1)").run();
  await db.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json='{}',committed_at=? WHERE id='migration-parking-operation'").bind(now).run();
  for (const [index, status] of ["RUNNING", "COMPLETED", "FAILED"].entries()) {
    await db.prepare("INSERT INTO parking_data_snapshots(rowid,id,source,status,row_count,created_at,updated_at) VALUES (?,?,'PARKING',?,0,?,?)")
      .bind(110 + index * 10, `migration-parking-snapshot-${index}`, index === 0 ? "STAGING" : index === 1 ? "ACTIVE" : "FAILED", now, now).run();
    await db.prepare(`INSERT INTO parking_sync_runs(rowid,id,source,status,snapshot_id,next_page,total_count,fetched_count,accepted_count,skipped_count,started_at,finished_at,error_summary,created_at,updated_at)
      VALUES (?,?,'PARKING',?,?,4,500,300,250,50,?,?,?,?,?)`)
      .bind(210 + index * 10, `migration-parking-run-${index}`, status, `migration-parking-snapshot-${index}`, now, index ? now : null, index === 2 ? "PRESERVE_ERROR" : null, now, now).run();
  }
  const tables = ["admin_operations", "admin_operation_commits", "admin_operation_checks", "parking_sync_runs", "parking_data_snapshots"];
  const snapshot = async () => Promise.all(tables.map(async (table) => (await db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()).results));
  const previous = await snapshot();
  await applyD1Migrations(db, upgrade);
  const current = await snapshot();
  expect(current[3]!.every((row) => row.attempts === 1 && row.lease_version === 0 && row.lease_expires_at === null)).toBe(true);
  current[3] = current[3]!.map(({ attempts: _attempt, lease_version: _version, lease_expires_at: _expires, ...row }) => row);
  expect(current).toEqual(previous);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toHaveLength(0);
  await expect(db.prepare("UPDATE admin_operations SET result_json='[]' WHERE id='migration-parking-operation'").run()).rejects.toThrow("IMMUTABLE");
  await expect(db.prepare("DELETE FROM admin_operation_commits WHERE operation_id='migration-parking-operation'").run()).rejects.toThrow("IMMUTABLE");
  await expect(db.prepare("UPDATE parking_sync_runs SET attempts=4 WHERE id='migration-parking-run-0'").run()).rejects.toThrow();
  await expect(db.prepare("UPDATE parking_sync_runs SET source='OTHER' WHERE id='migration-parking-run-0'").run()).rejects.toThrow();
  await expect(db.prepare("UPDATE parking_sync_runs SET snapshot_id='missing' WHERE id='migration-parking-run-0'").run()).rejects.toThrow();
  await db.prepare("UPDATE parking_sync_runs SET status='CANCELLED' WHERE id='migration-parking-run-2'").run();
  await db.prepare("UPDATE parking_sync_runs SET status='PENDING' WHERE id='migration-parking-run-2'").run();
  await db.prepare("DELETE FROM parking_data_snapshots WHERE id='migration-parking-snapshot-2'").run();
  expect(await db.prepare("SELECT snapshot_id FROM parking_sync_runs WHERE id='migration-parking-run-2'").first("snapshot_id")).toBeNull();
  await db.prepare("DELETE FROM sessions WHERE id='migration-parking-session'").run();
  expect(await db.prepare("SELECT session_id FROM admin_operations WHERE id='migration-parking-operation'").first("session_id")).toBeNull();
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toHaveLength(0);
});
