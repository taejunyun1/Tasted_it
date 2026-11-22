import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  completeGoogleLogin: vi.fn(),
  completeNaverFlow: vi.fn(),
  consumeGoogleOAuthRequest: vi.fn(),
  consumeOAuthRequest: vi.fn(),
  peekOAuthRequestContext: vi.fn(),
  sendGoogleWelcomeIfNeeded: vi.fn(),
}));

vi.mock("cloudflare:workers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cloudflare:workers")>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, property, receiver) {
        if (property === "GOOGLE_CLIENT_ID") return "test-google-client";
        if (property === "GOOGLE_CLIENT_SECRET") return "test-google-secret";
        if (property === "NAVER_LOGIN_CLIENT_ID") return "test-naver-client";
        if (property === "NAVER_LOGIN_CLIENT_SECRET") return "test-naver-secret";
        return Reflect.get(target, property, receiver);
      },
    }),
  };
});

vi.mock("react/jsx-runtime", () => ({
  Fragment: Symbol("Fragment"),
  jsx: () => null,
  jsxs: () => null,
}));
vi.mock("react/jsx-dev-runtime", () => ({
  Fragment: Symbol("Fragment"),
  jsxDEV: () => null,
}));

vi.mock("react-router", () => ({
  Form: () => null,
  Link: () => null,
  data: (value: unknown, init?: ResponseInit) => ({ data: value, init }),
  redirect: (location: string, init?: ResponseInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Location", location);
    return new Response(null, { status: 302, headers });
  },
}));

vi.mock("../../app/features/auth/email.server", () => ({
  sendGoogleWelcomeIfNeeded: routeMocks.sendGoogleWelcomeIfNeeded,
}));
vi.mock("../../app/features/auth/google-login.server", () => ({
  completeGoogleLogin: routeMocks.completeGoogleLogin,
  oauthFailureCode: () => "temporarily_unavailable",
}));
vi.mock("../../app/features/auth/google-oauth-request.server", () => ({
  consumeGoogleOAuthRequest: routeMocks.consumeGoogleOAuthRequest,
}));
vi.mock("../../app/features/auth/naver-login.server", () => ({
  completeNaverFlow: routeMocks.completeNaverFlow,
  naverFailureCode: () => "temporarily_unavailable",
}));
vi.mock("../../app/features/auth/oauth-request.server", () => ({
  consumeOAuthRequest: routeMocks.consumeOAuthRequest,
  peekOAuthRequestContext: routeMocks.peekOAuthRequestContext,
}));

import { createDb, type AppDb } from "../../app/db/client.server";
import { hashPassword } from "../../app/features/auth/password.server";
import {
  guestTasteBadges,
  guestTasteSessions,
  productEvents,
  sessions,
  tasteBadges,
  userTasteBadges,
  users,
} from "../../app/db/schema";
import {
  appendGuestTasteMergeCookie,
  mergeGuestTasteSessionFromRequest,
} from "../../app/features/onboarding/guest-merge.server";
import { saveGuestOnboarding } from "../../app/features/onboarding/guest-session.server";

const CREATED_AT = "2026-08-10T00:00:00.000Z";
const MERGED_AT = "2026-08-10T00:10:00.000Z";

async function seedUser(db: AppDb, id = `member-${crypto.randomUUID()}`) {
  await db.insert(users).values({
    id,
    email: `${id}@example.com`,
    displayName: "병합 테스트 사용자",
    role: "USER",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
  return id;
}

async function seedGuestTaste(
  db: AppDb,
  badgeIds: string[],
  input: { id?: string; expiresAt?: string; mergedUserId?: string | null; completedAt?: string | null } = {},
) {
  const id = input.id ?? `guest-${crypto.randomUUID()}`;
  await db.insert(guestTasteSessions).values({
    id,
    locationMode: "DEFAULT",
    completedStepsJson: "[\"PREVIEW\"]",
    completedAt: input.completedAt === undefined ? CREATED_AT : input.completedAt,
    mergedUserId: input.mergedUserId ?? null,
    expiresAt: input.expiresAt ?? "2026-09-09T00:00:00.000Z",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
  if (badgeIds.length > 0) {
    await db.insert(guestTasteBadges).values(
      badgeIds.map((badgeId) => ({ sessionId: id, badgeId, selectedAt: CREATED_AT })),
    );
  }
  return id;
}

function guestRequest(sessionId?: string) {
  return new Request("https://retaste.test/login", {
    headers: sessionId ? { Cookie: `retaste_guest=${encodeURIComponent(sessionId)}` } : undefined,
  });
}

describe("mergeGuestTasteSessionFromRequest", () => {
  it("merges USER taste once and expires the guest cookie", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const guestId = await seedGuestTaste(db, ["food-gukbap", "style-old-school"]);
    const request = guestRequest(guestId);

    const first = await mergeGuestTasteSessionFromRequest(db, request, userId, MERGED_AT);
    const second = await mergeGuestTasteSessionFromRequest(
      db,
      request,
      userId,
      "2026-08-10T00:11:00.000Z",
    );

    expect(first).toMatchObject({ merged: true });
    expect(first.expireCookie).toContain("retaste_guest=");
    expect(first.expireCookie).toContain("Max-Age=0");
    expect(first.expireCookie).toContain("Secure");
    expect(second.merged).toBe(false);

    const rows = await db.select().from(userTasteBadges)
      .where(and(eq(userTasteBadges.userId, userId), eq(userTasteBadges.source, "USER")));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        badgeId: "food-gukbap",
        score: 0.8,
        evidenceJson: JSON.stringify({ source: "ONBOARDING", version: 1 }),
        createdAt: MERGED_AT,
        updatedAt: MERGED_AT,
      }),
      expect.objectContaining({ badgeId: "style-old-school", score: 0.8 }),
    ]));

    const [session] = await db.select().from(guestTasteSessions)
      .where(eq(guestTasteSessions.id, guestId));
    expect(session).toMatchObject({ mergedUserId: userId, updatedAt: MERGED_AT });
    await expect(db.select().from(productEvents).where(and(
      eq(productEvents.guestSessionId, guestId),
      eq(productEvents.eventName, "GUEST_CONVERTED"),
    ))).resolves.toEqual([
      expect.objectContaining({ guestSessionId: guestId, userId, metadataJson: "{}" }),
    ]);
  });

  it("emits one conversion event when concurrent merge attempts race", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const guestId = await seedGuestTaste(db, ["food-gukbap"]);
    const request = guestRequest(guestId);

    const results = await Promise.all([
      mergeGuestTasteSessionFromRequest(db, request, userId, MERGED_AT),
      mergeGuestTasteSessionFromRequest(db, request, userId, MERGED_AT),
      mergeGuestTasteSessionFromRequest(db, request, userId, MERGED_AT),
    ]);

    expect(results.filter((result) => result.merged)).toHaveLength(1);
    await expect(db.select().from(productEvents).where(and(
      eq(productEvents.guestSessionId, guestId),
      eq(productEvents.eventName, "GUEST_CONVERTED"),
    ))).resolves.toHaveLength(1);
  });

  it("keeps the successful merge and cookie expiry when conversion event storage fails", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const guestId = await seedGuestTaste(db, ["food-gukbap"]);
    const triggerName = `force_conversion_event_failure_${crypto.randomUUID().replaceAll("-", "")}`;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.DB.exec(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON product_events BEGIN SELECT RAISE(ABORT, 'member@example.com 35.1 name'); END`,
    );

    try {
      const headers = new Headers();
      await expect(appendGuestTasteMergeCookie({
        headers,
        db,
        request: guestRequest(guestId),
        userId,
        now: MERGED_AT,
      })).resolves.toBeUndefined();

      expect(setCookieText(headers)).toContain("retaste_guest=");
      expect(setCookieText(headers)).toContain("Max-Age=0");
      await expect(db.query.guestTasteSessions.findFirst({
        where: eq(guestTasteSessions.id, guestId),
      })).resolves.toMatchObject({ mergedUserId: userId });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("PRODUCT_EVENT_WRITE_FAILED");
    } finally {
      errorSpy.mockRestore();
      await env.DB.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
  });

  it("never lowers an existing USER score or overwrites another source", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const guestId = await seedGuestTaste(db, ["food-gukbap"]);
    await db.insert(userTasteBadges).values([
      {
        userId,
        badgeId: "food-gukbap",
        source: "USER",
        score: 0.95,
        evidenceJson: "{\"source\":\"PROFILE\"}",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        userId,
        badgeId: "food-gukbap",
        source: "GOOGLE",
        score: 0.7,
        evidenceJson: "{\"source\":\"GOOGLE\"}",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ]);

    await expect(mergeGuestTasteSessionFromRequest(db, guestRequest(guestId), userId, MERGED_AT))
      .resolves.toMatchObject({ merged: true });

    const rows = await db.select().from(userTasteBadges)
      .where(and(eq(userTasteBadges.userId, userId), eq(userTasteBadges.badgeId, "food-gukbap")));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "USER", score: 0.95, evidenceJson: "{\"source\":\"PROFILE\"}", updatedAt: CREATED_AT }),
      expect.objectContaining({ source: "GOOGLE", score: 0.7, evidenceJson: "{\"source\":\"GOOGLE\"}" }),
    ]));
  });

  it("copies only badge IDs in the onboarding catalog", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const unknownBadgeId = `food-unknown-${crypto.randomUUID()}`;
    await db.insert(tasteBadges).values({
      id: unknownBadgeId,
      category: "FOOD",
      label: `미등록 배지 ${crypto.randomUUID()}`,
      headlineNoun: "미등록",
      sortOrder: 999,
      isActive: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    const guestId = await seedGuestTaste(db, ["food-gukbap", unknownBadgeId]);

    await expect(mergeGuestTasteSessionFromRequest(db, guestRequest(guestId), userId, MERGED_AT))
      .resolves.toMatchObject({ merged: true });

    await expect(db.select({ badgeId: userTasteBadges.badgeId })
      .from(userTasteBadges)
      .where(and(eq(userTasteBadges.userId, userId), eq(userTasteBadges.source, "USER"))))
      .resolves.toEqual([{ badgeId: "food-gukbap" }]);
  });

  it("does not write without a cookie or for expired and already merged sessions", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const previousUserId = await seedUser(db);
    const expiredId = await seedGuestTaste(db, ["food-gukbap"], { expiresAt: MERGED_AT });
    const mergedId = await seedGuestTaste(db, ["style-old-school"], { mergedUserId: previousUserId });

    await expect(mergeGuestTasteSessionFromRequest(db, guestRequest(), userId, MERGED_AT))
      .resolves.toEqual({ merged: false, expireCookie: null });
    await expect(mergeGuestTasteSessionFromRequest(db, guestRequest(expiredId), userId, MERGED_AT))
      .resolves.toEqual({ merged: false, expireCookie: null });
    await expect(mergeGuestTasteSessionFromRequest(db, guestRequest(mergedId), userId, MERGED_AT))
      .resolves.toEqual({ merged: false, expireCookie: null });

    const userRows = await db.select().from(userTasteBadges).where(eq(userTasteBadges.userId, userId));
    expect(userRows).toEqual([]);
    const [expired, merged] = await Promise.all([
      db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, expiredId) }),
      db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, mergedId) }),
    ]);
    expect(expired).toMatchObject({ mergedUserId: null, updatedAt: CREATED_AT });
    expect(merged).toMatchObject({ mergedUserId: previousUserId, updatedAt: CREATED_AT });
  });

  it("rolls back the session marker when a taste upsert fails", async () => {
    const db = createDb(env.DB);
    const guestId = await seedGuestTaste(db, ["food-gukbap"]);
    const missingUserId = `missing-${crypto.randomUUID()}`;

    await expect(
      mergeGuestTasteSessionFromRequest(db, guestRequest(guestId), missingUserId, MERGED_AT),
    ).rejects.toThrow();

    const session = await db.query.guestTasteSessions.findFirst({
      where: eq(guestTasteSessions.id, guestId),
    });
    expect(session).toMatchObject({ mergedUserId: null, updatedAt: CREATED_AT });
    const rows = await db.select().from(userTasteBadges)
      .where(eq(userTasteBadges.userId, missingUserId));
    expect(rows).toEqual([]);
  });

  it("does not upsert taste if another merge wins before the atomic batch", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const winningUserId = await seedUser(db);
    const guestId = await seedGuestTaste(db, ["food-gukbap", "style-old-school"]);
    const racedDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "batch") {
          return async (...input: Parameters<AppDb["batch"]>) => {
            await target.update(guestTasteSessions).set({
              mergedUserId: winningUserId,
              updatedAt: "2026-08-10T00:09:59.000Z",
            }).where(eq(guestTasteSessions.id, guestId));
            return target.batch(...input);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as AppDb;

    await expect(mergeGuestTasteSessionFromRequest(racedDb, guestRequest(guestId), userId, MERGED_AT))
      .resolves.toEqual({ merged: false, expireCookie: null });

    const rows = await db.select().from(userTasteBadges).where(eq(userTasteBadges.userId, userId));
    expect(rows).toEqual([]);
    const session = await db.query.guestTasteSessions.findFirst({
      where: eq(guestTasteSessions.id, guestId),
    });
    expect(session).toMatchObject({ mergedUserId: winningUserId, updatedAt: "2026-08-10T00:09:59.000Z" });
  });

  it("merges the latest selection when a save replaces A with B before the merge batch", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const guestId = await seedGuestTaste(db, ["food-gukbap"], { completedAt: null });
    const racedDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "batch") {
          return async (...input: Parameters<AppDb["batch"]>) => {
            await saveGuestOnboarding(target, {
              sessionId: guestId,
              selectionEpoch: 0,
              expectedStep: "PREVIEW",
              step: "PREVIEW",
              selectionRevision: 1,
              locationMode: "DEFAULT",
              foodBadgeIds: ["food-ramen"],
              styleBadgeIds: [],
              now: "2026-08-10T00:09:59.000Z",
            });
            return target.batch(...input);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as AppDb;

    await expect(mergeGuestTasteSessionFromRequest(racedDb, guestRequest(guestId), userId, MERGED_AT))
      .resolves.toMatchObject({ merged: true });

    const rows = await db.select({ badgeId: userTasteBadges.badgeId })
      .from(userTasteBadges)
      .where(and(eq(userTasteBadges.userId, userId), eq(userTasteBadges.source, "USER")));
    expect(rows).toEqual([{ badgeId: "food-ramen" }]);
    await expect(saveGuestOnboarding(db, {
      sessionId: guestId,
      selectionEpoch: 0,
      expectedStep: "PREVIEW",
      step: "PREVIEW",
      selectionRevision: 2,
      locationMode: "DEFAULT",
      foodBadgeIds: ["food-gukbap"],
      styleBadgeIds: [],
      now: "2026-08-10T00:10:01.000Z",
    })).rejects.toThrow("GUEST_SESSION_UNAVAILABLE");
  });
});

function setCookieText(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  return getSetCookie ? getSetCookie.call(headers).join("\n") : headers.get("Set-Cookie") ?? "";
}

function setCookies(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (getSetCookie) return getSetCookie.call(headers);
  const combined = headers.get("Set-Cookie");
  return combined ? combined.split(/, (?=[^;,]+=)/) : [];
}

type LoginProvider = "email" | "google" | "naver";

async function executeLoginRoute(provider: LoginProvider, userId: string, guestId: string) {
  const email = `${userId}@example.com`;
  if (provider === "email") {
    const password = "test-password";
    const credential = await hashPassword(password);
    await createDb(env.DB).update(users).set({
      passwordHash: credential.hash, passwordSalt: credential.salt, emailVerifiedAt: CREATED_AT,
    }).where(eq(users.id, userId));
    const form = new FormData();
    form.set("email", email);
    form.set("password", password);
    form.set("returnTo", "/places");
    const { action } = await import("../../app/routes/login");
    return action({
      request: new Request("https://retaste.test/login", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestId}` },
        body: form,
      }),
    } as never) as Promise<Response>;
  }

  if (provider === "google") {
    routeMocks.completeGoogleLogin.mockResolvedValue({
      userId,
      email,
      displayName: "Google 사용자",
      role: "USER",
      isNewUser: false,
      returnTo: "/courses",
    });
    const { loader } = await import("../../app/routes/auth-google-callback");
    return loader({
      request: new Request("https://retaste.test/auth/google/callback?state=state-1&code=code-1", {
        headers: { Cookie: `retaste_oauth_request=request-1; retaste_guest=${guestId}` },
      }),
    } as never) as Promise<Response>;
  }

  routeMocks.peekOAuthRequestContext.mockResolvedValue({
    flow: "LOGIN",
    userId: null,
    returnTo: "/places",
  });
  routeMocks.completeNaverFlow.mockResolvedValue({
    flow: "LOGIN",
    userId,
    email,
    displayName: "Naver 사용자",
    role: "USER",
    isNewUser: false,
    returnTo: "/places",
  });
  const { loader } = await import("../../app/routes/auth-naver-callback");
  return loader({
    request: new Request("https://retaste.test/auth/naver/callback?state=state-1&code=code-1", {
      headers: { Cookie: `retaste_naver_oauth=request-1; retaste_guest=${guestId}` },
    }),
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MERGED_AT);
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.consumeGoogleOAuthRequest.mockResolvedValue(undefined);
  routeMocks.consumeOAuthRequest.mockResolvedValue(undefined);
  routeMocks.sendGoogleWelcomeIfNeeded.mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("authenticated session cookie composition", () => {
  it("preserves an OAuth cookie while appending member and guest-expiry cookies", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const guestId = await seedGuestTaste(db, ["food-gukbap"]);
    const headers = new Headers();
    headers.append("Set-Cookie", "retaste_oauth_request=; Path=/auth/google; HttpOnly; Max-Age=0");
    headers.append("Set-Cookie", "retaste_session=member-session; Path=/; HttpOnly; Max-Age=604800");

    await appendGuestTasteMergeCookie({
      headers,
      db,
      request: guestRequest(guestId),
      userId,
      now: MERGED_AT,
    });

    const cookies = setCookieText(headers);
    expect(cookies).toContain("retaste_oauth_request=");
    expect(cookies).toContain("retaste_session=");
    expect(cookies).toContain("retaste_guest=");
    expect(cookies).toContain("Max-Age=0");
  });

  it("keeps login and the guest cookie retryable when guest merging fails", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const guestId = await seedGuestTaste(db, ["food-gukbap"]);
    const triggerName = `force_guest_merge_failure_${crypto.randomUUID().replaceAll("-", "")}`;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.DB.exec(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON user_taste_badges BEGIN SELECT RAISE(ABORT, 'forced guest merge failure'); END`,
    );

    try {
      const headers = new Headers();
      headers.append("Set-Cookie", "retaste_naver_oauth=; Path=/auth/naver; HttpOnly; Max-Age=0");
      headers.append("Set-Cookie", "retaste_session=member-session; Path=/; HttpOnly; Max-Age=604800");
      await expect(appendGuestTasteMergeCookie({
        headers,
        db,
        request: guestRequest(guestId),
        userId,
        now: MERGED_AT,
      })).resolves.toBeUndefined();

      const cookies = setCookieText(headers);
      expect(cookies).toContain("retaste_naver_oauth=");
      expect(cookies).toContain("retaste_session=");
      expect(cookies).not.toContain("retaste_guest=");
      expect(errorSpy).toHaveBeenCalledWith("GUEST_TASTE_MERGE_FAILED");
      await expect(db.query.guestTasteSessions.findFirst({
        where: eq(guestTasteSessions.id, guestId),
      })).resolves.toMatchObject({ mergedUserId: null, updatedAt: CREATED_AT });
    } finally {
      errorSpy.mockRestore();
      await env.DB.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
  });

  it.each([
    ["email", null, "/places"],
    ["google", "retaste_oauth_request", "/courses"],
    ["naver", "retaste_naver_oauth", "/places"],
  ] as const)("executes %s login and preserves every successful response cookie", async (
    provider,
    oauthCookieName,
    expectedLocation,
  ) => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const guestId = await seedGuestTaste(db, ["food-gukbap"]);

    const response = await executeLoginRoute(provider, userId, guestId);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(expectedLocation);
    const cookies = setCookies(response.headers);
    expect(cookies.find((cookie) => cookie.startsWith("retaste_session=")))
      .toContain("Max-Age=604800");
    expect(cookies.find((cookie) => cookie.startsWith("retaste_guest=;")))
      .toContain("Max-Age=0");
    if (oauthCookieName) {
      expect(cookies.find((cookie) => cookie.startsWith(`${oauthCookieName}=;`)))
        .toContain("Max-Age=0");
    }
    await expect(db.select().from(sessions).where(eq(sessions.userId, userId)))
      .resolves.toHaveLength(1);
    await expect(db.select({ badgeId: userTasteBadges.badgeId })
      .from(userTasteBadges)
      .where(and(eq(userTasteBadges.userId, userId), eq(userTasteBadges.source, "USER"))))
      .resolves.toEqual([{ badgeId: "food-gukbap" }]);
  });

  it.each([
    ["email", null, "/places"],
    ["google", "retaste_oauth_request", "/courses"],
    ["naver", "retaste_naver_oauth", "/places"],
  ] as const)("keeps %s login successful and retains guest state when merge fails", async (
    provider,
    oauthCookieName,
    expectedLocation,
  ) => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    const guestId = await seedGuestTaste(db, ["food-gukbap"]);
    const triggerName = `force_route_merge_failure_${crypto.randomUUID().replaceAll("-", "")}`;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.DB.exec(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON user_taste_badges BEGIN SELECT RAISE(ABORT, 'forced route merge failure'); END`,
    );

    try {
      const response = await executeLoginRoute(provider, userId, guestId);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(expectedLocation);
      const cookies = setCookies(response.headers);
      expect(cookies.find((cookie) => cookie.startsWith("retaste_session=")))
        .toContain("Max-Age=604800");
      expect(cookies.some((cookie) => cookie.startsWith("retaste_guest=;"))).toBe(false);
      if (oauthCookieName) {
        expect(cookies.find((cookie) => cookie.startsWith(`${oauthCookieName}=;`)))
          .toContain("Max-Age=0");
      }
      expect(errorSpy).toHaveBeenCalledWith("GUEST_TASTE_MERGE_FAILED");
      await expect(db.select().from(sessions).where(eq(sessions.userId, userId)))
        .resolves.toHaveLength(1);
      await expect(db.query.guestTasteSessions.findFirst({
        where: eq(guestTasteSessions.id, guestId),
      })).resolves.toMatchObject({ mergedUserId: null });
    } finally {
      errorSpy.mockRestore();
      await env.DB.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
  });
});
