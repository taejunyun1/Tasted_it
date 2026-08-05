import { and, eq, gt, isNull } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { accountTokens, users } from "../../db/schema";
import { hashPassword, verifyPassword } from "./password.server";

const TOKEN_TTL_MS = 30 * 60 * 1000;
const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenHash(token: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function issueToken(db: AppDb, userId: string, purpose: "VERIFY_EMAIL" | "RESET_PASSWORD", now: Date) {
  const token = newToken();
  await db.insert(accountTokens).values({
    id: crypto.randomUUID(), userId, tokenHash: await tokenHash(token), purpose,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(), consumedAt: null, createdAt: now.toISOString(),
  });
  return { token };
}

export async function registerAccount(db: AppDb, input: { email: string; displayName: string; password: string; adminEmail?: string; now: Date }) {
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("EMAIL_INVALID");
  if (input.displayName.trim().length < 2) throw new Error("DISPLAY_NAME_INVALID");
  if (input.password.length < 10) throw new Error("PASSWORD_TOO_SHORT");
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing?.emailVerifiedAt) throw new Error("ACCOUNT_EXISTS");
  const password = await hashPassword(input.password);
  const userId = existing?.id ?? crypto.randomUUID();
  const values = { displayName: input.displayName.trim(), role: input.adminEmail?.trim().toLowerCase() === email ? "ADMIN" as const : "USER" as const, passwordHash: password.hash, passwordSalt: password.salt, emailVerifiedAt: null, updatedAt: input.now.toISOString() };
  if (existing) await db.update(users).set(values).where(eq(users.id, existing.id));
  else await db.insert(users).values({ id: userId, email, ...values, createdAt: input.now.toISOString() });
  return { userId, email, ...(await issueToken(db, userId, "VERIFY_EMAIL", input.now)) };
}

async function consumeToken(db: AppDb, token: string, purpose: "VERIFY_EMAIL" | "RESET_PASSWORD", now: Date) {
  const row = await db.query.accountTokens.findFirst({
    where: and(eq(accountTokens.tokenHash, await tokenHash(token)), eq(accountTokens.purpose, purpose), isNull(accountTokens.consumedAt), gt(accountTokens.expiresAt, now.toISOString())),
  });
  if (!row) throw new Error("TOKEN_INVALID");
  await db.update(accountTokens).set({ consumedAt: now.toISOString() }).where(and(eq(accountTokens.id, row.id), isNull(accountTokens.consumedAt)));
  return row.userId;
}

export async function verifyEmailToken(db: AppDb, input: { token: string; now: Date }) {
  const userId = await consumeToken(db, input.token, "VERIFY_EMAIL", input.now);
  await db.update(users).set({ emailVerifiedAt: input.now.toISOString(), updatedAt: input.now.toISOString() }).where(eq(users.id, userId));
  return { userId };
}

export async function authenticateAccount(db: AppDb, input: { email: string; password: string }) {
  const user = await db.query.users.findFirst({ where: eq(users.email, input.email.trim().toLowerCase()) });
  if (!user?.passwordHash || !user.passwordSalt || !(await verifyPassword(input.password, user.passwordHash, user.passwordSalt))) throw new Error("LOGIN_INVALID");
  if (!user.emailVerifiedAt) throw new Error("EMAIL_NOT_VERIFIED");
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

export async function requestPasswordReset(db: AppDb, input: { email: string; now: Date }) {
  const user = await db.query.users.findFirst({ where: eq(users.email, input.email.trim().toLowerCase()) });
  if (!user?.emailVerifiedAt) return null;
  return { userId: user.id, email: user.email, ...(await issueToken(db, user.id, "RESET_PASSWORD", input.now)) };
}

export async function resetPassword(db: AppDb, input: { token: string; password: string; now: Date }) {
  if (input.password.length < 10) throw new Error("PASSWORD_TOO_SHORT");
  const userId = await consumeToken(db, input.token, "RESET_PASSWORD", input.now);
  const password = await hashPassword(input.password);
  await db.update(users).set({ passwordHash: password.hash, passwordSalt: password.salt, updatedAt: input.now.toISOString() }).where(eq(users.id, userId));
  return { userId };
}
