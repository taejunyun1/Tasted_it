import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { authIdentities, users } from "../../app/db/schema";
import { resolveGoogleAccount } from "../../app/features/auth/google-account.server";

const now = new Date("2026-08-08T15:00:00.000Z");

describe("resolveGoogleAccount", () => {
  it("creates one passwordless verified user and reuses it by Google subject", async () => {
    const db = createDb(env.DB);
    const key = crypto.randomUUID();
    const input = {
      providerSubject: `sub-${key}`,
      email: `Google-${key}@Example.com`,
      emailVerified: true,
      displayName: "구글 사용자",
      adminEmail: env.ADMIN_EMAIL,
      now,
    };

    const created = await resolveGoogleAccount(db, input);
    const repeated = await resolveGoogleAccount(db, {
      ...input,
      email: `changed-${key}@example.com`,
      displayName: "변경된 이름",
    });

    expect(created).toMatchObject({
      email: `google-${key}@example.com`,
      displayName: "구글 사용자",
      role: "USER",
      isNewUser: true,
    });
    expect(repeated).toMatchObject({
      userId: created.userId,
      email: created.email,
      displayName: "구글 사용자",
      isNewUser: false,
    });

    const stored = await db.query.users.findFirst({
      where: eq(users.id, created.userId),
    });
    expect(stored).toMatchObject({
      passwordHash: null,
      passwordSalt: null,
      emailVerifiedAt: now.toISOString(),
    });

    const identities = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, created.userId));
    expect(identities).toHaveLength(1);
  });

  it("links a verified Google subject to an existing email without changing the account", async () => {
    const db = createDb(env.DB);
    const key = crypto.randomUUID();
    const userId = `existing-${key}`;
    const email = `existing-${key}@example.com`;
    await db.insert(users).values({
      id: userId,
      email,
      displayName: "기존 이름",
      role: "REVIEWER",
      passwordHash: "existing-hash",
      passwordSalt: "existing-salt",
      emailVerifiedAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const result = await resolveGoogleAccount(db, {
      providerSubject: `sub-${key}`,
      email: email.toUpperCase(),
      emailVerified: true,
      displayName: "Google 이름",
      adminEmail: env.ADMIN_EMAIL,
      now,
    });

    expect(result).toMatchObject({
      userId,
      displayName: "기존 이름",
      role: "REVIEWER",
      isNewUser: false,
    });
    const stored = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(stored).toMatchObject({
      passwordHash: "existing-hash",
      passwordSalt: "existing-salt",
      displayName: "기존 이름",
      role: "REVIEWER",
    });
  });

  it("assigns ADMIN only when a new Google account matches ADMIN_EMAIL", async () => {
    const db = createDb(env.DB);
    const result = await resolveGoogleAccount(db, {
      providerSubject: `admin-sub-${crypto.randomUUID()}`,
      email: env.ADMIN_EMAIL.toUpperCase(),
      emailVerified: true,
      displayName: "운영자",
      adminEmail: env.ADMIN_EMAIL,
      now,
    });

    expect(result.role).toBe("ADMIN");
  });

  it("rejects Google accounts whose email is not verified", async () => {
    const db = createDb(env.DB);
    await expect(
      resolveGoogleAccount(db, {
        providerSubject: `unverified-${crypto.randomUUID()}`,
        email: "unverified@example.com",
        emailVerified: false,
        displayName: "미인증 사용자",
        adminEmail: env.ADMIN_EMAIL,
        now,
      }),
    ).rejects.toThrow("GOOGLE_EMAIL_UNVERIFIED");
  });
});
