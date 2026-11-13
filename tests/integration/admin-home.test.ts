import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as home from "../../app/features/operations/admin-home.server";
import * as auth from "../../app/features/auth/session.server";
import { headers, loader } from "../../app/routes/admin-index";

async function session(role: "USER" | "ADMIN", expiresAt = "2099-01-01T00:00:00.000Z") {
  const id = crypto.randomUUID(), sid = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id, `${id}@example.test`, "운영 시험", role, now, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(sid, id, expiresAt, now).run();
  return sid;
}
const request = (sid?: string, query = "") => new Request(`https://example.test/admin${query}`, {
  headers: sid ? { Cookie: `retaste_session=${sid}` } : {},
});
function expectPrivate(value: HeadersInit | undefined) {
  const result = new Headers(value);
  expect(result.get("Cache-Control")).toBe("private, no-store");
  expect(result.get("Vary")).toBe("Cookie");
  expect(result.get("X-Robots-Tag")).toBe("noindex, nofollow");
}
afterEach(() => vi.restoreAllMocks());

describe("admin home", () => {
  it("denies anonymous, member and expired sessions before reading summaries", async () => {
    const summary = vi.spyOn(home, "getAdminHomeSummary");
    const member = await session("USER"), expired = await session("ADMIN", "2020-01-01T00:00:00.000Z");
    for (const [sid, status] of [[undefined, 302], [member, 403], [expired, 302]] as const) {
      const response = await loader({ request: request(sid) } as never).catch((error: unknown) => error);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(status);
      expectPrivate((response as Response).headers);
    }
    expect(summary).not.toHaveBeenCalled();
  });

  it("returns only aggregate values, marks capped alerts and ignores unknown filters", async () => {
    const sid = await session("ADMIN"), now = new Date().toISOString(), id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, id, "private-place-name", "PUBLISHED", "private-address", "동명동", 35.1, 126.9, "private-search", now, now).run();
    await env.DB.batch(Array.from({ length: 101 }, (_, index) => env.DB.prepare("INSERT INTO operational_alerts(id,alert_type,severity,source_id,status,message,details_json,occurrence_count,first_occurred_at,last_occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(`${id}-${index}`, "PUBLIC_DATA_SYNC", "ERROR", `private-source-${index}`, "OPEN", "private-alert-message", '{"email":"private@example.test"}', 1, now, now)));
    const response = await loader({ request: request(sid, "?area=https://outside.test") } as never);
    expect(response.data).toMatchObject({ state: "AVAILABLE", area: "all", summary: { catalog: { published: 1 }, openAlerts: { count: 100, limit: 100, capped: true } } });
    expect(new Date(response.data.queriedAt).getTime()).not.toBeNaN();
    expectPrivate(response.init?.headers);
    expectPrivate(headers({} as never));
    expect(JSON.stringify(response.data)).not.toMatch(/private-|private@|detailsJson|sourceId|alerts"/);
    const audit = await env.DB.prepare("SELECT count(*) AS value FROM admin_audit_logs").first<{ value: number }>();
    expect(audit?.value).toBe(0);
  });

  it("returns unavailable rather than zero counts or private error details on summary failure", async () => {
    const sid = await session("ADMIN");
    vi.spyOn(home, "getAdminHomeSummary").mockRejectedValueOnce(new Error("private-database-detail"));
    const response = await loader({ request: request(sid, "?area=privacy") } as never);
    expect(response.init?.status).toBe(503);
    expect(response.data).toMatchObject({ state: "UNAVAILABLE", summary: null, area: "privacy" });
    expectPrivate(response.init?.headers);
    expect(JSON.stringify(response.data)).not.toContain("private-database-detail");
  });

  it("fails closed with private headers when authentication storage is unavailable", async () => {
    vi.spyOn(auth, "requireAdmin").mockRejectedValueOnce(new Error("private-auth-detail"));
    const response = await loader({ request: request() } as never).catch((error: unknown) => error);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
    expectPrivate((response as Response).headers);
    expect(await (response as Response).text()).not.toContain("private-auth-detail");
  });
});
