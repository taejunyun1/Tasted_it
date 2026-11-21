import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { action, loader } from "../../app/routes/admin-email-domain";

async function session(role: "USER" | "ADMIN") {
  const id = crypto.randomUUID(); const sid = crypto.randomUUID(); const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id, `${id}@example.test`, "메일 시험", role, now, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(sid, id, "2099-01-01T00:00:00.000Z", now).run();
  return sid;
}
const request = (sid?: string, post = false, origin = "https://retaste.test") => new Request("https://retaste.test/admin/operations/email-domain", {
  method: post ? "POST" : "GET", headers: { ...(sid ? { Cookie: `retaste_session=${sid}` } : {}), Origin: origin,
    ...(post ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, ...(post ? { body: "intent=create" } : {}),
});
async function privateDenial(promise: Promise<unknown>, status: number) {
  const error = await promise.catch((value) => value);
  expect(error).toBeInstanceOf(Response);
  expect(error.status).toBe(status);
  expect(error.headers.get("Cache-Control")).toBe("private, no-store");
  expect(error.headers.get("Vary")).toBe("Cookie");
  expect(error.headers.get("X-Robots-Tag")).toContain("noindex");
}
describe("email repair access boundaries", () => {
  it("requires authentication for reads and writes", async () => {
    await privateDenial(loader({ request: request() } as never), 302);
    await privateDenial(action({ request: request(undefined, true) } as never), 302);
  });
  it("denies an ordinary user reads and writes", async () => {
    const sid = await session("USER");
    await privateDenial(loader({ request: request(sid) } as never), 403);
    await privateDenial(action({ request: request(sid, true) } as never), 403);
  });
  it("remains disabled even for ADMIN without a deployment target", async () => {
    const sid = await session("ADMIN");
    await expect(loader({ request: request(sid) } as never)).resolves.toMatchObject({ configured: false, control: null });
    const result = await action({ request: new Request("https://retaste.test/admin/operations/email-domain", {method: "POST",headers: {Cookie: `retaste_session=${sid}`,Origin: "https://retaste.test"},body:new URLSearchParams({intent:"refresh"})}) } as never);
    expect(result.init?.status).toBe(503);
  });
  it("rejects cross-origin writes before an external action", async () => {
    const sid = await session("ADMIN");
    const result = await action({ request: request(sid, true, "https://other.test") } as never);
    expect(result.init?.status).toBe(403);
    expect(new Headers(result.init?.headers).get("Cache-Control")).toBe("private, no-store");
  });
  it("rejects other action methods", async () => {
    const sid = await session("ADMIN");
    const result = await action({ request: new Request("https://retaste.test/admin/operations/email-domain", { method: "DELETE", headers: { Cookie: `retaste_session=${sid}` } }) } as never);
    expect(result.init?.status).toBe(405);
    expect(new Headers(result.init?.headers).get("Allow")).toBe("POST");
  });
});
