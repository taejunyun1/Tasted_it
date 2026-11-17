import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";
import { buildB10LegacyPublicResumeSql } from "../../scripts/b10-legacy-public-resume.mjs";

async function fixture() {
  const db = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  expect(env.TEST_MIGRATIONS.some((migration) => migration.name.startsWith("0051"))).toBe(true);
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  const id = crypto.randomUUID(), operatorId = `operator-${id}`, sessionId = `session-${id}`;
  const now = new Date().toISOString(), old = new Date(Date.now() - 86_400_000).toISOString();
  await db.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES (?,?,'Fixture','ADMIN',?,?,?)")
    .bind(operatorId, `${id}@example.test`, now, now, now).run();
  await db.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z')")
    .bind(sessionId, operatorId, now).run();
  for (const runId of [id, `other-${id}`]) await db.prepare(`INSERT INTO public_data_sync_runs
    (id,source_type,region_code,address_field,status,next_page,total_count,fetched_count,inserted_count,updated_count,skipped_count,started_at,created_at,updated_at)
    VALUES (?,'REST_CAFE','GWANGJU_JEONNAM','LOTNO_ADDR','RUNNING',6,10000,500,400,80,20,?,?,?)`).bind(runId, old, old, old).run();
  const snapshot = await db.prepare("SELECT rowid,* FROM public_data_sync_runs WHERE id=?").bind(id).first();
  const other = await db.prepare("SELECT rowid,* FROM public_data_sync_runs WHERE id=?").bind(`other-${id}`).first();
  const input = { snapshot, operatorId, sessionId, now, drainEvidenceSha256: "a".repeat(64),
    previousWorkerVersion: "11111111-1111-4111-8111-111111111111", fenceVersion: "22222222-2222-4222-8222-222222222222" };
  const plan = buildB10LegacyPublicResumeSql(input);
  for (const statement of plan.installSql.trim().split(/\n(?=CREATE TRIGGER)/)) await db.prepare(statement).run();
  const cleanup = async () => { for (const statement of plan.cleanupSql.trim().split("\n")) await db.prepare(statement).run(); };
  return { db, id, input, plan, snapshot, other, cleanup };
}

it("resumes exactly the frozen queued run, preserves counters, records proof atomically and replays once", async () => {
  const f = await fixture();
  await f.db.prepare(f.plan.applySql).run();
  expect(await f.db.prepare("SELECT rowid,* FROM public_data_sync_runs WHERE id=?").bind(f.id).first()).toEqual({ ...f.snapshot, status: "PENDING", updated_at: f.input.now });
  expect(await f.db.prepare("SELECT rowid,* FROM public_data_sync_runs WHERE id=?").bind(`other-${f.id}`).first()).toEqual(f.other);
  const audit = await f.db.prepare("SELECT before_state,after_state FROM admin_audit_logs WHERE id=?").bind(f.plan.marker).first<{ before_state: string; after_state: string }>();
  expect(JSON.parse(audit!.before_state).run).toEqual(f.snapshot);
  expect(JSON.parse(audit!.after_state)).toMatchObject({ run: { ...f.snapshot, status: "PENDING", updated_at: f.input.now }, drainEvidenceSha256: f.input.drainEvidenceSha256,
    previousWorkerVersion: f.input.previousWorkerVersion, fenceVersion: f.input.fenceVersion });
  expect(audit!.after_state).not.toContain(f.input.sessionId);
  expect((await f.db.prepare(f.plan.applySql).run()).meta.changes).toBe(0);
  expect(await f.db.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE id=?").bind(f.plan.marker).first()).toEqual({ n: 1 });
  await f.cleanup();
  expect((await f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (?,?)").bind(...f.plan.triggerNames).all()).results).toEqual([]);
});

it("aborts a changed frozen counter and rolls back the audit insert", async () => {
  const f = await fixture();
  await f.db.prepare("UPDATE public_data_sync_runs SET fetched_count=fetched_count+1 WHERE id=?").bind(f.id).run();
  await expect(f.db.prepare(f.plan.applySql).run()).rejects.toThrow("B10_RESUME_SNAPSHOT_CHANGED");
  expect(await f.db.prepare("SELECT status FROM public_data_sync_runs WHERE id=?").bind(f.id).first("status")).toBe("RUNNING");
  expect(await f.db.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE id=?").bind(f.plan.marker).first()).toEqual({ n: 0 });
  await f.cleanup();
});

it.each(["expired-session", "withdrawn", "demoted", "unverified", "restricted"])("rejects non-current authorization: %s", async (mode) => {
  const f = await fixture();
  if (mode === "expired-session") await f.db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(f.input.sessionId).run();
  if (mode === "withdrawn") await f.db.prepare("UPDATE users SET email=? WHERE id=?").bind(`withdrawn.${f.id}@invalid.local`, f.input.operatorId).run();
  if (mode === "demoted") await f.db.prepare("UPDATE users SET role='USER' WHERE id=?").bind(f.input.operatorId).run();
  if (mode === "unverified") await f.db.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").bind(f.input.operatorId).run();
  if (mode === "restricted") {
    await f.db.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES (?,?,'Backup','ADMIN',?,?,?)")
      .bind(`backup-${f.id}`, `backup-${f.id}@example.test`, f.input.now, f.input.now, f.input.now).run();
    await f.db.prepare("INSERT INTO member_access_restrictions(user_id,version,reason,starts_at,expires_at,updated_at) VALUES (?,1,'Fixture',?,?,?)")
      .bind(f.input.operatorId, new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 86_400_000).toISOString(), f.input.now).run();
  }
  await expect(f.db.prepare(f.plan.applySql).run()).rejects.toThrow("B10_RESUME_ADMIN_REQUIRED");
  expect(await f.db.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE id=?").bind(f.plan.marker).first()).toEqual({ n: 0 });
  expect(await f.db.prepare("SELECT status FROM public_data_sync_runs WHERE id=?").bind(f.id).first("status")).toBe("RUNNING");
  await f.cleanup();
});

it("rejects mismatching content for an existing marker instead of accepting an unrelated audit row", async () => {
  const f = await fixture();
  await f.cleanup();
  await f.db.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,created_at) VALUES (?,?,'OTHER','OTHER','other',?)")
    .bind(f.plan.marker, f.input.operatorId, f.input.now).run();
  for (const statement of f.plan.installSql.trim().split(/\n(?=CREATE TRIGGER)/)) await f.db.prepare(statement).run();
  await expect(f.db.prepare(f.plan.applySql).run()).rejects.toThrow("B10_RESUME_AUDIT_MISMATCH");
  expect(await f.db.prepare("SELECT status FROM public_data_sync_runs WHERE id=?").bind(f.id).first("status")).toBe("RUNNING");
  await f.cleanup();
});

it("accepts only the fixed legacy scope and complete drain evidence", async () => {
  const f = await fixture();
  for (const snapshot of [{ ...f.snapshot, source_type: "GENERAL_RESTAURANT" }, { ...f.snapshot, attempts: 1 }, { ...f.snapshot, lease_id: "present" }, { ...f.snapshot, injected: "id; DROP TABLE users" }]) {
    expect(() => buildB10LegacyPublicResumeSql({ ...f.input, snapshot })).toThrow("B10_RESUME_SNAPSHOT_INVALID");
  }
  expect(() => buildB10LegacyPublicResumeSql({ ...f.input, drainEvidenceSha256: "missing" })).toThrow("B10_RESUME_INPUT_INVALID");
  expect(() => buildB10LegacyPublicResumeSql({ ...f.input, fenceVersion: f.input.previousWorkerVersion })).toThrow("B10_RESUME_INPUT_INVALID");
  await f.cleanup();
});
