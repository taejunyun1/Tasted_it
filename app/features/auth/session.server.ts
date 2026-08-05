import { env } from "cloudflare:workers";
import { and, eq, gt } from "drizzle-orm";
import { redirect } from "react-router";

import { createDb } from "../../db/client.server";
import { sessions, users } from "../../db/schema";
import { assertRole, type UserRole } from "./guards.server";

const SESSION_COOKIE = "retaste_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;

  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }

  return null;
}

function sessionCookie(id: string, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(id)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

function expiredSessionCookie(secure: boolean) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export async function getOptionalUser(
  request: Request,
): Promise<SessionUser | null> {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;

  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const [result] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1);

  return result ?? null;
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getOptionalUser(request);
  if (user) return user;

  const url = new URL(request.url);
  const returnTo = `${url.pathname}${url.search}`;
  throw redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export async function requireAdmin(request: Request): Promise<SessionUser> {
  const user = await requireUser(request);
  assertRole(user.role, ["ADMIN"]);
  return user;
}

export async function createUserSession(input: {
  userId: string;
  now: Date;
  requestUrl: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(
    input.now.getTime() + SESSION_TTL_SECONDS * 1000,
  ).toISOString();
  const db = createDb(env.DB);

  await db.insert(sessions).values({
    id,
    userId: input.userId,
    createdAt: input.now.toISOString(),
    expiresAt,
  });

  const secure = new URL(input.requestUrl).protocol === "https:";
  return sessionCookie(id, secure);
}

export async function destroyUserSession(request: Request) {
  const id = readCookie(request, SESSION_COOKIE);
  if (id) await createDb(env.DB).delete(sessions).where(eq(sessions.id, id));
  return expiredSessionCookie(new URL(request.url).protocol === "https:");
}
