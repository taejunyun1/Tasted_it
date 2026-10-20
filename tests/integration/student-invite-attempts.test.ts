import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { createStudentInvite } from "../../app/features/students/invitations.server";
import { recordStudentInviteFailure } from "../../app/features/students/invite-attempts.server";
import { action as joinStudent } from "../../app/routes/student-join";

const db = createDb(env.DB);
async function member(role: "USER" | "ADMIN" = "USER", verified = true) {
  const id = crypto.randomUUID(); const session = crypto.randomUUID(); const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id, `${id}@example.test`, "학생 진단 시험", role, verified ? now : null, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(session, id, "2099-01-01T00:00:00.000Z", now).run();
  return { id, session };
}
async function post(session: string | null, token: string, origin = "https://retaste.test") {
  return joinStudent({ request: new Request("https://retaste.test/student/join.data", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded", ...(session ? { Cookie: `retaste_session=${session}` } : {}) },
    body: new URLSearchParams({ intent: "accept", token }),
  }) } as never);
}
async function failures() {
  return (await env.DB.prepare("SELECT actor_user_id,target_id,after_state FROM admin_audit_logs WHERE action='STUDENT_INVITE_FAILED' ORDER BY created_at").all()).results;
}
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM student_invitations").run();
  await env.DB.prepare("DELETE FROM admin_audit_logs WHERE target_type='STUDENT_WORKSPACE'").run();
  await env.DB.prepare("UPDATE student_seats SET user_id=NULL,is_active=1,expires_at='2099-01-01T00:00:00.000Z'").run();
});

describe("durable student invitation failure diagnostics", () => {
  it("records a missing invitation without recording its token or changing existing invitations", async () => {
    const admin = await member("ADMIN"); const user = await member();
    const valid = await createStudentInvite(db, { seatCode: "A", actorUserId: admin.id, now: new Date().toISOString() });
    const before = await env.DB.prepare("SELECT * FROM student_invitations").all();
    const token = "Z".repeat(43);
    expect(await post(user.session, token)).toMatchObject({ init: { status: 400 } });
    const rows = await failures();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: user.id, target_id: "join" });
    expect(JSON.parse(rows[0].after_state as string)).toEqual({ reason: "INVITE_NOT_FOUND", status: 400, seatCode: null });
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(valid.token);
    expect((await env.DB.prepare("SELECT * FROM student_invitations").all()).results).toEqual(before.results);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM student_seats WHERE user_id IS NOT NULL").first<{n:number}>())!.n).toBe(0);
  });

  it.each([
    ["expired", "INVITE_EXPIRED"], ["revoked", "INVITE_REVOKED"], ["used", "INVITE_ALREADY_USED"],
    ["seat-inactive", "SEAT_INACTIVE"], ["seat-expired", "SEAT_EXPIRED"],
    ["seat-linked", "SEAT_ALREADY_LINKED"], ["account-linked", "ACCOUNT_ALREADY_LINKED"],
  ])("diagnoses %s while preserving the public error and seat state", async (scenario, reason) => {
    const admin = await member("ADMIN"); const user = await member(); const other = await member();
    const invite = await createStudentInvite(db, { seatCode: "A", actorUserId: admin.id, now: new Date().toISOString() });
    if (scenario === "expired") await env.DB.prepare("UPDATE student_invitations SET expires_at='2020-01-01T00:00:00.000Z'").run();
    if (scenario === "revoked") await env.DB.prepare("UPDATE student_invitations SET revoked_at='2020-01-01T00:00:00.000Z'").run();
    if (scenario === "used") await env.DB.prepare("UPDATE student_invitations SET consumed_at='2020-01-01T00:00:00.000Z',consumed_by=?").bind(other.id).run();
    if (scenario === "seat-inactive") await env.DB.prepare("UPDATE student_seats SET is_active=0 WHERE code='A'").run();
    if (scenario === "seat-expired") await env.DB.prepare("UPDATE student_seats SET expires_at='2020-01-01T00:00:00.000Z' WHERE code='A'").run();
    if (scenario === "seat-linked") await env.DB.prepare("UPDATE student_seats SET user_id=? WHERE code='A'").bind(other.id).run();
    if (scenario === "account-linked") await env.DB.prepare("UPDATE student_seats SET user_id=? WHERE code='B'").bind(user.id).run();
    const before = await env.DB.prepare("SELECT * FROM student_seats ORDER BY code").all();
    expect(await post(user.session, invite.token)).toMatchObject({ init: { status: 400 } });
    const rows = await failures(); expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].after_state as string)).toEqual({ reason, status: 400, seatCode: "A" });
    expect(JSON.stringify(rows)).not.toContain(invite.token);
    expect((await env.DB.prepare("SELECT * FROM student_seats ORDER BY code").all()).results).toEqual(before.results);
  });

  it("records an ineligible account without consuming the valid invitation", async () => {
    const admin = await member("ADMIN"); const user = await member("USER", false);
    const invite = await createStudentInvite(db, { seatCode: "A", actorUserId: admin.id, now: new Date().toISOString() });
    expect(await post(user.session, invite.token)).toMatchObject({ init: { status: 403 } });
    expect(JSON.parse((await failures())[0].after_state as string)).toEqual({ reason: "ACCOUNT_NOT_ELIGIBLE", status: 403, seatCode: null });
    expect(await env.DB.prepare("SELECT consumed_at FROM student_invitations").first()).toEqual({ consumed_at: null });
  });

  it("bounds failure audit writes by the existing JOIN rate limit", async () => {
    const user = await member();
    for (let i=0; i<12; i++) expect(await post(user.session, "Z".repeat(43))).toMatchObject({ init: { status: i<10 ? 400 : 429 } });
    expect(await failures()).toHaveLength(10);
  });

  it("does not create failure audit rows before session, origin, and form validation", async () => {
    const user = await member();
    await expect(post(null, "Z".repeat(43))).rejects.toMatchObject({ status: 302 });
    expect(await post(user.session, "bad")).toMatchObject({ init: { status: 400 } });
    expect(await post(user.session, "Z".repeat(43), "https://evil.test")).toMatchObject({ init: { status: 403 } });
    expect(await failures()).toHaveLength(0);
  });

  it("retains normal acceptance and its success audit", async () => {
    const admin = await member("ADMIN"); const user = await member();
    const invite = await createStudentInvite(db, { seatCode: "A", actorUserId: admin.id, now: new Date().toISOString() });
    const response = await post(user.session, invite.token) as Response;
    expect(response.status).toBe(302); expect(response.headers.get("Location")).toBe("/student");
    expect(await failures()).toHaveLength(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action='STUDENT_INVITE_ACCEPTED'").first()).toEqual({ n: 1 });
  });

  it("stores only an allowlisted reason for unexpected internal failures", async () => {
    const user = await member(); const secret = "internal database details must not escape";
    await recordStudentInviteFailure(db, { userId: user.id, token: "Z".repeat(43), error: new Error(secret), now: new Date().toISOString() });
    const rows = await failures();
    expect(JSON.parse(rows[0].after_state as string)).toEqual({ reason: "UNEXPECTED", status: 500, seatCode: null });
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it("does not throw or disclose internal details when the audit write fails", async () => {
    const user = await member();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const insert = vi.spyOn(db, "insert").mockImplementationOnce(() => { throw new Error("sensitive database failure"); });
    try {
      await expect(recordStudentInviteFailure(db, { userId: user.id, token: "Z".repeat(43), error: new Error("private error"), now: new Date().toISOString() })).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledExactlyOnceWith("STUDENT_INVITE_AUDIT_FAILED");
      expect(await failures()).toHaveLength(0);
    } finally { insert.mockRestore(); warn.mockRestore(); }
  });
});
