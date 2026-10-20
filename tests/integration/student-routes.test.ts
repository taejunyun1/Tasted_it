import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { action as manageStudents } from "../../app/routes/admin-students";
import { loader as loadStudent } from "../../app/routes/student-index";
import { loader as loadLogin } from "../../app/routes/login";
import { action as joinStudent } from "../../app/routes/student-join";
import { action as changeTask } from "../../app/routes/student-task";

async function session(role: "USER" | "ADMIN") {
  const id = crypto.randomUUID(); const sessionId = crypto.randomUUID(); const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id, `${id}@example.test`, "시험 사용자", role, now, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sessionId, id, "2099-01-01T00:00:00.000Z", now).run();
  return sessionId;
}
function request(path: string, sessionId: string | null, fields: Record<string, string>, origin = "https://retaste.test") {
  return new Request(`https://retaste.test${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, ...(sessionId ? { Cookie: `retaste_session=${sessionId}` } : {}) }, body: new URLSearchParams(fields) });
}
describe("student HTTP security boundaries", () => {
  it("sends an authenticated, unconnected member to invitation recovery instead of an access error", async () => {
    const id = await session("USER");
    const response = await loadStudent({ request: new Request("https://retaste.test/student", { headers: { Cookie: `retaste_session=${id}` } }) } as never);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/student/join?from=workspace");
  });
  it("honors a safe return path for a member who is already signed in", async () => {
    const id = await session("USER");
    const response = await loadLogin({ request: new Request("https://retaste.test/login?returnTo=%2Fstudent%2Fjoin", { headers: { Cookie: `retaste_session=${id}` } }) } as never);
    expect((response as Response).headers.get("Location")).toBe("/student/join");
  });
  it("keeps suspended and expired seats denied rather than redirecting them to join", async () => {
    for (const [active, expiry] of [[0, "2099-01-01T00:00:00.000Z"], [1, "2020-01-01T00:00:00.000Z"]] as const) {
      const id = await session("USER");
      const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE id = ?").bind(id).first<{ user_id: string }>();
      await env.DB.prepare("UPDATE student_seats SET user_id = ?, is_active = ?, expires_at = ? WHERE code = 'A'").bind(row!.user_id, active, expiry).run();
      await expect(loadStudent({ request: new Request("https://retaste.test/student", { headers: { Cookie: `retaste_session=${id}` } }) } as never)).rejects.toMatchObject({ status: 403 });
      await env.DB.prepare("UPDATE student_seats SET user_id = NULL, is_active = 1, expires_at = '2099-01-01T00:00:00.000Z' WHERE code = 'A'").run();
    }
  });
  it("requires authentication before joining or writing a task", async () => {
    for (const [action, path] of [[joinStudent, "/student/join"], [changeTask, "/student/tasks/missing"]] as const) {
      await expect(action({ request: request(path, null, { token: "A".repeat(43) }), params: { taskId: "missing" } } as never)).rejects.toMatchObject({ status: 302 });
    }
  });
  it("denies ordinary users administrator invitation controls", async () => {
    const id = await session("USER");
    await expect(manageStudents({ request: request("/admin/students", id, { intent: "invite", seatCode: "A" }) } as never)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects cross-origin invitation creation before a token is issued", async () => {
    const id = await session("ADMIN");
    const result = await manageStudents({ request: request("/admin/students", id, { intent: "invite", seatCode: "A" }, "https://evil.test") } as never);
    expect(result).toMatchObject({ init: { status: 403 } });
  });
  it("rejects unknown operations and forged role fields", async () => {
    const id = await session("ADMIN");
    for (const fields of [{ intent: "make-admin", seatCode: "A" }, { intent: "invite", seatCode: "A", role: "ADMIN" }]) {
      const result = await manageStudents({ request: request("/admin/students", id, fields) } as never);
      expect(result).toMatchObject({ init: { status: 400 } });
    }
  });
  it("does not accept a student's broad administrator intent", async () => {
    const id = await session("USER");
    const result = await changeTask({ request: request("/student/tasks/missing", id, { intent: "publish-review-items", workItemIds: "arbitrary", userId: "someone-else" }), params: { taskId: "missing" } } as never);
    expect(result).toMatchObject({ init: { status: 403 } });
  });
});
