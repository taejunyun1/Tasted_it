import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

it("preserves receipts, checks and rowids while extending the kind contract", async () => {
  const db = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < "0056"));
  const now = new Date().toISOString(), expires = new Date(Date.now() + 600_000).toISOString();
  await db.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES('b14-admin','b14@example.test','Fixture','ADMIN',?,?)").bind(now, now).run();
  await db.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES('b14-session','b14-admin',?,?)").bind(now, expires).run();
  await db.prepare(`INSERT INTO admin_operations(rowid,id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at)
    VALUES(71,'b14-prior','RATING_RECOMPUTE','b14-admin','b14-session','{}','prior','{"title":"Fixture","count":1}',0,?,?)`).bind(now, expires).run();
  await db.prepare("INSERT INTO admin_operation_commits(rowid,operation_id,actor_user_id,session_id,kind,committed_at) VALUES(72,'b14-prior','b14-admin','b14-session','RATING_RECOMPUTE',?)").bind(now).run();
  await db.prepare("INSERT INTO admin_operation_checks(rowid,operation_id,check_name,passed) VALUES(73,'b14-prior','original',1)").run();
  await db.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json='{}',committed_at=? WHERE id='b14-prior'").bind(now).run();
  const tables = ["admin_operations", "admin_operation_commits", "admin_operation_checks"];
  const snapshots = () => Promise.all(tables.map(async (table) => (await db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()).results));
  const before = await snapshots();
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name.startsWith("0056")));
  expect(await snapshots()).toEqual(before);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  await expect(db.prepare("DELETE FROM admin_operation_commits WHERE operation_id='b14-prior'").run()).rejects.toThrow("IMMUTABLE");
  await db.prepare(`INSERT INTO admin_operations(id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at)
    VALUES('b14-new','OPERATIONAL_ALERT_RESOLVE','b14-admin','b14-session','{}','new','{"title":"Fixture","count":1}',1,?,?)`).bind(now, expires).run();
  await db.prepare("DELETE FROM sessions WHERE id='b14-session'").run();
  expect(await db.prepare("SELECT session_id FROM admin_operations WHERE id='b14-prior'").first("session_id")).toBeNull();
});
