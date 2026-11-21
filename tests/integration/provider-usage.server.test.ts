import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNaverLocalSearchAdapter } from "../../app/features/candidates/naver-local-search.server";
import { reserveNaverAttempt, settleNaverAttempt, readProviderUsage } from "../../app/features/operations/provider-usage.server";
import { verifyNaverCategoryV2WithAdapter } from "../../app/features/candidates/naver-category-v2.server";
const now = "2040-01-01T12:00:00.000Z";
const config = { NAVER_LOCAL_SEARCH_ENABLED: "true", NAVER_API_HUB_KEY_ID: "synthetic-key-id", NAVER_API_HUB_KEY: "synthetic-secret", NAVER_LOCAL_SEARCH_DAILY_LIMIT: "20000" };
const input = { businessName: "합성", address: "광주광역시 동구 합성길 1", regionCode: "GWANGJU" as const };
const context = { source: "CATEGORY_V2" as const };
const response = () => new Response(JSON.stringify({ total: 0, items: [] }));
async function ready() {
  await env.DB.prepare("UPDATE provider_daily_quotas SET cutover_verified_at=?,ready_after_utc_day='2040-01-01',cutover_receipt_ref='synthetic-reviewed-cutover' WHERE is_cutover_anchor=1").bind(new Date().toISOString()).run();
}
const attempts = () => env.DB.prepare("SELECT * FROM provider_call_attempts ORDER BY reserved_at,id").all();

describe("atomic NAVER attempt accounting", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM provider_call_attempts").run();
    await env.DB.prepare("DELETE FROM provider_daily_quotas WHERE is_cutover_anchor=0").run();
    await env.DB.prepare("UPDATE provider_daily_quotas SET cutover_verified_at=NULL,ready_after_utc_day=NULL,cutover_receipt_ref=NULL,cutover_state='CLOSED_LEGACY_UNCERTAIN',reserved_total=0,reserved_gwangju=0,reserved_jeonnam=0,last_reservation_id=NULL WHERE is_cutover_anchor=1").run();
  });
  it("keeps an unverified cutover closed across new UTC dates and restarts", async () => {
    const fetcher = vi.fn(async () => response());
    for (const day of [now, "2040-01-02T00:00:00.000Z"]) {
      await expect(createNaverLocalSearchAdapter(config, { database: env.DB, fetchImpl: fetcher, clock: () => new Date(day) }).search(input, context)).rejects.toThrow("NAVER_LOCAL_SEARCH_QUOTA");
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect((await attempts()).results).toHaveLength(0);
  });
  it("fails closed for a missing cutover receipt even if a partial anchor bypassed SQL constraints", async () => {
    await ready();
    await reserveNaverAttempt(env.DB, { regionCode: "GWANGJU", context, now, env: config });
    await env.DB.exec("PRAGMA ignore_check_constraints=ON");
    try { await env.DB.prepare("UPDATE provider_daily_quotas SET cutover_receipt_ref=NULL WHERE is_cutover_anchor=1").run(); }
    finally { await env.DB.exec("PRAGMA ignore_check_constraints=OFF"); }
    const fetcher = vi.fn(async () => response());
    for (const day of [now, "2040-01-02T00:00:00.000Z"]) {
      await expect(createNaverLocalSearchAdapter(config, { database: env.DB, fetchImpl: fetcher, clock: () => new Date(day) }).search(input, context)).rejects.toThrow("NAVER_LOCAL_SEARCH_QUOTA");
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect((await readProviderUsage(env.DB, { now, env: config })).naver).toMatchObject({ cutoverState: "HOLD", cutoverVerified: false, reserved: { global: 1 } });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM provider_daily_quotas WHERE utc_day='2040-01-02'").first()).toEqual({ n: 0 });
  });
  it("admits only one of five independent HTTP callers to the last global slot", async () => {
    await ready(); const fetcher = vi.fn(async () => response());
    const adapter = createNaverLocalSearchAdapter({ ...config, NAVER_LOCAL_SEARCH_DAILY_LIMIT: "1" }, { database: env.DB, fetchImpl: fetcher, clock: () => new Date(now) });
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => adapter.search({ ...input, regionCode: i % 2 ? "JEONNAM" : "GWANGJU" }, context)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const state = await readProviderUsage(env.DB, { now, env: config });
    expect(state.naver.reserved.global).toBe(1);
    expect(state.naver.attempts).toMatchObject({ dispatched: 1, succeeded: 1, pending: 0 });
  });
  it("atomically enforces a regional final slot independently of the global cap", async () => {
    await ready();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => reserveNaverAttempt(env.DB, { regionCode: "GWANGJU", context, now, env: config, regionalLimit: 1 })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(reserveNaverAttempt(env.DB, { regionCode: "JEONNAM", context, now, env: config, regionalLimit: 1 })).resolves.toHaveProperty("id");
    expect((await readProviderUsage(env.DB, { now, env: config })).naver.reserved).toEqual({ global: 2, GWANGJU: 1, JEONNAM: 1 });
  });
  it("rolls back the counter when receipt insertion fails and performs no HTTP", async () => {
    await ready();
    await env.DB.exec("CREATE TRIGGER reject_provider_attempt BEFORE INSERT ON provider_call_attempts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    const fetcher = vi.fn(async () => response());
    try { await expect(createNaverLocalSearchAdapter(config, { database: env.DB, fetchImpl: fetcher, clock: () => new Date(now) }).search(input, context)).rejects.toThrow("NAVER_ACCOUNTING_UNAVAILABLE"); }
    finally { await env.DB.exec("DROP TRIGGER reject_provider_attempt"); }
    expect(fetcher).not.toHaveBeenCalled();
    expect((await readProviderUsage(env.DB, { now, env: config })).naver.reserved.global).toBe(0);
  });
  it("does not fetch after an unknown reservation response and preserves conservative consumption", async () => {
    await ready(); const batch = env.DB.batch.bind(env.DB);
    const wrapped = Object.create(env.DB) as D1Database;
    wrapped.batch = async (queries) => { await batch(queries); throw new Error("response lost"); };
    const fetcher = vi.fn(async () => response());
    await expect(createNaverLocalSearchAdapter(config, { database: wrapped, fetchImpl: fetcher, clock: () => new Date(now) }).search(input, context)).rejects.toThrow("NAVER_ACCOUNTING_UNAVAILABLE");
    expect(fetcher).not.toHaveBeenCalled();
    expect((await readProviderUsage(env.DB, { now, env: config })).naver).toMatchObject({ reserved: { global: 1 }, attempts: { pending: 1, dispatched: 0 } });
  });
  it("preserves consumption on UNKNOWN and makes settlement idempotent", async () => {
    await ready(); const fetcher = vi.fn(async () => { throw new Error("transport lost"); });
    await expect(createNaverLocalSearchAdapter(config, { database: env.DB, fetchImpl: fetcher, clock: () => new Date(now) }).search(input, context)).rejects.toThrow("NAVER_LOCAL_SEARCH_UNAVAILABLE");
    const id = String((await attempts()).results[0]!.id);
    await settleNaverAttempt(env.DB, { id, now, outcome: "SUCCEEDED" });
    expect((await attempts()).results[0]).toMatchObject({ outcome: "UNKNOWN" });
    expect((await readProviderUsage(env.DB, { now, env: config })).naver.reserved.global).toBe(1);
  });
  it("reserves a separate unit for a retry and blocks retry HTTP when only one unit remains", async () => {
    await ready(); const fetcher = vi.fn(async () => new Response("failed", { status: 503 }));
    const adapter = createNaverLocalSearchAdapter({ ...config, NAVER_LOCAL_SEARCH_DAILY_LIMIT: "1" }, { database: env.DB, fetchImpl: fetcher, clock: () => new Date(now) });
    await verifyNaverCategoryV2WithAdapter({ ...input, latitude: 35.1, longitude: 126.9, terminalSlugs: new Set(), adapter });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await attempts()).results).toHaveLength(1);
  });
  it("consumes two receipts when one retry receives a subsequent provider response", async () => {
    await ready(); let count = 0;
    const fetcher = vi.fn(async () => ++count === 1 ? new Response("failed", { status: 503 }) : response());
    const adapter = createNaverLocalSearchAdapter(config, { database: env.DB, fetchImpl: fetcher, clock: () => new Date(now) });
    await verifyNaverCategoryV2WithAdapter({ ...input, latitude: 35.1, longitude: 126.9, terminalSlugs: new Set(), adapter });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await attempts()).results.map((row) => row.outcome).sort()).toEqual(["FAILED", "SUCCEEDED"]);
    expect((await readProviderUsage(env.DB, { now, env: config })).naver.reserved.global).toBe(2);
  });
  it("charges the actual attempt UTC day and conservatively keeps a crossed-midnight reservation", async () => {
    await ready();
    const ticks = ["2040-01-01T23:59:59.900Z", "2040-01-02T00:00:00.001Z", "2040-01-02T00:00:00.002Z"];
    const fetcher = vi.fn(async () => response());
    await createNaverLocalSearchAdapter(config, { database: env.DB, fetchImpl: fetcher, clock: () => new Date(ticks.length > 1 ? ticks.shift()! : ticks[0]!) }).search(input, context);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await attempts()).results.map((r) => [r.utc_day, r.outcome, r.dispatch_started_at === null])).toEqual([
      ["2040-01-01", "PENDING", true], ["2040-01-02", "SUCCEEDED", false],
    ]);
  });
  it("rejects disabled, invalid and unconfigured calls before reserving", async () => {
    await ready(); const fetcher = vi.fn(async () => response());
    for (const settings of [{ ...config, NAVER_LOCAL_SEARCH_ENABLED: "false" }, { ...config, NAVER_API_HUB_KEY: "" }, { ...config, NAVER_LOCAL_SEARCH_DAILY_LIMIT: "invalid" }]) {
      await expect(createNaverLocalSearchAdapter(settings, { database: env.DB, fetchImpl: fetcher, clock: () => new Date(now) }).search(input, context)).rejects.toThrow();
    }
    await expect(createNaverLocalSearchAdapter(config, { database: env.DB, fetchImpl: fetcher, clock: () => new Date(now) }).search({ ...input, address: "" }, context)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled(); expect((await attempts()).results).toHaveLength(0);
  });
});
