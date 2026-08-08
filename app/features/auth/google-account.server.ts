import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { authIdentities, users } from "../../db/schema";
import type { UserRole } from "./guards.server";

export interface GoogleAccountInput {
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  adminEmail?: string;
  now: Date;
}

export interface GoogleAccountResult {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  isNewUser: boolean;
}

function accountResult(
  user: typeof users.$inferSelect,
  isNewUser: boolean,
): GoogleAccountResult {
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isNewUser,
  };
}

async function findLinkedUser(db: AppDb, providerSubject: string) {
  const identity = await db.query.authIdentities.findFirst({
    where: and(
      eq(authIdentities.provider, "GOOGLE"),
      eq(authIdentities.providerSubject, providerSubject),
    ),
  });
  if (!identity) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, identity.userId),
  });
  if (!user) throw new Error("GOOGLE_IDENTITY_CONFLICT");
  return user;
}

async function createGoogleUser(
  db: AppDb,
  input: GoogleAccountInput,
  email: string,
) {
  const id = crypto.randomUUID();
  const timestamp = input.now.toISOString();
  const displayName =
    input.displayName.trim().slice(0, 40) || email.split("@")[0];
  const role =
    input.adminEmail?.trim().toLowerCase() === email ? "ADMIN" : "USER";

  await db.insert(users).values({
    id,
    email,
    displayName,
    role,
    passwordHash: null,
    passwordSalt: null,
    emailVerifiedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const created = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!created) throw new Error("GOOGLE_ACCOUNT_CREATE_FAILED");
  return created;
}

async function linkGoogleIdentity(
  db: AppDb,
  userId: string,
  input: GoogleAccountInput,
  email: string,
) {
  const timestamp = input.now.toISOString();
  await db.insert(authIdentities).values({
    id: crypto.randomUUID(),
    userId,
    provider: "GOOGLE",
    providerSubject: input.providerSubject,
    providerEmail: email,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function resolveGoogleAccount(
  db: AppDb,
  input: GoogleAccountInput,
): Promise<GoogleAccountResult> {
  if (!input.emailVerified) throw new Error("GOOGLE_EMAIL_UNVERIFIED");
  if (!input.providerSubject.trim()) throw new Error("GOOGLE_SUBJECT_INVALID");

  const linked = await findLinkedUser(db, input.providerSubject);
  if (linked) return accountResult(linked, false);

  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("GOOGLE_EMAIL_INVALID");

  let user = await db.query.users.findFirst({ where: eq(users.email, email) });
  let isNewUser = false;

  if (!user) {
    try {
      user = await createGoogleUser(db, input, email);
      isNewUser = true;
    } catch {
      user = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (!user) throw new Error("GOOGLE_ACCOUNT_CREATE_FAILED");
    }
  }

  try {
    await linkGoogleIdentity(db, user.id, input, email);
  } catch {
    const racedUser = await findLinkedUser(db, input.providerSubject);
    if (!racedUser || racedUser.id !== user.id) {
      throw new Error("GOOGLE_IDENTITY_CONFLICT");
    }
    isNewUser = false;
  }

  return accountResult(user, isNewUser);
}
