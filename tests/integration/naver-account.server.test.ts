import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { authIdentities, users } from "../../app/db/schema";
import {
  connectNaverIdentity,
  disconnectNaverIdentity,
  resolveNaverLogin,
} from "../../app/features/auth/naver-account.server";

const now = new Date("2026-08-09T00:00:00.000Z");

async function insertUser(input: {
  id: string;
  email: string;
  password?: boolean;
}) {
  const db = createDb(env.DB);
  await db.insert(users).values({
    id: input.id,
    email: input.email,
    displayName: "기존 회원",
    role: "USER",
    passwordHash: input.password === false ? null : "hash",
    passwordSalt: input.password === false ? null : "salt",
    emailVerifiedAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  return db;
}

describe("Naver account policy", () => {
  it("creates a verified passwordless user and reuses the linked subject", async () => {
    const db = createDb(env.DB);
    const key = crypto.randomUUID();
    const input = {
      providerSubject: `naver-${key}`,
      email: `Naver-${key}@Example.com`,
      displayName: "네이버 회원",
      adminEmail: env.ADMIN_EMAIL,
      now,
    };
    const created = await resolveNaverLogin(db, input);
    const repeated = await resolveNaverLogin(db, {
      ...input,
      email: `changed-${key}@example.com`,
    });

    expect(created).toMatchObject({
      email: `naver-${key}@example.com`,
      displayName: "네이버 회원",
      isNewUser: true,
    });
    expect(repeated).toMatchObject({ userId: created.userId, isNewUser: false });
  });

  it("never auto-links a logged-out Naver identity by matching email", async () => {
    const key = crypto.randomUUID();
    const email = `existing-${key}@example.com`;
    const db = await insertUser({ id: `user-${key}`, email });

    await expect(
      resolveNaverLogin(db, {
        providerSubject: `naver-${key}`,
        email: email.toUpperCase(),
        displayName: "네이버 이름",
        now,
      }),
    ).rejects.toThrow("NAVER_EXISTING_ACCOUNT_LOGIN_REQUIRED");
  });

  it("connects only to the authenticated user and rejects a subject owned elsewhere", async () => {
    const key = crypto.randomUUID();
    const firstId = `first-${key}`;
    const secondId = `second-${key}`;
    const db = await insertUser({ id: firstId, email: `first-${key}@example.com` });
    await insertUser({ id: secondId, email: `second-${key}@example.com` });

    await connectNaverIdentity(db, {
      userId: firstId,
      providerSubject: `subject-${key}`,
      email: `naver-${key}@example.com`,
      now,
    });
    await expect(
      connectNaverIdentity(db, {
        userId: secondId,
        providerSubject: `subject-${key}`,
        email: `other-${key}@example.com`,
        now,
      }),
    ).rejects.toThrow("NAVER_IDENTITY_CONFLICT");
  });

  it("keeps the identity when revocation fails and deletes it after success", async () => {
    const key = crypto.randomUUID();
    const userId = `disconnect-${key}`;
    const subject = `subject-${key}`;
    const db = await insertUser({ id: userId, email: `disconnect-${key}@example.com` });
    await connectNaverIdentity(db, {
      userId,
      providerSubject: subject,
      email: `naver-${key}@example.com`,
      now,
    });

    await expect(
      disconnectNaverIdentity(db, {
        userId,
        providerSubject: subject,
        revoke: async () => {
          throw new Error("NAVER_REVOCATION_FAILED");
        },
      }),
    ).rejects.toThrow("NAVER_REVOCATION_FAILED");
    expect(
      await db.query.authIdentities.findFirst({
        where: and(
          eq(authIdentities.userId, userId),
          eq(authIdentities.provider, "NAVER"),
        ),
      }),
    ).toBeDefined();

    const revoke = vi.fn(async () => undefined);
    await disconnectNaverIdentity(db, { userId, providerSubject: subject, revoke });
    expect(revoke).toHaveBeenCalledOnce();
    expect(
      await db.query.authIdentities.findFirst({
        where: and(
          eq(authIdentities.userId, userId),
          eq(authIdentities.provider, "NAVER"),
        ),
      }),
    ).toBeUndefined();
  });

  it("blocks disconnect when Naver is the last login method", async () => {
    const key = crypto.randomUUID();
    const userId = `only-${key}`;
    const subject = `subject-${key}`;
    const db = await insertUser({
      id: userId,
      email: `only-${key}@example.com`,
      password: false,
    });
    await connectNaverIdentity(db, {
      userId,
      providerSubject: subject,
      email: `only-${key}@example.com`,
      now,
    });

    await expect(
      disconnectNaverIdentity(db, {
        userId,
        providerSubject: subject,
        revoke: async () => undefined,
      }),
    ).rejects.toThrow("NAVER_LAST_LOGIN_METHOD");
  });
});
