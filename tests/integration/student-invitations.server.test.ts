import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { studentInvitations, studentSeats, users } from "../../app/db/schema";
import { acceptStudentInvite, createStudentInvite, getStudentSeat, setStudentSeatActive } from "../../app/features/students/invitations.server";

const db = createDb(env.DB);
const now = "2026-10-15T01:00:00.000Z";
async function user(role: "USER" | "ADMIN" = "USER", verified = true) {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email: `${id}@example.test`, displayName: "시험 계정", role, emailVerifiedAt: verified ? now : null, createdAt: now, updatedAt: now });
  return id;
}
beforeEach(async () => {
  await db.delete(studentInvitations);
  await db.update(studentSeats).set({ userId: null, isActive: true });
});

describe("individual single-use student invitations", () => {
  it("stores only a digest and attaches a verified ordinary account once", async () => {
    const admin = await user("ADMIN");
    const member = await user();
    const invite = await createStudentInvite(db, { seatCode: "A", actorUserId: admin, now });
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await db.select().from(studentInvitations);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(invite.token);
    expect(rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await acceptStudentInvite(db, { token: invite.token, userId: member, now })).toBe("A");
    expect(await getStudentSeat(db, { userId: member, now })).toMatchObject({ code: "A", userId: member, canApproveRegistration: true });
    await expect(acceptStudentInvite(db, { token: invite.token, userId: await user(), now })).rejects.toThrow("STUDENT_INVITE_INVALID");
    expect((await db.query.users.findFirst({ where: eq(users.id, member) }))?.role).toBe("USER");
  });
  it("rejects an expired, malformed, or replaced link", async () => {
    const admin = await user("ADMIN"); const member = await user();
    const old = await createStudentInvite(db, { seatCode: "B", actorUserId: admin, now });
    await createStudentInvite(db, { seatCode: "B", actorUserId: admin, now });
    await expect(acceptStudentInvite(db, { token: old.token, userId: member, now })).rejects.toThrow("STUDENT_INVITE_INVALID");
    const active = await createStudentInvite(db, { seatCode: "C", actorUserId: admin, now });
    await expect(acceptStudentInvite(db, { token: active.token, userId: member, now: "2026-10-23T01:00:00.000Z" })).rejects.toThrow("STUDENT_INVITE_INVALID");
    await expect(acceptStudentInvite(db, { token: "bad", userId: member, now })).rejects.toThrow("STUDENT_INVITE_INVALID");
  });
  it("requires an actual administrator to issue or revoke access", async () => {
    const member = await user();
    await expect(createStudentInvite(db, { seatCode: "A", actorUserId: member, now })).rejects.toThrow("STUDENT_ADMIN_REQUIRED");
    await expect(setStudentSeatActive(db, { seatCode: "A", isActive: false, actorUserId: member, now })).rejects.toThrow("STUDENT_ADMIN_REQUIRED");
    expect(await db.select().from(studentInvitations)).toHaveLength(0);
  });
  it("does not let an unverified or administrator account take a student seat", async () => {
    const admin = await user("ADMIN");
    const invite = await createStudentInvite(db, { seatCode: "A", actorUserId: admin, now });
    await expect(acceptStudentInvite(db, { token: invite.token, userId: await user("USER", false), now })).rejects.toThrow("STUDENT_ACCOUNT_REQUIRED");
    await expect(acceptStudentInvite(db, { token: invite.token, userId: admin, now })).rejects.toThrow("STUDENT_ACCOUNT_REQUIRED");
    expect((await db.query.studentSeats.findFirst({ where: eq(studentSeats.code, "A") }))?.userId).toBeNull();
  });
  it("allows only one winner when the same invitation is accepted concurrently", async () => {
    const admin = await user("ADMIN");
    const invite = await createStudentInvite(db, { seatCode: "A", actorUserId: admin, now });
    const members = [await user(), await user()];
    const results = await Promise.allSettled(members.map((userId) => acceptStudentInvite(db, { token: invite.token, userId, now })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.select().from(studentSeats)).filter((s) => s.userId)).toHaveLength(1);
  });
  it("prevents one user occupying two seats and prevents reissuing a claimed seat", async () => {
    const admin = await user("ADMIN"); const member = await user();
    const a = await createStudentInvite(db, { seatCode: "A", actorUserId: admin, now });
    const b = await createStudentInvite(db, { seatCode: "B", actorUserId: admin, now });
    await acceptStudentInvite(db, { token: a.token, userId: member, now });
    await expect(acceptStudentInvite(db, { token: b.token, userId: member, now })).rejects.toThrow("STUDENT_INVITE_INVALID");
    await expect(createStudentInvite(db, { seatCode: "A", actorUserId: admin, now })).rejects.toThrow("STUDENT_SEAT_UNAVAILABLE");
  });
  it("revocation and project expiry deny existing sessions immediately", async () => {
    const admin = await user("ADMIN"); const member = await user();
    const invite = await createStudentInvite(db, { seatCode: "D", actorUserId: admin, now });
    await acceptStudentInvite(db, { token: invite.token, userId: member, now });
    await setStudentSeatActive(db, { seatCode: "D", isActive: false, actorUserId: admin, now });
    expect(await getStudentSeat(db, { userId: member, now })).toBeNull();
    await setStudentSeatActive(db, { seatCode: "D", isActive: true, actorUserId: admin, now });
    expect(await getStudentSeat(db, { userId: member, now: "2026-12-31T15:00:00.000Z" })).toBeNull();
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, member));
    expect(await getStudentSeat(db, { userId: member, now })).toBeNull();
  });
});
