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

  it("requires the kill switch and APP_BASE_URL for scheduled RSI", async () => {
    expect(isRsiCloudflareEnabled("true")).toBe(true);
    expect(isRsiCloudflareEnabled("false")).toBe(false);
    expect(resolveRsiOrigin({ appBaseUrl: " https://example.test/ " })).toBe("https://example.test");
    expect(resolveRsiOrigin({ requestOrigin: RSI_LIVE_ORIGIN })).toBe(RSI_LIVE_ORIGIN);

    const disabled = await runScheduledRsiSelfCheck({ RSI_CLOUDFLARE_ENABLED: "false" } as Env);
    expect(disabled).toEqual({ skipped: true, reason: "disabled" });

    const missing = await runScheduledRsiSelfCheck({ RSI_CLOUDFLARE_ENABLED: "true" } as Env);
    expect(missing).toEqual({ skipped: true, reason: "missing_origin" });

    const fetchMock = mockPublicFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ran = await runScheduledRsiSelfCheck({
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
