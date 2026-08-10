import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createDb, type AppDb } from "../../app/db/client.server";
import {
  guestTasteBadges,
  guestTasteSessions,
  userTasteBadges,
  users,
} from "../../app/db/schema";
import {
  appendGuestTasteMergeCookie,
  mergeGuestTasteSessionFromRequest,
} from "../../app/features/onboarding/guest-merge.server";
import googleCallbackSource from "../../app/routes/auth-google-callback.tsx?raw";
import naverCallbackSource from "../../app/routes/auth-naver-callback.tsx?raw";
import loginSource from "../../app/routes/login.tsx?raw";

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
  input: { id?: string; expiresAt?: string; mergedUserId?: string | null } = {},
) {
  const id = input.id ?? `guest-${crypto.randomUUID()}`;
  await db.insert(guestTasteSessions).values({
    id,
    locationMode: "DEFAULT",
    completedStepsJson: "[\"PREVIEW\"]",
    completedAt: CREATED_AT,
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
      expect.objectContaining({ source: "USER", score: 0.95 }),
      expect.objectContaining({ source: "GOOGLE", score: 0.7, evidenceJson: "{\"source\":\"GOOGLE\"}" }),
    ]));
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
});

function setCookieText(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  return getSetCookie ? getSetCookie.call(headers).join("\n") : headers.get("Set-Cookie") ?? "";
}

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
    ["email", loginSource],
    ["Google", googleCallbackSource],
    ["Naver", naverCallbackSource],
  ])("wires %s login through the shared guest merge cookie helper", (_provider, source) => {
    expect(source).toContain("appendGuestTasteMergeCookie");
    expect(source).toContain("const headers = new Headers()");
    expect(source).toContain("headers.append(\"Set-Cookie\"");
  });
});
