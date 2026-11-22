import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { eq } from "drizzle-orm";
import { authenticateAccount, registerAccount, requestPasswordReset, resetPassword, verifyEmailToken, withdrawAccount } from "../../app/features/auth/account.server";
import { WITHDRAWN_DISPLAY_NAME, withdrawnEmailFor } from "../../app/features/auth/withdraw";
import { castVote } from "../../app/features/ratings/vote.server";
import { authIdentities, reviewerApplications, reviewerProfiles, savedPlaces, sessions, users, voteEvents } from "../../app/db/schema";

async function passwordResetFixture() {
  const db = createDb(env.DB);
  const email = `reset-${crypto.randomUUID()}@example.com`;
  const oldPassword = "old-password-123";
  const { userId, token: verificationToken } = await registerAccount(db, { email, displayName: "회원", password: oldPassword, now: new Date("2026-08-05T12:00:00Z") });
  await verifyEmailToken(db, { token: verificationToken, now: new Date("2026-08-05T12:01:00Z") });
  await db.insert(sessions).values({ id: crypto.randomUUID(), userId, createdAt: "2026-08-05T12:01:00Z", expiresAt: "2026-08-12T12:01:00Z" });
  const reset = await requestPasswordReset(db, { email, now: new Date("2026-08-05T12:02:00Z") });
  if (!reset) throw new Error("Reset test fixture did not issue a token");
  return { db, email, oldPassword, userId, token: reset.token };
}

describe("member accounts", () => {
  it("requires email verification before password login", async () => {
    const db = createDb(env.DB);
    const email = `member-${crypto.randomUUID()}@example.com`;
    const registration = await registerAccount(db, { email, displayName: "회원", password: "secure-password-123", adminEmail: "admin@example.com", now: new Date("2026-08-05T12:00:00Z") });
    await expect(authenticateAccount(db, { email, password: "secure-password-123" })).rejects.toThrow("EMAIL_NOT_VERIFIED");
    await verifyEmailToken(db, { token: registration.token, now: new Date("2026-08-05T12:10:00Z") });
    await expect(authenticateAccount(db, { email, password: "secure-password-123" })).resolves.toMatchObject({ email });
    await expect(verifyEmailToken(db, { token: registration.token, now: new Date("2026-08-05T12:11:00Z") })).rejects.toThrow("TOKEN_INVALID");
  });

  it("resets a password with a single-use token", async () => {
    const db = createDb(env.DB);
    const email = `reset-${crypto.randomUUID()}@example.com`;
    const registration = await registerAccount(db, { email, displayName: "회원", password: "old-password-123", now: new Date("2026-08-05T12:00:00Z") });
    await verifyEmailToken(db, { token: registration.token, now: new Date("2026-08-05T12:01:00Z") });
    const reset = await requestPasswordReset(db, { email, now: new Date("2026-08-05T12:02:00Z") });
    expect(reset?.token).toBeTruthy();
    await resetPassword(db, { token: reset!.token, password: "new-password-456", now: new Date("2026-08-05T12:03:00Z") });
    await expect(authenticateAccount(db, { email, password: "new-password-456" })).resolves.toMatchObject({ email });
    await expect(resetPassword(db, { token: reset!.token, password: "another-password", now: new Date("2026-08-05T12:04:00Z") })).rejects.toThrow("TOKEN_INVALID");
  });

  it.each(["UPDATE OF password_hash ON users", "DELETE ON sessions"])("rolls back password reset when %s fails", async mutation => {
    const { db, email, oldPassword, userId, token } = await passwordResetFixture();
    const newPassword = "new-password-456";
    const input = { token, password: newPassword, now: new Date("2026-08-05T12:03:00Z") };
    const ownerColumn = mutation.endsWith("users") ? "id" : "user_id";
    await env.DB.exec(`CREATE TRIGGER fail_password_reset BEFORE ${mutation} WHEN OLD.${ownerColumn}='${userId}' BEGIN SELECT RAISE(ABORT,'fixture reset write failure'); END;`);
    try {
      await expect(resetPassword(db, input)).rejects.toThrow();
      await expect(authenticateAccount(db, { email, password: oldPassword })).resolves.toMatchObject({ email });
      await expect(authenticateAccount(db, { email, password: newPassword })).rejects.toThrow("LOGIN_INVALID");
      expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(1);
    } finally {
      await env.DB.exec("DROP TRIGGER fail_password_reset");
    }
    await expect(resetPassword(db, input)).resolves.toEqual({ userId });
    await expect(authenticateAccount(db, { email, password: newPassword })).resolves.toMatchObject({ email });
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
  });

  it("commits only one of two concurrent uses of the same reset token", async () => {
    const { db, email, userId, token } = await passwordResetFixture();
    const attempts = ["concurrent-password-1", "concurrent-password-2"].map(password => ({ token, password, now: new Date("2026-08-05T12:03:00Z") }));
    const outcomes = await Promise.allSettled(attempts.map(input => resetPassword(db, input)));
    const winner = outcomes.findIndex(outcome => outcome.status === "fulfilled");
    expect(winner).toBeGreaterThanOrEqual(0);
    const loser = winner === 0 ? 1 : 0;
    expect(outcomes[winner]).toEqual({ status: "fulfilled", value: { userId } });
    expect(outcomes[loser]).toMatchObject({ status: "rejected", reason: { message: "TOKEN_INVALID" } });
    await expect(authenticateAccount(db, { email, password: attempts[winner]!.password })).resolves.toMatchObject({ email });
    await expect(authenticateAccount(db, { email, password: attempts[loser]!.password })).rejects.toThrow("LOGIN_INVALID");
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
  });

  it("rejects an unknown email after running a password check", async () => {
    const db = createDb(env.DB);
    await expect(authenticateAccount(db, { email: `missing-${crypto.randomUUID()}@example.com`, password: "secure-password-123" })).rejects.toThrow("LOGIN_INVALID");
  });

  it("deletes all sessions for the user after a password reset", async () => {
    const db = createDb(env.DB);
    const email = `session-${crypto.randomUUID()}@example.com`;
    const registration = await registerAccount(db, { email, displayName: "회원", password: "old-password-123", now: new Date("2026-08-05T12:00:00Z") });
    await verifyEmailToken(db, { token: registration.token, now: new Date("2026-08-05T12:01:00Z") });
    await db.insert(sessions).values({
      id: crypto.randomUUID(),
      userId: registration.userId,
      createdAt: "2026-08-05T12:01:00.000Z",
      expiresAt: "2026-08-12T12:01:00.000Z",
    });
    const reset = await requestPasswordReset(db, { email, now: new Date("2026-08-05T12:02:00Z") });
    await resetPassword(db, { token: reset!.token, password: "new-password-456", now: new Date("2026-08-05T12:03:00Z") });
    const remaining = await db.select().from(sessions).where(eq(sessions.userId, registration.userId));
    expect(remaining).toHaveLength(0);
  });

  it("anonymizes a member, drops credentials, and keeps vote events", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const email = `withdraw-${suffix}@example.com`;
    const now = new Date("2026-08-18T01:00:00Z");
    const registration = await registerAccount(db, {
      email,
      displayName: "탈퇴예정",
      password: "secure-password-123",
      now,
    });
    await verifyEmailToken(db, { token: registration.token, now: new Date("2026-08-18T01:01:00Z") });
    const placeId = `withdraw-place-${suffix}`;
    await env.DB.prepare(
      `INSERT INTO places
       (id, slug, name, status, address, neighborhood, latitude, longitude,
        search_text, created_at, updated_at)
       VALUES (?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      placeId,
      `withdraw-place-${suffix}`,
      "탈퇴 투표 장소",
      "광주광역시 동구",
      "동명동",
      35.149,
      126.9232,
      "탈퇴 투표 장소 동명동",
      "2026-08-18T01:00:00Z",
      "2026-08-18T01:00:00Z",
    ).run();
    await db.insert(authIdentities).values({
      id: crypto.randomUUID(),
      userId: registration.userId,
      provider: "GOOGLE",
      providerSubject: `google-${suffix}`,
      providerEmail: email,
      createdAt: "2026-08-18T01:01:00.000Z",
      updatedAt: "2026-08-18T01:01:00.000Z",
    });
    await db.insert(sessions).values({
      id: crypto.randomUUID(),
      userId: registration.userId,
      createdAt: "2026-08-18T01:01:00.000Z",
      expiresAt: "2026-08-25T01:01:00.000Z",
    });
    await db.insert(savedPlaces).values({
      userId: registration.userId,
      placeId,
      createdAt: "2026-08-18T01:01:00.000Z",
    });
    await db.insert(reviewerApplications).values({
      id: crypto.randomUUID(),
      userId: registration.userId,
      statement: "실명 소개",
      occupation: "기자",
      tasteDirection: "매운맛",
      regionCode: "GWANGJU",
      specialtySlugs: "[]",
      createdAt: "2026-08-18T01:01:00.000Z",
      updatedAt: "2026-08-18T01:01:00.000Z",
    });
    await db.insert(reviewerProfiles).values({
      userId: registration.userId,
      slug: `reviewer-${suffix}`,
      status: "ACTIVE",
      occupation: "기자",
      tasteDirection: "매운맛",
      regionCode: "GWANGJU",
      specialtySlugs: "[]",
      lastActivityAt: "2026-08-18T01:01:00.000Z",
      approvedAt: "2026-08-18T01:01:00.000Z",
      createdAt: "2026-08-18T01:01:00.000Z",
      updatedAt: "2026-08-18T01:01:00.000Z",
    });
    await castVote(db, {
      placeId,
      userId: registration.userId,
      value: 1,
      now: "2026-08-18T01:02:00.000Z",
      eventId: `withdraw-vote-${suffix}`,
    });

    await withdrawAccount(db, { userId: registration.userId, now: new Date("2026-08-18T01:03:00Z") });

    const user = await db.query.users.findFirst({ where: eq(users.id, registration.userId) });
    expect(user).toMatchObject({
      email: withdrawnEmailFor(registration.userId),
      displayName: WITHDRAWN_DISPLAY_NAME,
      passwordHash: null,
      passwordSalt: null,
      emailVerifiedAt: null,
    });
    expect(await db.select().from(sessions).where(eq(sessions.userId, registration.userId))).toHaveLength(0);
    expect(await db.select().from(authIdentities).where(eq(authIdentities.userId, registration.userId))).toHaveLength(0);
    expect(await db.select().from(savedPlaces).where(eq(savedPlaces.userId, registration.userId))).toHaveLength(0);
    const application = await db.query.reviewerApplications.findFirst({ where: eq(reviewerApplications.userId, registration.userId) });
    expect(application).toMatchObject({ statement: "-", occupation: "-", tasteDirection: "-" });
    const profile = await db.query.reviewerProfiles.findFirst({ where: eq(reviewerProfiles.userId, registration.userId) });
    expect(profile).toMatchObject({
      slug: `withdrawn-${registration.userId}`,
      status: "SUSPENDED",
      occupation: "-",
      statusReason: "WITHDRAWN",
    });
    expect(await db.select().from(voteEvents).where(eq(voteEvents.userId, registration.userId))).toHaveLength(1);
    await expect(authenticateAccount(db, { email, password: "secure-password-123" })).rejects.toThrow("LOGIN_INVALID");
    expect(await requestPasswordReset(db, { email, now: new Date("2026-08-18T01:04:00Z") })).toBeNull();
    await expect(registerAccount(db, {
      email: withdrawnEmailFor(registration.userId),
      displayName: "재가입시도",
      password: "secure-password-123",
      now: new Date("2026-08-18T01:05:00Z"),
    })).rejects.toThrow("EMAIL_INVALID");
    const reregistered = await registerAccount(db, {
      email,
      displayName: "재가입",
      password: "secure-password-123",
      now: new Date("2026-08-18T01:06:00Z"),
    });
    expect(reregistered.userId).not.toBe(registration.userId);
    await expect(withdrawAccount(db, { userId: registration.userId, now: new Date("2026-08-18T01:07:00Z") })).rejects.toThrow("ACCOUNT_ALREADY_WITHDRAWN");
  });

  it("refuses admin withdrawal", async () => {
    const db = createDb(env.DB);
    const email = `admin-withdraw-${crypto.randomUUID()}@example.com`;
    const now = new Date("2026-08-18T02:00:00Z");
    const registration = await registerAccount(db, {
      email,
      displayName: "관리자",
      password: "secure-password-123",
      adminEmail: email,
      now,
    });
    await verifyEmailToken(db, { token: registration.token, now: new Date("2026-08-18T02:01:00Z") });
    await expect(withdrawAccount(db, { userId: registration.userId, now: new Date("2026-08-18T02:02:00Z") })).rejects.toThrow("WITHDRAW_ADMIN_FORBIDDEN");
    const user = await db.query.users.findFirst({ where: eq(users.id, registration.userId) });
    expect(user?.email).toBe(email);
  });
});
