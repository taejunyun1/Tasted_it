import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { action, loader } from "../../app/routes/admin-rsi-check";

vi.mock("cloudflare:workers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cloudflare:workers")>();
  return { ...actual, env: new Proxy(actual.env, { get(target, property, receiver) {
    if (property === "RSI_CLOUDFLARE_ENABLED") return "true";
    if (property === "APP_BASE_URL") return "https://rsi.test";
    return Reflect.get(target, property, receiver);
  } }) };
});

async function session(role: "USER" | "ADMIN") {
  const id = crypto.randomUUID(), sid = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id, `${id}@example.test`, "운영 시험", role, now, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(sid, id, "2099-01-01T00:00:00.000Z", now).run();
  return { id, sid };
}
const request = (sid?: string, origin = "https://rsi.test", body = "intent=run", method = "POST") => new Request("https://rsi.test/admin/operations/rsi-check", {
  method, headers: { ...(sid ? { Cookie: `retaste_session=${sid}` } : {}), Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
  ...(method === "POST" ? { body } : {}),
});
const passingFetch = () => vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/admin"
  ? new Response(null, { status: 302, headers: { Location: "/login?private=never-record" } }) : new Response("ok"));
async function audits(actorUserId?: string) {
  const rows = (await env.DB.prepare("SELECT actor_user_id,after_state FROM admin_audit_logs WHERE action='RSI_SELF_CHECK' AND target_id='rsi-admin'").all<{ actor_user_id: string; after_state: string }>()).results;
  return actorUserId ? rows.filter((r) => r.actor_user_id === actorUserId) : rows;
}
afterEach(() => { vi.unstubAllGlobals(); });
describe("ADMIN RSI operation", () => {
  it("denies anonymous and USER requests before network calls", async () => {
    const fetch = passingFetch(); vi.stubGlobal("fetch", fetch);
    await expect(action({ request: request() } as never)).rejects.toMatchObject({ status: 302 });
    const user = await session("USER");
    await expect(action({ request: request(user.sid) } as never)).rejects.toMatchObject({ status: 403 });
    expect(fetch).not.toHaveBeenCalled(); expect(await audits()).toHaveLength(0);
  });
  it("rejects cross-origin, unexpected fields and GET without a probe", async () => {
    const user = await session("ADMIN"), fetch = passingFetch(); vi.stubGlobal("fetch", fetch);
    expect((await action({ request: request(user.sid, "https://other.test") } as never)).status).toBe(403);
    expect((await action({ request: request(user.sid, undefined, "intent=run&origin=https://other.test") } as never)).status).toBe(400);
    expect((await loader({ request: request(user.sid, undefined, undefined, "GET") } as never)).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled(); expect(await audits()).toHaveLength(0);
  });
  it("uses the configured six paths and records ADMIN execution separately", async () => {
    const user = await session("ADMIN"), fetch = passingFetch(); vi.stubGlobal("fetch", fetch);
    const response = await action({ request: request(user.sid) } as never);
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ ok: true, failed: 0, paths: expect.any(Array) });
    expect(fetch).toHaveBeenCalledTimes(6);
    const rows = await audits(user.id);expect(rows).toHaveLength(1);expect(rows[0].actor_user_id).toBe(user.id);
    const payload = JSON.parse(rows[0].after_state);expect(payload.trigger).toBe("admin");expect(payload.paths).toHaveLength(6);
    expect(rows[0].after_state).not.toMatch(/location|private|token|cookie/i);
  });
  it("returns failure and retains failed results without private exception details", async () => {
    const user = await session("ADMIN");vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private-upstream-detail"); }));
    const response = await action({ request: request(user.sid) } as never);
    expect(response.status).toBe(503);expect(await response.text()).not.toContain("private-upstream-detail");
    expect(JSON.parse((await audits(user.id))[0].after_state)).toMatchObject({ trigger: "admin", ok: false, failed: 6 });
  });
});
