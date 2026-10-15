import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRsiOnDemandRequest, runScheduledRsiSelfCheck } from "../../app/features/operations/rsi-self-check.server";

const origin = "https://rsi.example.test";
const scheduledEnv = () => ({ ...env, RSI_CLOUDFLARE_ENABLED: "true", APP_BASE_URL: origin });
afterEach(() => { vi.unstubAllGlobals(); });

async function audits() {
  return (await env.DB.prepare("SELECT actor_user_id, after_state FROM admin_audit_logs WHERE action = 'RSI_SELF_CHECK' AND target_type = 'OPERATIONS' AND target_id = 'rsi-scheduled' ORDER BY created_at, id").all<{ actor_user_id: string | null; after_state: string }>()).results;
}

describe("scheduled RSI durable evidence", () => {
  it("stores a sanitized six-path result in real isolated D1", async () => {
    const before = (await audits()).length;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/admin"
      ? new Response(null, { status: 302, headers: { Location: "/login?returnTo=%2Fadmin&private=not-recorded" } })
      : new Response("ok")));
    expect(await runScheduledRsiSelfCheck(scheduledEnv())).toMatchObject({ ok: true, failed: 0 });
    const rows = await audits(); expect(rows).toHaveLength(before + 1);
    const row = rows.at(-1)!;
    expect(row.actor_user_id).toBeNull();
    expect(JSON.parse(row.after_state)).toMatchObject({ trigger: "scheduled", ok: true, failed: 0, originHost: "rsi.example.test", paths: expect.any(Array) });
    expect(JSON.parse(row.after_state).paths).toHaveLength(6);
    expect(row.after_state).not.toMatch(/location|private|returnTo|token|cookie/i);
  });

  it("preserves partial network failures before rejecting the scheduled invocation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/places") throw new Error("private-network-detail");
      return path === "/admin" ? new Response(null, { status: 302, headers: { Location: "/login" } }) : new Response("ok");
    }));
    await expect(runScheduledRsiSelfCheck(scheduledEnv())).rejects.toThrow("RSI_SELF_CHECK_FAILED");
    const payload = (await audits()).map((r) => JSON.parse(r.after_state)).reverse().find((r) => r.failed === 1);
    expect(payload).toMatchObject({ ok: false, failed: 1 });
    expect(payload.paths).toHaveLength(6);
    expect(payload.paths.find((p: { path: string }) => p.path === "/places")).toEqual({ path: "/places", status: 0, ok: false });
    expect(JSON.stringify(payload)).not.toContain("private-network-detail");
  });

  it("records a missing scheduled origin but leaves disabled and unauthenticated requests without writes", async () => {
    const before = (await audits()).length;
    await expect(runScheduledRsiSelfCheck({ ...scheduledEnv(), APP_BASE_URL: "" })).rejects.toThrow("RSI_SELF_CHECK_FAILED");
    expect((await audits()).map((r) => JSON.parse(r.after_state))).toContainEqual({ trigger: "scheduled", skipped: true, reason: "missing_origin" });
    expect(await runScheduledRsiSelfCheck({ ...scheduledEnv(), RSI_CLOUDFLARE_ENABLED: "false" })).toEqual({ skipped: true, reason: "disabled" });
    const hidden = await handleRsiOnDemandRequest(new Request(`${origin}/internal/rsi-self-check`), scheduledEnv());
    expect(hidden?.status).toBe(404);
    expect(await audits()).toHaveLength(before + 1);
  });
});
