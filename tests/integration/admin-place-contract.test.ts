import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "../../app/features/operations/admin-operation.server";
import { parseActivityQuery } from "../../app/features/operations/admin-activity";
import { readAdminActivity } from "../../app/features/operations/admin-activity.server";

it("preserves every operation/receipt/check row and original guards across 0049",async()=>{
  const db=(env as unknown as {MIGRATION_DB:D1Database}).MIGRATION_DB;
  const migrations=env.TEST_MIGRATIONS;
  const before=migrations.filter((m)=>m.name < "0049");
  const upgrade=migrations.filter((m)=>m.name.startsWith("0049"));
  expect(upgrade).toHaveLength(1);
  await applyD1Migrations(db,before);
  const at=new Date().toISOString(),expires=new Date(Date.now()+600_000).toISOString();
  await db.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES ('place-migration-admin','migration@example.test','Test','ADMIN',?,?,?)").bind(at,at,at).run();
  await db.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES ('place-migration-session','place-migration-admin',?,?)").bind(at,expires).run();
  for(const id of ['pending','committed']) await db.prepare(`INSERT INTO admin_operations(id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at)
    VALUES (?,'RATING_RECOMPUTE','place-migration-admin','place-migration-session','{}','test','{"title":"test","count":1}',0,?,?)`).bind(id,at,expires).run();
  await db.prepare("INSERT INTO admin_operation_commits VALUES ('committed','place-migration-admin','place-migration-session','RATING_RECOMPUTE',?)").bind(at).run();
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
  await db.prepare("DELETE FROM sessions WHERE id='place-migration-session'").run();
  expect((await db.prepare("SELECT session_id FROM admin_operations WHERE id='committed'").first<{session_id:null}>())?.session_id).toBeNull();
  await expect(db.prepare("UPDATE admin_operations SET session_id='rebinding' WHERE id='committed'").run()).rejects.toThrow("IMMUTABLE");
});

it("requires recent auth and a real receipt, and keeps place results out of the audit projection", async () => {
  const db = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  const now = new Date().toISOString(), expires = new Date(Date.now() + 600_000).toISOString();
  const actor = { actorUserId: "place-contract-admin", sessionId: "place-contract-session", now };
  await db.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES (?,?,'Test','ADMIN',?,?,?)")
    .bind(actor.actorUserId, "place-contract@example.test", now, now, now).run();
  await db.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES (?,?,?,?)")
    .bind(actor.sessionId, actor.actorUserId, now, expires).run();
  for (const kind of ["PLACE_ADMIN_CHANGE"] as const) {
    const prepared = await prepareAdminOperation(db, { ...actor, kind, payload: { target: "synthetic" }, summary: { title: "Test", count: 1 } });
    const input = { ...actor, kind, operationId: prepared.operationId };
    const plan = () => ({ checks: [db.prepare("INSERT INTO admin_operation_checks VALUES (?,'checked',1)").bind(input.operationId)], statements: [],
      result: { change: "TEST", requestedCount: 1, appliedCount: 1, skippedCount: 0, results: [{ targetRef: "private-fixture-marker", outcome: "APPLIED", code: "TEST" }] } });
    await expect(commitAdminOperation(db, input, plan)).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
    await db.prepare("INSERT OR REPLACE INTO admin_session_assurances VALUES (?,?,'PASSWORD',?,?)")
      .bind(actor.sessionId, actor.actorUserId, now, expires).run();
    await commitAdminOperation(db, input, plan);
    expect((await getVerifiedAdminOperation(db, input)).status).toBe("COMMITTED");
    expect((await commitAdminOperation(db, input, plan)).replayed).toBe(true);
    const query = parseActivityQuery(new URLSearchParams({ view: "operations", operation: input.operationId }), now);
    const result = await readAdminActivity(db, query, now);
    expect(result.detail?.fields.map((field) => field.value)).toEqual(["1", "1", "0"]);
    expect(JSON.stringify(result)).not.toContain("private-fixture-marker");
    await db.prepare("DELETE FROM admin_session_assurances WHERE session_id=?").bind(actor.sessionId).run();
  }
  const forged = await prepareAdminOperation(db, { ...actor, kind: "PLACE_ADMIN_CHANGE", payload: {}, summary: { title: "Test", count: 1 } });
  await db.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json='{}',committed_at=? WHERE id=?")
    .bind(now, forged.operationId).run();
  await expect(getVerifiedAdminOperation(db, { ...actor, kind: "PLACE_ADMIN_CHANGE", operationId: forged.operationId }))
    .rejects.toThrow("ADMIN_OPERATION_RECEIPT_UNAVAILABLE");
});
