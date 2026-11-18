import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { action } from "../../app/routes/me";
import { WITHDRAW_CONFIRM_PHRASE } from "../../app/features/auth/withdraw";

let userId: string, otherId: string, placeId: string, sessionId: string;
beforeEach(async () => {
  userId = crypto.randomUUID(); otherId = crypto.randomUUID(); placeId = crypto.randomUUID(); sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  for (const [id, role] of [[userId, "ADMIN"], [otherId, "USER"]]) {
    await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,'합성 회원',?,?,?,?)").bind(id, `${id}@example.test`, role, now, now, now).run();
  }
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sessionId, userId, new Date(Date.now() + 60_000).toISOString(), now).run();
  await env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,'합성 저장 장소','PUBLISHED','합성 주소','합성',35.1,126.9,'합성',?,?)").bind(placeId, placeId, now, now).run();
  for (const id of [userId, otherId]) await env.DB.prepare("INSERT INTO saved_places(user_id,place_id,created_at) VALUES(?,?,?)").bind(id, placeId, now).run();
});

function request(fields: Record<string, string>, origin = "https://retaste.test", cookie = `retaste_session=${sessionId}`) {
  return new Request("https://retaste.test/me", { method: "POST", headers: { Origin: origin, Cookie: cookie }, body: new URLSearchParams(fields) });
}

it("returns a private success receipt for only the authenticated member's unsave", async () => {
  const result = await action({ request: request({ intent: "unsave", placeId, userId: otherId }) } as never);
  expect(result).toMatchObject({ data: { kind: "member-save", ok: true, outcome: "REMOVED", placeId }, init: { headers: { "Cache-Control": "private, no-store" } } });
  expect(await env.DB.prepare("SELECT count(*) AS n FROM saved_places WHERE user_id=? AND place_id=?").bind(userId, placeId).first("n")).toBe(0);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM saved_places WHERE user_id=? AND place_id=?").bind(otherId, placeId).first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT saved FROM member_save_choices WHERE user_id=? AND place_id=?").bind(userId, placeId).first("saved")).toBe(0);
});

it("rejects invalid save requests and preserves origin and login checks", async () => {
  expect(await action({ request: request({ intent: "unsave", placeId: "" }) } as never)).toMatchObject({ data: { outcome: "REJECTED" }, init: { status: 400 } });
  await expect(action({ request: request({ intent: "unsave", placeId }, "https://other.test") } as never)).rejects.toMatchObject({ status: 403 });
  await expect(action({ request: request({ intent: "unsave", placeId }, "https://retaste.test", "") } as never)).rejects.toMatchObject({ status: 302 });
  expect(await env.DB.prepare("SELECT count(*) AS n FROM saved_places WHERE user_id=? AND place_id=?").bind(userId, placeId).first("n")).toBe(1);
});

it("reports an unresolved write safely rather than claiming failure or replaying it", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await action({ request: request({ intent: "unsave", placeId: "missing-synthetic-place" }) } as never);
    expect(result).toMatchObject({ data: { kind: "member-save", ok: false, outcome: "UNKNOWN" }, init: { status: 503 } });
    expect(JSON.stringify(result)).not.toMatch(/FOREIGN KEY|SQLITE|stack/);
    expect(log).toHaveBeenCalledExactlyOnceWith("MEMBER_UNSAVE_FAILED");
  } finally { log.mockRestore(); }
});

it("keeps withdrawal confirmation and the admin withdrawal prohibition unchanged", async () => {
  expect(await action({ request: request({ intent: "withdraw", confirm: "wrong" }) } as never)).toMatchObject({ withdrawError: "확인 문구를 정확히 입력해 주세요." });
  expect(await action({ request: request({ intent: "withdraw", confirm: WITHDRAW_CONFIRM_PHRASE }) } as never)).toMatchObject({ withdrawError: "관리자 계정은 이 화면에서 탈퇴할 수 없습니다." });
  expect(await env.DB.prepare("SELECT count(*) AS n FROM users WHERE id=?").bind(userId).first("n")).toBe(1);
});
