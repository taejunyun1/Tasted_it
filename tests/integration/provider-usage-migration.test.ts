import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

it("freezes UTC legacy estimates once, conservatively attributes NULL regions, and installs an unverified anchor", async () => {
  const db = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < "0053"));
  for (const [id, startedAt, region, calls] of [
    ["legacy-gw", "2026-01-10T22:00:00.000Z", "GWANGJU", 5],
    ["legacy-null", "2026-01-11T02:30:00+03:00", null, 2],
    ["legacy-jn", "2026-01-11T12:00:00.000Z", "JEONNAM", 7],
  ] as const) {
    await db.prepare("INSERT INTO naver_local_category_runs(id,mode,scope,status,requested_limit,api_call_count,region_code,started_at) VALUES (?,'APPLY','PENDING','COMPLETED',1,?,?,?)")
      .bind(id, calls, region, startedAt).run();
  }
  const before = (await db.prepare("SELECT rowid,* FROM naver_local_category_runs ORDER BY rowid").all()).results;
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name.startsWith("0053")));
  expect((await db.prepare("SELECT rowid,* FROM naver_local_category_runs ORDER BY rowid").all()).results).toEqual(before);
  expect((await db.prepare("SELECT utc_day,legacy_total,legacy_gwangju,legacy_jeonnam,cutover_state FROM provider_daily_quotas WHERE utc_day IN ('2026-01-10','2026-01-11') ORDER BY utc_day").all()).results).toEqual([
    { utc_day: "2026-01-10", legacy_total: 7, legacy_gwangju: 7, legacy_jeonnam: 2, cutover_state: "CLOSED_LEGACY_UNCERTAIN" },
    { utc_day: "2026-01-11", legacy_total: 7, legacy_gwangju: 0, legacy_jeonnam: 7, cutover_state: "CLOSED_LEGACY_UNCERTAIN" },
  ]);
  expect(await db.prepare("SELECT count(*) AS n FROM provider_daily_quotas WHERE is_cutover_anchor=1 AND cutover_verified_at IS NULL AND ready_after_utc_day IS NULL AND cutover_receipt_ref IS NULL AND cutover_state='CLOSED_LEGACY_UNCERTAIN'").first()).toEqual({ n: 1 });
  for (const proof of [null, "", "   ", "x".repeat(513)]) {
    await expect(db.prepare("UPDATE provider_daily_quotas SET cutover_verified_at=?,ready_after_utc_day='2040-01-01',cutover_receipt_ref=? WHERE is_cutover_anchor=1")
      .bind(new Date().toISOString(), proof).run()).rejects.toThrow();
  }
  await db.prepare("UPDATE naver_local_category_runs SET api_call_count=100 WHERE id='legacy-gw'").run();
  expect(await db.prepare("SELECT legacy_total FROM provider_daily_quotas WHERE utc_day='2026-01-10'").first("legacy_total")).toBe(7);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
