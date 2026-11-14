import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

it("preserves every operation/receipt/check row and original guards across 0047",async()=>{
  const db=(env as unknown as {MIGRATION_DB:D1Database}).MIGRATION_DB;
  const migrations=env.TEST_MIGRATIONS;
  const before=migrations.filter((m)=>!m.name.startsWith("0047"));
  const upgrade=migrations.filter((m)=>m.name.startsWith("0047"));
  expect(upgrade).toHaveLength(1);
  await applyD1Migrations(db,before);
  const at=new Date().toISOString(),expires=new Date(Date.now()+600_000).toISOString();
  await db.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES ('migration-admin','migration@example.test','Test','ADMIN',?,?,?)").bind(at,at,at).run();
  await db.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES ('migration-session','migration-admin',?,?)").bind(at,expires).run();
  for(const id of ['pending','committed']) await db.prepare(`INSERT INTO admin_operations(id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at)
    VALUES (?,'RATING_RECOMPUTE','migration-admin','migration-session','{}','test','{"title":"test","count":1}',0,?,?)`).bind(id,at,expires).run();
  await db.prepare("INSERT INTO admin_operation_commits VALUES ('committed','migration-admin','migration-session','RATING_RECOMPUTE',?)").bind(at).run();
  await db.prepare("INSERT INTO admin_operation_checks VALUES ('committed','test',1)").run();
  await db.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json='{}',committed_at=? WHERE id='committed'").bind(at).run();
  await db.prepare("UPDATE admin_operations SET session_id=NULL WHERE id='pending'").run();
  const tables=['admin_operations','admin_operation_commits','admin_operation_checks'];
  const snapshot=async()=>Promise.all(tables.map(async(table)=>(await db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()).results));
  const previous=await snapshot();
  await applyD1Migrations(db,upgrade);
  expect(await snapshot()).toEqual(previous);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toHaveLength(0);
  await expect(db.prepare("UPDATE admin_operations SET result_json='{}' WHERE id='committed'").run()).rejects.toThrow("IMMUTABLE");
  await expect(db.prepare("DELETE FROM admin_operation_commits WHERE operation_id='committed'").run()).rejects.toThrow("IMMUTABLE");
  await expect(db.prepare("INSERT INTO admin_operation_checks VALUES ('committed','bad',0)").run()).rejects.toThrow();
  await db.prepare("DELETE FROM sessions WHERE id='migration-session'").run();
  expect((await db.prepare("SELECT session_id FROM admin_operations WHERE id='committed'").first<{session_id:null}>())?.session_id).toBeNull();
  await expect(db.prepare("UPDATE admin_operations SET session_id='rebinding' WHERE id='committed'").run()).rejects.toThrow("IMMUTABLE");
});
