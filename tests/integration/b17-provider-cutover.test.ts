import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildB17ProviderCutoverSql } from "../../scripts/b17-provider-cutover.mjs";
import { readProviderUsage, reserveNaverAttempt } from "../../app/features/operations/provider-usage.server";

const settings = { NAVER_LOCAL_SEARCH_DAILY_LIMIT: "20000" };
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM provider_call_attempts").run();
  await env.DB.prepare("DELETE FROM provider_daily_quotas").run();
  await env.DB.prepare("DELETE FROM naver_local_category_runs").run();
});
afterEach(async () => {
  const triggers = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'b17_provider_%'").all<{name:string}>()).results;
  for (const { name } of triggers) {
    if (!/^b17_provider_(guard|apply)_[a-f0-9]{24}$/.test(name)) throw new Error("unexpected fixture trigger");
    await env.DB.prepare(`DROP TRIGGER ${name}`).run();
  }
});
async function fixture(anchorOffset = 0) {
  const now = new Date().toISOString(), before = new Date(Date.now() - 60_000).toISOString();
  const day = new Date(Date.now() + anchorOffset * 86_400_000).toISOString().slice(0,10);
  const id = crypto.randomUUID(), operatorId = `operator-${id}`, sessionId = `session-${id}`;
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,'Fixture','ADMIN',?,?,?)")
    .bind(operatorId, `${id}@example.test`, before, before, before).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,'2099-01-01T00:00:00.000Z')").bind(sessionId, operatorId, before).run();
  await env.DB.prepare(`INSERT INTO provider_daily_quotas(provider,utc_day,legacy_total,legacy_gwangju,legacy_jeonnam,reserved_total,reserved_gwangju,reserved_jeonnam,baseline_at,baseline_source,cutover_state,is_cutover_anchor,last_reservation_id,created_at,updated_at)
    VALUES('NAVER_LOCAL_SEARCH',?,17,13,9,5,2,3,?,'LEGACY_RUN_ESTIMATE','CLOSED_LEGACY_UNCERTAIN',1,?,?,?)`)
    .bind(day, before, crypto.randomUUID(), before, before).run();
  const otherDay = new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  await env.DB.prepare(`INSERT INTO provider_daily_quotas(provider,utc_day,legacy_total,baseline_at,baseline_source,cutover_state,created_at,updated_at)
    VALUES('NAVER_LOCAL_SEARCH',?,8,?,'LEGACY_RUN_ESTIMATE','CLOSED_LEGACY_UNCERTAIN',?,?)`).bind(otherDay, before, before, before).run();
  const other = await env.DB.prepare("SELECT rowid,* FROM provider_daily_quotas WHERE is_cutover_anchor=0").first();
  const snapshot = await env.DB.prepare("SELECT rowid,* FROM provider_daily_quotas WHERE is_cutover_anchor=1").first();
  const input = { snapshot, operatorId, sessionId, now, drainEvidenceSha256: "a".repeat(64),
    previousWorkerVersion: "11111111-1111-4111-8111-111111111111", nextWorkerVersion: "22222222-2222-4222-8222-222222222222" };
  const plan = buildB17ProviderCutoverSql(input);
  const install = async () => { for (const sql of plan.installSql.trim().split(/\n(?=CREATE TRIGGER)/)) await env.DB.prepare(sql).run(); };
  await install();
  return { input, plan, snapshot, install, other };
}
it("updates only three evidence columns atomically and keeps the future whole-day gate", async () => {
  const f = await fixture(1);
  await env.DB.prepare(f.plan.applySql).run();
  expect(await env.DB.prepare("SELECT rowid,* FROM provider_daily_quotas WHERE is_cutover_anchor=1").first()).toEqual({
    ...f.snapshot, cutover_verified_at: f.input.now, ready_after_utc_day: f.plan.readyAfterUtcDay,
    cutover_receipt_ref: `sha256:${f.input.drainEvidenceSha256}`,
  });
  expect(await env.DB.prepare("SELECT rowid,* FROM provider_daily_quotas WHERE is_cutover_anchor=0").first()).toEqual(f.other);
  expect(f.plan.readyAfterUtcDay).toBe(new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0,10));
  const audit = await env.DB.prepare("SELECT before_state,after_state FROM admin_audit_logs WHERE id=?").bind(f.plan.marker).first<{before_state:string;after_state:string}>();
  expect(JSON.parse(audit!.before_state).anchor).toEqual(f.snapshot);
  expect(audit!.after_state).not.toContain(f.input.sessionId);
  expect(JSON.parse(audit!.after_state)).toMatchObject({ drainEvidenceSha256: f.input.drainEvidenceSha256, previousWorkerVersion: f.input.previousWorkerVersion, nextWorkerVersion: f.input.nextWorkerVersion });
  expect((await env.DB.prepare(f.plan.applySql).run()).meta.changes).toBe(0);
  expect(await env.DB.prepare("SELECT count(*) n FROM admin_audit_logs WHERE id=?").bind(f.plan.marker).first("n")).toBe(1);
  const beforeReady = new Date(Date.parse(`${f.plan.readyAfterUtcDay}T00:00:00.000Z`) - 1).toISOString();
  expect((await readProviderUsage(env.DB, { now: beforeReady, env: settings })).naver.cutoverState).toBe("HOLD");
  await expect(reserveNaverAttempt(env.DB, { regionCode: "GWANGJU", context: { source: "CATEGORY_V2" }, now: beforeReady, env: settings })).rejects.toThrow("NAVER_LOCAL_SEARCH_QUOTA");
  const readyAt = `${f.plan.readyAfterUtcDay}T00:00:00.000Z`;
  await reserveNaverAttempt(env.DB, { regionCode: "GWANGJU", context: { source: "CATEGORY_V2" }, now: readyAt, env: settings });
  expect((await readProviderUsage(env.DB, { now: readyAt, env: settings })).naver).toMatchObject({ cutoverState: "READY", limits: { global: 20000, GWANGJU: 10000, JEONNAM: 10000 } });
  for (const sql of f.plan.cleanupSql.trim().split("\n")) await env.DB.prepare(sql).run();
  expect((await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (?,?)").bind(...f.plan.triggerNames).all()).results).toEqual([]);
});
it.each(["legacy_total=18", "baseline_source='EMPTY_NEW_DAY'", "last_reservation_id=NULL", "updated_at='2000-01-01T00:00:00.000Z'"])("rejects changed full-snapshot field: %s", async (change) => {
  const f = await fixture();
  await env.DB.prepare(`UPDATE provider_daily_quotas SET ${change} WHERE is_cutover_anchor=1`).run();
  await expect(env.DB.prepare(f.plan.applySql).run()).rejects.toThrow("B17_CUTOVER_SNAPSHOT_CHANGED");
  expect(await env.DB.prepare("SELECT cutover_verified_at FROM provider_daily_quotas WHERE is_cutover_anchor=1").first("cutover_verified_at")).toBeNull();
  expect(await env.DB.prepare("SELECT count(*) n FROM admin_audit_logs WHERE id=?").bind(f.plan.marker).first("n")).toBe(0);
});
it.each(["expired", "demoted", "unverified", "withdrawn", "restricted"])("requires current verified ADMIN/session: %s", async (mode) => {
  const f = await fixture();
  if (mode === "expired") await env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(f.input.sessionId).run();
  if (mode === "demoted") await env.DB.prepare("UPDATE users SET role='USER' WHERE id=?").bind(f.input.operatorId).run();
  if (mode === "unverified") await env.DB.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").bind(f.input.operatorId).run();
  if (mode === "withdrawn") await env.DB.prepare("UPDATE users SET email=? WHERE id=?").bind(`withdrawn.${f.input.operatorId}@invalid.local`, f.input.operatorId).run();
  if (mode === "restricted") {
    await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,'Backup','ADMIN',?,?,?)")
      .bind(crypto.randomUUID(), `${crypto.randomUUID()}@example.test`, f.input.now, f.input.now, f.input.now).run();
    await env.DB.prepare("INSERT INTO member_access_restrictions(user_id,version,reason,starts_at,expires_at,updated_at) VALUES(?,1,'fixture',?,?,?)")
      .bind(f.input.operatorId, new Date(Date.now()-1000).toISOString(), new Date(Date.now()+3600000).toISOString(), f.input.now).run();
  }
  await expect(env.DB.prepare(f.plan.applySql).run()).rejects.toThrow("B17_CUTOVER_ADMIN_REQUIRED");
  expect(await env.DB.prepare("SELECT count(*) n FROM admin_audit_logs WHERE id=?").bind(f.plan.marker).first("n")).toBe(0);
});
it("strictly validates snapshot, identifiers, proof and timing inputs before generating SQL", async () => {
  const f = await fixture();
  for (const patch of [{ provider: "OTHER" }, { is_cutover_anchor: 0 }, { cutover_state: "READY" }, { cutover_receipt_ref: "existing" }, { reserved_total: -1 }, { rowid: undefined }, { extra: "injected" }])
    expect(() => buildB17ProviderCutoverSql({ ...f.input, snapshot: { ...f.snapshot, ...patch } })).toThrow("B17_CUTOVER_SNAPSHOT_INVALID");
  for (const patch of [{ operatorId: "x';DELETE" }, { sessionId: "" }, { drainEvidenceSha256: "no" }, { nextWorkerVersion: f.input.previousWorkerVersion }, { now: "invalid" }])
    expect(() => buildB17ProviderCutoverSql({ ...f.input, ...patch })).toThrow("B17_CUTOVER_INPUT_INVALID");
});
it("rejects a future or prior-day verification timestamp at SQL application", async () => {
  const f = await fixture();
  const future = buildB17ProviderCutoverSql({ ...f.input, now: new Date(Date.now() + 60_000).toISOString() });
  for (const sql of future.installSql.trim().split(/\n(?=CREATE TRIGGER)/)) await env.DB.prepare(sql).run();
  await expect(env.DB.prepare(future.applySql).run()).rejects.toThrow("B17_CUTOVER_TIME_STALE");
  const old = new Date(Date.now() - 86_400_000).toISOString();
  await env.DB.prepare("UPDATE provider_daily_quotas SET baseline_at=?,created_at=?,updated_at=? WHERE is_cutover_anchor=1").bind(old, old, old).run();
  const snapshot = await env.DB.prepare("SELECT rowid,* FROM provider_daily_quotas WHERE is_cutover_anchor=1").first();
  const stale = buildB17ProviderCutoverSql({ ...f.input, snapshot, now: old });
  for (const sql of stale.installSql.trim().split(/\n(?=CREATE TRIGGER)/)) await env.DB.prepare(sql).run();
  await expect(env.DB.prepare(stale.applySql).run()).rejects.toThrow("B17_CUTOVER_TIME_STALE");
});
it("rejects a mismatching existing audit marker without touching the anchor", async () => {
  const f = await fixture();
  for (const sql of f.plan.cleanupSql.trim().split("\n")) await env.DB.prepare(sql).run();
  await env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,created_at) VALUES(?,?,'OTHER','OTHER','other',?)")
    .bind(f.plan.marker, f.input.operatorId, f.input.now).run();
  await f.install();
  await expect(env.DB.prepare(f.plan.applySql).run()).rejects.toThrow("B17_CUTOVER_AUDIT_MISMATCH");
  expect(await env.DB.prepare("SELECT rowid,* FROM provider_daily_quotas WHERE is_cutover_anchor=1").first()).toEqual(f.snapshot);
});
it("keeps the anchor and audit untouched while any old NAVER run remains RUNNING", async () => {
  const f = await fixture();
  await env.DB.prepare("INSERT INTO naver_local_category_runs(id,mode,scope,status,requested_limit,started_at) VALUES('old-running','APPLY','PENDING','RUNNING',1,?)").bind(f.input.now).run();
  const run = await env.DB.prepare("SELECT rowid,* FROM naver_local_category_runs WHERE id='old-running'").first();
  await expect(env.DB.prepare(f.plan.applySql).run()).rejects.toThrow("B17_CUTOVER_RUN_ACTIVE");
  expect(await env.DB.prepare("SELECT rowid,* FROM provider_daily_quotas WHERE is_cutover_anchor=1").first()).toEqual(f.snapshot);
  expect(await env.DB.prepare("SELECT count(*) n FROM admin_audit_logs WHERE id=?").bind(f.plan.marker).first("n")).toBe(0);
  expect(await env.DB.prepare("SELECT rowid,* FROM naver_local_category_runs WHERE id='old-running'").first()).toEqual(run);
});
