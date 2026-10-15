import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRsiCloudflareEnabled,
  isRsiCron,
  MAINTENANCE_CRON,
  resolveRsiOrigin,
  RSI_CRON,
  RSI_LIVE_ORIGIN,
  RSI_ON_DEMAND_PATH,
  RSI_PUBLIC_PATH_CHECKS,
  runRsiPublicPathCheck,
} from "../../app/features/operations/rsi-self-check";
import { handleRsiOnDemandRequest, rsiTokensMatch, runScheduledRsiSelfCheck } from "../../app/features/operations/rsi-self-check.server";

function jsonHeaders(status: number, location = "") {
  return {
    status,
    headers: location ? { location } : {},
  };
}

function mockPublicFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/admin") return new Response(null, jsonHeaders(302, "/login?returnTo=%2Fadmin"));
    if (["/", "/places", "/login", "/robots.txt", "/privacy"].includes(url.pathname)) {
      return new Response("ok", jsonHeaders(200));
    }
    return new Response("missing", jsonHeaders(404));
  });
}

function auditDb() {
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  return { DB: { prepare } as unknown as D1Database, prepare, bind, run };
}

describe("rsi self-check", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("probes the six public paths and treats a wrong admin redirect as failure", async () => {
    const fetchMock = mockPublicFetch();
    const passed = await runRsiPublicPathCheck({ fetch: fetchMock, origin: RSI_LIVE_ORIGIN });
    expect(passed.ok).toBe(true);
    expect(passed.failed).toBe(0);
    expect(passed.originHost).toBe("retaste-beta.retaste-beta.workers.dev");
    expect(passed.results.map((row) => row.path)).toEqual(RSI_PUBLIC_PATH_CHECKS.map((row) => row.path));

    const failingFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/") return new Response(null, jsonHeaders(500));
      return mockPublicFetch()(input);
    });
    const failed = await runRsiPublicPathCheck({ fetch: failingFetch, origin: RSI_LIVE_ORIGIN });
    expect(failed.ok).toBe(false);
    expect(failed.results[0]).toMatchObject({ path: "/", status: 500, ok: false });
  });

  it("treats only the six-hour cron as the RSI schedule", () => {
    expect(isRsiCron(RSI_CRON)).toBe(true);
    expect(isRsiCron(MAINTENANCE_CRON)).toBe(false);
    expect(RSI_CRON).toBe("47 */6 * * *");
  });

  it("keeps all six path results when one network request fails", async () => {
    const passingFetch = mockPublicFetch();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/places") throw new Error("private upstream detail");
      return passingFetch(input);
    });
    const result = await runRsiPublicPathCheck({ fetch: fetchMock, origin: RSI_LIVE_ORIGIN });
    expect(result.results).toHaveLength(6);
    expect(result).toMatchObject({ ok: false, failed: 1 });
    expect(result.results.find((r) => r.path === "/places")).toMatchObject({ status: 0, ok: false });
    expect(JSON.stringify(result)).not.toContain("private upstream detail");
  });

  it("durably records a scheduled result without request credentials or redirect contents", async () => {
    const audit = auditDb();
    vi.stubGlobal("fetch", mockPublicFetch());
    await runScheduledRsiSelfCheck({ ...audit, RSI_CLOUDFLARE_ENABLED: "true", APP_BASE_URL: RSI_LIVE_ORIGIN } as Env);
    expect(audit.run).toHaveBeenCalledOnce();
    const values = audit.bind.mock.calls[0] as unknown as unknown[];
    const payload = values.find((v) => typeof v === "string" && v.startsWith("{"));
    expect(JSON.parse(String(payload))).toMatchObject({ trigger: "scheduled", ok: true, failed: 0, paths: expect.any(Array) });
    expect(String(payload)).not.toMatch(/location|token|cookie|returnTo/i);
  });

  it("records failed paths then rejects so Cron does not report a failed check as success", async () => {
    const audit = auditDb();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    await expect(runScheduledRsiSelfCheck({ ...audit, RSI_CLOUDFLARE_ENABLED: "true", APP_BASE_URL: RSI_LIVE_ORIGIN } as Env)).rejects.toThrow("RSI_SELF_CHECK_FAILED");
    expect(audit.run).toHaveBeenCalledOnce();
    const payload = (audit.bind.mock.calls[0] as unknown as unknown[]).find((v) => typeof v === "string" && v.startsWith("{"));
    expect(JSON.parse(String(payload))).toMatchObject({ ok: false, failed: 6 });
  });

  it("rejects if the durable audit cannot be saved", async () => {
    const audit = auditDb(); audit.run.mockRejectedValue(new Error("private D1 error"));
    vi.stubGlobal("fetch", mockPublicFetch());
    await expect(runScheduledRsiSelfCheck({ ...audit, RSI_CLOUDFLARE_ENABLED: "true", APP_BASE_URL: RSI_LIVE_ORIGIN } as Env)).rejects.toThrow("RSI_SELF_CHECK_AUDIT_FAILED");
  });

  it("requires the kill switch and APP_BASE_URL for scheduled RSI", async () => {
    expect(isRsiCloudflareEnabled("true")).toBe(true);
    expect(isRsiCloudflareEnabled("false")).toBe(false);
    expect(resolveRsiOrigin({ appBaseUrl: " https://example.test/ " })).toBe("https://example.test");
    expect(resolveRsiOrigin({ requestOrigin: RSI_LIVE_ORIGIN })).toBe(RSI_LIVE_ORIGIN);

    const disabled = await runScheduledRsiSelfCheck({ RSI_CLOUDFLARE_ENABLED: "false" } as Env);
    expect(disabled).toEqual({ skipped: true, reason: "disabled" });

    const audit = auditDb();
    await expect(runScheduledRsiSelfCheck({ ...audit, RSI_CLOUDFLARE_ENABLED: "true" } as Env)).rejects.toThrow("RSI_SELF_CHECK_FAILED");
    expect(audit.run).toHaveBeenCalledOnce();

    const fetchMock = mockPublicFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ran = await runScheduledRsiSelfCheck({
      ...audit,
      RSI_CLOUDFLARE_ENABLED: "true",
      APP_BASE_URL: RSI_LIVE_ORIGIN,
    } as Env);
    expect(ran).toMatchObject({ ok: true, failed: 0, originHost: "retaste-beta.retaste-beta.workers.dev" });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("hides on-demand RSI without a matching token and never writes D1", async () => {
    expect(rsiTokensMatch("token", "token")).toBe(true);
    expect(rsiTokensMatch("nope", "token")).toBe(false);

    const env = {
      RSI_CLOUDFLARE_ENABLED: "true",
      RSI_CHECK_TOKEN: "expected-token",
      APP_BASE_URL: RSI_LIVE_ORIGIN,
    } as Env;
    const missing = await handleRsiOnDemandRequest(new Request(`https://example.test${RSI_ON_DEMAND_PATH}`), env);
    expect(missing?.status).toBe(404);

    const other = await handleRsiOnDemandRequest(new Request("https://example.test/places"), env);
    expect(other).toBeNull();

    const fetchMock = mockPublicFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ok = await handleRsiOnDemandRequest(
      new Request(`https://example.test${RSI_ON_DEMAND_PATH}`, { headers: { "x-rsi-check-token": "expected-token" } }),
      env,
    );
    expect(ok?.status).toBe(200);
    expect(await ok?.json()).toMatchObject({ ok: true, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
