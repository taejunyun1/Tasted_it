import { and, eq, lt, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { rateLimitWindows } from "../../db/schema";

export const MAIL_RATE_LIMIT = {
  emailMax: 3,
  ipMax: 10,
  windowMs: 60 * 60 * 1000,
} as const;

export const MAIL_RATE_LIMIT_MESSAGE = "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";

export type MailRateLimitRoute = "SIGNUP" | "RESET_PASSWORD" | "PLACE_CORRECTION";
export type AuthRateLimitRoute = MailRateLimitRoute | "LOGIN";

export const LOGIN_RATE_LIMIT = {
  emailMax: 8,
  ipMax: 20,
  windowMs: 15 * 60 * 1000,
} as const;

export type MailRateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export function mailRateLimitWindowStart(now: Date, windowMs = MAIL_RATE_LIMIT.windowMs): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export function mailRateLimitRetryAfterSeconds(now: Date, windowMs = MAIL_RATE_LIMIT.windowMs): number {
  const start = mailRateLimitWindowStart(now, windowMs).getTime();
  return Math.max(1, Math.ceil((start + windowMs - now.getTime()) / 1000));
}

export async function hashMailRateLimitBucket(
  kind: "email" | "ip",
  route: AuthRateLimitRoute,
  value: string,
): Promise<string> {
  const normalized = kind === "email" ? value.trim().toLowerCase() : value.trim();
  const family = route === "LOGIN" ? "auth-rate-limit" : "mail-rate-limit";
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${family}:${kind}:${route}:${normalized}`),
  );
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function incrementWindow(db: AppDb, bucketHash: string, windowStartedAt: string): Promise<number> {
  await db.insert(rateLimitWindows).values({
    bucketHash,
    windowStartedAt,
    attemptCount: 1,
  }).onConflictDoUpdate({
    target: [rateLimitWindows.bucketHash, rateLimitWindows.windowStartedAt],
    set: { attemptCount: sql`${rateLimitWindows.attemptCount} + 1` },
  });

  const row = await db.query.rateLimitWindows.findFirst({
    where: and(
      eq(rateLimitWindows.bucketHash, bucketHash),
      eq(rateLimitWindows.windowStartedAt, windowStartedAt),
    ),
  });
  return row?.attemptCount ?? 1;
}

export async function consumeMailRateLimit(db: AppDb, input: {
  route: MailRateLimitRoute;
  email: string;
  ip?: string | null;
  now: Date;
}): Promise<MailRateLimitResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: true };

  const windowStartedAt = mailRateLimitWindowStart(input.now).toISOString();
  await db.delete(rateLimitWindows).where(lt(rateLimitWindows.windowStartedAt, windowStartedAt));

  const emailCount = await incrementWindow(
    db,
    await hashMailRateLimitBucket("email", input.route, email),
    windowStartedAt,
  );
  if (emailCount > MAIL_RATE_LIMIT.emailMax) {
    return { ok: false, retryAfterSeconds: mailRateLimitRetryAfterSeconds(input.now) };
  }

  const ip = input.ip?.trim() ?? "";
  if (ip) {
    const ipCount = await incrementWindow(
      db,
      await hashMailRateLimitBucket("ip", input.route, ip),
      windowStartedAt,
    );
    if (ipCount > MAIL_RATE_LIMIT.ipMax) {
      return { ok: false, retryAfterSeconds: mailRateLimitRetryAfterSeconds(input.now) };
    }
  }

  return { ok: true };
}

export async function consumeLoginRateLimit(db: AppDb, input: {
  email: string;
  ip?: string | null;
  now: Date;
}): Promise<MailRateLimitResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: true };

  const windowStartedAt = mailRateLimitWindowStart(input.now, LOGIN_RATE_LIMIT.windowMs).toISOString();
  await db.delete(rateLimitWindows).where(lt(rateLimitWindows.windowStartedAt, windowStartedAt));

  const emailCount = await incrementWindow(
    db,
    await hashMailRateLimitBucket("email", "LOGIN", email),
    windowStartedAt,
  );
  if (emailCount > LOGIN_RATE_LIMIT.emailMax) {
    return { ok: false, retryAfterSeconds: mailRateLimitRetryAfterSeconds(input.now, LOGIN_RATE_LIMIT.windowMs) };
  }

  const ip = input.ip?.trim() ?? "";
  if (ip) {
    const ipCount = await incrementWindow(
      db,
      await hashMailRateLimitBucket("ip", "LOGIN", ip),
      windowStartedAt,
    );
    if (ipCount > LOGIN_RATE_LIMIT.ipMax) {
      return { ok: false, retryAfterSeconds: mailRateLimitRetryAfterSeconds(input.now, LOGIN_RATE_LIMIT.windowMs) };
    }
  }

  return { ok: true };
}
