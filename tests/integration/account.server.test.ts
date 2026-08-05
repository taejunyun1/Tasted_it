import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { authenticateAccount, registerAccount, requestPasswordReset, resetPassword, verifyEmailToken } from "../../app/features/auth/account.server";

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
});
