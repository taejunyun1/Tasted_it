import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { action, loader } from "../../app/routes/me";
import { WITHDRAW_CONFIRM_PHRASE } from "../../app/features/auth/withdraw";

let id: string, session: string;
beforeEach(async () => {
  id = crypto.randomUUID(); session = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,'합성 탈퇴 회원','USER',?,?,?)").bind(id, `${id}@example.test`, now, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(session, id, new Date(Date.now() + 60_000).toISOString(), now).run();
});
function request(method = "POST") {
  return new Request("https://retaste.test/me", { method, headers: { Cookie: `retaste_session=${session}`, Origin: "https://retaste.test" }, ...(method === "POST" ? { body: new URLSearchParams({ intent: "withdraw", confirm: WITHDRAW_CONFIRM_PHRASE }) } : {}) });
}

it("completes withdrawal and refuses the former session on a fresh member read", async () => {
  await expect(action({ request: request() } as never)).rejects.toMatchObject({ status: 302 });
  expect(await env.DB.prepare("SELECT count(*) n FROM sessions WHERE user_id=?").bind(id).first("n")).toBe(0);
  expect(await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(id).first("email")).toBe(`withdrawn.${id}@invalid.local`);
  await expect(loader({ request: request("GET") } as never)).rejects.toMatchObject({ status: 302 });
});

it("reports a server-side failure as unresolved and preserves the existing account", async () => {
  const trigger = `withdraw_failure_${id.replaceAll("-", "")}`;
  await env.DB.exec(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON users WHEN OLD.id='${id}' BEGIN SELECT RAISE(ABORT,'synthetic private failure'); END;`);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await action({ request: request() } as never);
    expect(result).toMatchObject({ data: { kind: "member-withdraw", outcome: "UNKNOWN" }, init: { status: 503, headers: { "Cache-Control": "private, no-store" } } });
    expect(JSON.stringify(result)).not.toContain("synthetic private failure");
    expect(await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(id).first("email")).toBe(`${id}@example.test`);
    expect(await env.DB.prepare("SELECT count(*) n FROM sessions WHERE user_id=?").bind(id).first("n")).toBe(1);
  } finally { log.mockRestore(); await env.DB.exec(`DROP TRIGGER ${trigger};`); }
});
