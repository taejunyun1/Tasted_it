import { and, eq, ne } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { authIdentities, users } from "../../db/schema";
import type { UserRole } from "./guards.server";

export interface NaverAccountInput {
  providerSubject: string;
  email: string;
  displayName: string;
  adminEmail?: string;
  now: Date;
}

export interface NaverAccountResult {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  isNewUser: boolean;
}

function result(
  user: typeof users.$inferSelect,
  isNewUser: boolean,
): NaverAccountResult {
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isNewUser,
  };
}

async function linkedUser(db: AppDb, subject: string) {
  const identity = await db.query.authIdentities.findFirst({
    where: and(
      eq(authIdentities.provider, "NAVER"),
      eq(authIdentities.providerSubject, subject),
    ),
  });
  if (!identity) return null;
  const user = await db.query.users.findFirst({
    where: eq(users.id, identity.userId),
  });
  if (!user) throw new Error("NAVER_IDENTITY_CONFLICT");
  return user;
}

export async function resolveNaverLogin(
  db: AppDb,
  input: NaverAccountInput,
): Promise<NaverAccountResult> {
  const subject = input.providerSubject.trim();
  if (!subject) throw new Error("NAVER_SUBJECT_INVALID");

  const linked = await linkedUser(db, subject);
  if (linked) return result(linked, false);

  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("NAVER_EMAIL_REQUIRED");
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) throw new Error("NAVER_EXISTING_ACCOUNT_LOGIN_REQUIRED");

  const id = crypto.randomUUID();
  const timestamp = input.now.toISOString();
  const displayName = input.displayName.trim().slice(0, 40) || "네이버 회원";
  const role =
    input.adminEmail?.trim().toLowerCase() === email ? "ADMIN" : "USER";
  try {
    await db.batch([
      db.insert(users).values({
        id,
        email,
        displayName,
        role,
        passwordHash: null,
        passwordSalt: null,
        emailVerifiedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      db.insert(authIdentities).values({
        id: crypto.randomUUID(),
        userId: id,
        provider: "NAVER",
        providerSubject: subject,
        providerEmail: email,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ]);
  } catch {
    const raced = await linkedUser(db, subject);
    if (raced) return result(raced, false);
    if (await db.query.users.findFirst({ where: eq(users.email, email) })) {
      throw new Error("NAVER_EXISTING_ACCOUNT_LOGIN_REQUIRED");
    }
    throw new Error("NAVER_ACCOUNT_CREATE_FAILED");
  }

  const created = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!created) throw new Error("NAVER_ACCOUNT_CREATE_FAILED");
  return result(created, true);
}

export async function connectNaverIdentity(
  db: AppDb,
  input: {
    userId: string;
    providerSubject: string;
    email: string;
    now: Date;
  },
) {
  const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
  if (!user) throw new Error("NAVER_CONNECT_USER_INVALID");

  const subjectOwner = await linkedUser(db, input.providerSubject);
  if (subjectOwner && subjectOwner.id !== input.userId) {
    throw new Error("NAVER_IDENTITY_CONFLICT");
  }
  const current = await db.query.authIdentities.findFirst({
    where: and(
      eq(authIdentities.provider, "NAVER"),
      eq(authIdentities.userId, input.userId),
    ),
  });
  if (current) {
    if (current.providerSubject !== input.providerSubject) {
      throw new Error("NAVER_IDENTITY_CONFLICT");
    }
    return;
  }

  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("NAVER_EMAIL_REQUIRED");
  const timestamp = input.now.toISOString();
  try {
    await db.insert(authIdentities).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      provider: "NAVER",
      providerSubject: input.providerSubject,
      providerEmail: email,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } catch {
    throw new Error("NAVER_IDENTITY_CONFLICT");
  }
}

export async function disconnectNaverIdentity(
  db: AppDb,
  input: {
    userId: string;
    providerSubject: string;
    revoke: () => Promise<void>;
  },
) {
  const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
  if (!user) throw new Error("NAVER_CONNECT_USER_INVALID");
  const identity = await db.query.authIdentities.findFirst({
    where: and(
      eq(authIdentities.provider, "NAVER"),
      eq(authIdentities.userId, input.userId),
      eq(authIdentities.providerSubject, input.providerSubject),
    ),
  });
  if (!identity) throw new Error("NAVER_IDENTITY_CONFLICT");

  const otherIdentity = await db.query.authIdentities.findFirst({
    where: and(
      eq(authIdentities.userId, input.userId),
      ne(authIdentities.provider, "NAVER"),
    ),
  });
  if (!user.passwordHash && !otherIdentity) {
    throw new Error("NAVER_LAST_LOGIN_METHOD");
  }

  await input.revoke();
  await db
    .delete(authIdentities)
    .where(eq(authIdentities.id, identity.id));
}
