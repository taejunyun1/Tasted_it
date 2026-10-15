import { and, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, studentInvitations, studentSeats, users } from "../../db/schema";
import { inviteTokenSchema, seatCodeSchema, type SeatCode } from "./policy";

export async function requireStudentAdmin(db: AppDb, userId: string) {
  const user = await db.query.users.findFirst({ where: and(eq(users.id, userId), eq(users.role, "ADMIN")) });
  if (!user) throw new Error("STUDENT_ADMIN_REQUIRED");
}

export async function studentAudit(db: AppDb, actorUserId: string, action: string, targetId: string, afterState: unknown, now: string) {
  await db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId, action, targetType: "STUDENT_WORKSPACE", targetId, afterState: JSON.stringify(afterState), createdAt: now });
}

async function digest(token: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getStudentSeat(db: AppDb, input: { userId: string; now: string }) {
  const [row] = await db.select({ seat: studentSeats }).from(studentSeats).innerJoin(users, eq(studentSeats.userId, users.id))
    .where(and(eq(studentSeats.userId, input.userId), eq(studentSeats.isActive, true), gt(studentSeats.expiresAt, input.now), isNotNull(users.emailVerifiedAt), ne(users.role, "ADMIN"))).limit(1);
  return row?.seat ?? null;
}

export async function createStudentInvite(db: AppDb, input: { seatCode: SeatCode; actorUserId: string; now: string }) {
  await requireStudentAdmin(db, input.actorUserId);
  const code = seatCodeSchema.parse(input.seatCode);
  const seat = await db.query.studentSeats.findFirst({ where: eq(studentSeats.code, code) });
  if (!seat || seat.userId || !seat.isActive || seat.expiresAt <= input.now) throw new Error("STUDENT_SEAT_UNAVAILABLE");
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const expiresAt = new Date(Math.min(Date.parse(input.now) + 7 * 86400_000, Date.parse(seat.expiresAt))).toISOString();
  await db.batch([
    db.update(studentInvitations).set({ revokedAt: input.now }).where(and(eq(studentInvitations.seatCode, code), isNull(studentInvitations.consumedAt), isNull(studentInvitations.revokedAt))),
    db.insert(studentInvitations).values({ id: crypto.randomUUID(), seatCode: code, tokenHash: await digest(token), expiresAt, createdBy: input.actorUserId, createdAt: input.now }),
  ]);
  await studentAudit(db, input.actorUserId, "STUDENT_INVITE_CREATED", code, { expiresAt }, input.now);
  return { token, expiresAt };
}

export async function acceptStudentInvite(db: AppDb, input: { token: string; userId: string; now: string }): Promise<SeatCode> {
  const valid = inviteTokenSchema.safeParse(input.token);
  if (!valid.success) throw new Error("STUDENT_INVITE_INVALID");
  const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
  if (!user?.emailVerifiedAt || user.role === "ADMIN") throw new Error("STUDENT_ACCOUNT_REQUIRED");
  const tokenHash = await digest(valid.data);
  const invitation = await db.query.studentInvitations.findFirst({ where: and(eq(studentInvitations.tokenHash, tokenHash), isNull(studentInvitations.consumedAt), isNull(studentInvitations.revokedAt), gt(studentInvitations.expiresAt, input.now)) });
  if (!invitation) throw new Error("STUDENT_INVITE_INVALID");
  const currentInvite = sql`exists (select 1 from student_invitations i where i.token_hash = ${tokenHash} and i.seat_code = ${studentSeats.code} and i.consumed_at is null and i.revoked_at is null and i.expires_at > ${input.now})`;
  const verifiedAccount = sql`exists (select 1 from users u where u.id = ${input.userId} and u.email_verified_at is not null and u.role <> 'ADMIN')`;
  const unusedUser = sql`not exists (select 1 from student_seats other where other.user_id = ${input.userId})`;
  const [claimed, consumed] = await db.batch([
    db.update(studentSeats).set({ userId: input.userId, updatedAt: input.now }).where(and(eq(studentSeats.code, invitation.seatCode), isNull(studentSeats.userId), eq(studentSeats.isActive, true), gt(studentSeats.expiresAt, input.now), currentInvite, verifiedAccount, unusedUser)).returning({ code: studentSeats.code }),
    db.update(studentInvitations).set({ consumedAt: input.now, consumedBy: input.userId }).where(and(eq(studentInvitations.tokenHash, tokenHash), isNull(studentInvitations.consumedAt), isNull(studentInvitations.revokedAt), gt(studentInvitations.expiresAt, input.now), sql`exists (select 1 from student_seats s where s.code = ${invitation.seatCode} and s.user_id = ${input.userId})`)).returning({ id: studentInvitations.id }),
  ]);
  if (claimed.length !== 1 || consumed.length !== 1) throw new Error("STUDENT_INVITE_INVALID");
  await studentAudit(db, input.userId, "STUDENT_INVITE_ACCEPTED", invitation.seatCode, { seatCode: invitation.seatCode }, input.now);
  return claimed[0]!.code;
}

export async function setStudentSeatActive(db: AppDb, input: { seatCode: SeatCode; isActive: boolean; actorUserId: string; now: string }) {
  await requireStudentAdmin(db, input.actorUserId);
  const code = seatCodeSchema.parse(input.seatCode);
  await db.batch([
    db.update(studentSeats).set({ isActive: input.isActive, updatedAt: input.now }).where(eq(studentSeats.code, code)),
    db.update(studentInvitations).set({ revokedAt: input.now }).where(and(eq(studentInvitations.seatCode, code), isNull(studentInvitations.consumedAt), isNull(studentInvitations.revokedAt))),
  ]);
  await studentAudit(db, input.actorUserId, input.isActive ? "STUDENT_ACCESS_ENABLED" : "STUDENT_ACCESS_REVOKED", code, { isActive: input.isActive }, input.now);
}
