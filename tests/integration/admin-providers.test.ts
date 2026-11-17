import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { action, loader } from "../../app/routes/admin-providers";

async function session(role: "USER" | "ADMIN") {
  const id = crypto.randomUUID(), sessionId = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .bind(id, `${id}@example.test`, "private-operator-name", role, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(sessionId, id, "2099-01-01T00:00:00.000Z", now).run();
  return sessionId;
}
function request(sessionId?: string, method = "GET") {
  return new Request("https://example.test/admin/providers", { method, headers: sessionId ? { Cookie: `retaste_session=${sessionId}` } : {} });
}
afterEach(() => vi.restoreAllMocks());

describe("read-only provider dashboard", () => {
  it("rejects anonymous/member reads and all administrator mutations with private headers", async () => {
    const member = await session("USER"), admin = await session("ADMIN");
    for (const [sid, status] of [[undefined, 302], [member, 403]] as const) {
      const response = await loader({ request: request(sid) } as never).catch((error: unknown) => error);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(status);
      expect((response as Response).headers.get("Cache-Control")).toBe("private, no-store");
    }
    const before = await env.DB.prepare("SELECT count(*) AS count FROM provider_call_attempts").first();
    const rejected = await action({ request: request(admin, "POST") } as never);
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get("Allow")).toBe("GET, HEAD");
    expect(await env.DB.prepare("SELECT count(*) AS count FROM provider_call_attempts").first()).toEqual(before);
  });

  it("reads bounded history without dispatching or exposing upstream errors and credentials", async () => {
    const admin = await session("ADMIN"), now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO public_data_sync_runs(id,source_type,region_code,address_field,status,next_page,fetched_count,error_summary,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind("private-run-id", "GENERAL_RESTAURANT", "GWANGJU", "ROAD_NM_ADDR", "FAILED", 2, 123, "private-upstream-error-and-key", now, now, now).run();
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected external request"));
    const before = await env.DB.prepare("SELECT count(*) AS count FROM provider_call_attempts").first();
    const response = await loader({ request: request(admin) } as never);
    expect(response.init?.headers).toMatchObject({ "Cache-Control": "private, no-store", Vary: "Cookie" });
    expect(response.data.other.publicRun).toMatchObject({ records: 123, nextPage: 2, status: "FAILED" });
    expect(response.data.naver.configured).toBeTypeOf("boolean");
    expect(response.data.naver.configValid).toBeTypeOf("boolean");
    expect(response.data.utcDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(response.data)).not.toMatch(/private-|API_HUB_KEY|RESEND_API_KEY|serviceKey|errorSummary/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT count(*) AS count FROM provider_call_attempts").first()).toEqual(before);
  });
});
