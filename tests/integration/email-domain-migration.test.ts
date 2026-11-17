import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

it("preserves operation rowids, receipts, checks and guards when adding email controls", async () => {
  const db = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < "0059"));
  const at = new Date().toISOString(), expires = new Date(Date.now() + 600_000).toISOString();
  await db.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES('mail-migration','mail-migration@example.test','Test','ADMIN',?,?)").bind(at, at).run();
  await db.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES('mail-session','mail-migration',?,?)").bind(at, expires).run();
  await db.prepare(`INSERT INTO admin_operations(rowid,id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at)
    VALUES(127,'mail-operation','RATING_RECOMPUTE','mail-migration','mail-session','{}','test','{"title":"Preserve","count":1}',0,?,?)`).bind(at, expires).run();
  await db.prepare("INSERT INTO admin_operation_commits(rowid,operation_id,actor_user_id,session_id,kind,committed_at) VALUES(253,'mail-operation','mail-migration','mail-session','RATING_RECOMPUTE',?)").bind(at).run();
  await db.prepare("INSERT INTO admin_operation_checks(rowid,operation_id,check_name,passed) VALUES(379,'mail-operation','preserve',1)").run();
  await db.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json='{}',committed_at=? WHERE id='mail-operation'").bind(at).run();
  const names = ["admin_operations", "admin_operation_commits", "admin_operation_checks"];
  const snapshot = () => Promise.all(names.map(async (name) => (await db.prepare(`SELECT rowid,* FROM ${name} ORDER BY rowid`).all()).results));
  const before = await snapshot();
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name.startsWith("0059")));
  expect(await snapshot()).toEqual(before);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  await expect(db.prepare("UPDATE admin_operations SET result_json='[]' WHERE id='mail-operation'").run()).rejects.toThrow("IMMUTABLE");
  await expect(db.prepare("DELETE FROM admin_operation_commits WHERE operation_id='mail-operation'").run()).rejects.toThrow("IMMUTABLE");
  await db.prepare("DELETE FROM sessions WHERE id='mail-session'").run();
  expect(await db.prepare("SELECT session_id FROM admin_operations WHERE id='mail-operation'").first("session_id")).toBeNull();
});
