import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { guestTasteSessions, savedPlaces, users, userTasteBadges } from "../../app/db/schema";
import { createGuestSession } from "../../app/features/onboarding/guest-session.server";
import { getGuestSavedPlace, setGuestSavedPlace } from "../../app/features/onboarding/guest-saves.server";
import { mergeGuestTasteSessionFromRequest } from "../../app/features/onboarding/guest-merge.server";
import { setSaved } from "../../app/features/saves/save.server";
import { purgeExpiredOnboardingData } from "../../app/features/onboarding/data-lifecycle.server";

const now = "2026-11-13T00:00:00.000Z";
async function fixture(count = 1) {
  const db = createDb(env.DB);
  const id = crypto.randomUUID();
  await createGuestSession(db, { id, now });
  const placeIds = Array.from({ length: count }, () => crypto.randomUUID());
  for (const placeId of placeIds) await env.DB.prepare("INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES (?,?,'합성 장소','PUBLISHED','광주 동구','동명',35.149,126.9232,'합성',?,?)").bind(placeId, placeId, now, now).run();
  const userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, displayName: "합성", role: "USER", createdAt: now, updatedAt: now });
  return { db, id, placeIds, userId };
}
const request = (id: string) => new Request("https://example.test/login", { headers: { Cookie: `retaste_guest=${id}` } });

describe("guest saves and atomic member merge", () => {
  it("stores one own temporary choice, supports removal and rejects expired/merged sessions", async () => {
    const { db, id, placeIds: [placeId], userId } = await fixture();
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
    expect(await getGuestSavedPlace(db, { sessionId: id, placeId, now })).toBe(true);
    expect(await getGuestSavedPlace(db, { sessionId: "other", placeId, now })).toBe(false);
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: false, now });
    expect(await getGuestSavedPlace(db, { sessionId: id, placeId, now })).toBe(false);
    await db.update(guestTasteSessions).set({ mergedUserId: userId }).where(eq(guestTasteSessions.id, id));
    await expect(setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now })).rejects.toThrow("GUEST_SESSION_UNAVAILABLE");
    await db.update(guestTasteSessions).set({ mergedUserId: null, expiresAt: now }).where(eq(guestTasteSessions.id, id));
    await expect(setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now })).rejects.toThrow("GUEST_SESSION_UNAVAILABLE");
  });
  it("enforces the 50-place cap even with concurrent inserts and permits idempotent reuse/removal", async () => {
    const { db, id, placeIds } = await fixture(52);
    await Promise.all(placeIds.slice(0, 49).map((placeId) => setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now })));
    const raced = await Promise.allSettled(placeIds.slice(49).map((placeId) => setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now })));
    expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const count = await env.DB.prepare("SELECT count(*) n FROM guest_saved_places WHERE session_id=?").bind(id).first<{n: number}>();
    expect(count?.n).toBe(50);
    await expect(setGuestSavedPlace(db, { sessionId: id, placeId: placeIds[0], saved: true, now })).resolves.toBeUndefined();
    await setGuestSavedPlace(db, { sessionId: id, placeId: placeIds[0], saved: false, now });
    await expect(setGuestSavedPlace(db, { sessionId: id, placeId: placeIds[51], saved: true, now })).resolves.toBeUndefined();
  });
  it("merges missing saves once while preserving existing member save and explicit unsave", async () => {
    const { db, id, placeIds, userId } = await fixture(3);
    await Promise.all(placeIds.map((placeId) => setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now })));
    await setSaved(db, { userId, placeId: placeIds[0], saved: true, now: "2026-11-12T00:00:00.000Z" });
    await setSaved(db, { userId, placeId: placeIds[1], saved: false, now });
    const merged = await mergeGuestTasteSessionFromRequest(db, request(id), userId, now);
    expect(merged.merged).toBe(true);
    const rows = await db.select().from(savedPlaces).where(eq(savedPlaces.userId, userId));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ placeId: placeIds[0], createdAt: "2026-11-12T00:00:00.000Z" }),
      expect.objectContaining({ placeId: placeIds[2] }),
    ]));
    expect(rows).toHaveLength(2);
    expect((await env.DB.prepare("SELECT count(*) n FROM guest_saved_places WHERE session_id=?").bind(id).first<{n: number}>())?.n).toBe(0);
    expect((await mergeGuestTasteSessionFromRequest(db, request(id), userId, now)).merged).toBe(false);
  });
  it("keeps badges/saves/cookie retryable when any merge write fails and succeeds after explicit retry", async () => {
    const { db, id, placeIds: [placeId], userId } = await fixture();
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
    await env.DB.prepare("INSERT INTO guest_taste_badges (session_id,badge_id,selected_at) VALUES (?,'food-gukbap',?)").bind(id, now).run();
    await env.DB.exec("CREATE TRIGGER guest_save_test_failure BEFORE INSERT ON saved_places BEGIN SELECT RAISE(ABORT,'forced'); END");
    try {
      await expect(mergeGuestTasteSessionFromRequest(db, request(id), userId, now)).rejects.toThrow();
      expect(await getGuestSavedPlace(db, { sessionId: id, placeId, now })).toBe(true);
      expect(await db.select().from(userTasteBadges).where(and(eq(userTasteBadges.userId, userId), eq(userTasteBadges.source, "USER")))).toHaveLength(0);
      expect((await db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, id) }))?.mergedUserId).toBeNull();
    } finally { await env.DB.exec("DROP TRIGGER guest_save_test_failure"); }
    expect((await mergeGuestTasteSessionFromRequest(db, request(id), userId, now)).merged).toBe(true);
  });
  it("does not copy another member's merged guest state and cascades expired saves", async () => {
    const { db, id, placeIds: [placeId], userId } = await fixture();
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
    await db.update(guestTasteSessions).set({ mergedUserId: userId }).where(eq(guestTasteSessions.id, id));
    const other = await fixture();
    expect((await mergeGuestTasteSessionFromRequest(db, request(id), other.userId, now)).merged).toBe(false);
    expect(await db.select().from(savedPlaces).where(eq(savedPlaces.userId, other.userId))).toHaveLength(0);
    await purgeExpiredOnboardingData(db, { now: "2026-12-14T00:00:00.000Z" });
    expect((await env.DB.prepare("SELECT count(*) n FROM guest_saved_places WHERE session_id=?").bind(id).first<{n: number}>())?.n).toBe(0);
  });
});

describe("merge serialisation with explicit member choices", () => {
  it("does not resurrect a member unsave that commits before the merge batch", async () => {
    const { db, id, placeIds: [placeId], userId } = await fixture();
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
    const racedDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "batch") return async (...input: Parameters<typeof db.batch>) => {
          await setSaved(target, { userId, placeId, saved: false, now });
          return target.batch(...input);
        };
        return Reflect.get(target, property, receiver);
      },
    }) as typeof db;
    expect((await mergeGuestTasteSessionFromRequest(racedDb, request(id), userId, now)).merged).toBe(true);
    expect(await db.select().from(savedPlaces).where(eq(savedPlaces.userId, userId))).toHaveLength(0);
  });
  it("does not copy a temporary place hidden before merge and preserves a low member badge score", async () => {
    const { db, id, placeIds: [placeId], userId } = await fixture();
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
    await env.DB.prepare("UPDATE places SET status='HIDDEN' WHERE id=?").bind(placeId).run();
    await env.DB.prepare("INSERT INTO guest_taste_badges (session_id,badge_id,selected_at) VALUES (?,'food-gukbap',?)").bind(id, now).run();
    await db.insert(userTasteBadges).values({ userId, badgeId: "food-gukbap", source: "USER", score: 0.1, evidenceJson: "{}", createdAt: now, updatedAt: now });
    expect((await mergeGuestTasteSessionFromRequest(db, request(id), userId, now)).merged).toBe(true);
    expect(await db.select().from(savedPlaces).where(eq(savedPlaces.userId, userId))).toHaveLength(0);
    expect((await db.select().from(userTasteBadges).where(eq(userTasteBadges.userId, userId)))[0]?.score).toBe(0.1);
  });
});

describe("guest merge notices and write limits", () => {
  it("does not create data for notices and distinguishes expired pending choices", async () => {
    const { getGuestChoiceMergeState } = await import("../../app/features/onboarding/guest-saves.server");
    const { db, id, placeIds: [placeId] } = await fixture();
    expect(await getGuestChoiceMergeState(db, new Request("https://example.test"), now)).toBe("NONE");
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
    expect(await getGuestChoiceMergeState(db, request(id), now)).toBe("PENDING");
    expect(await getGuestChoiceMergeState(db, request(id), "2026-12-14T00:00:00.000Z")).toBe("EXPIRED");
  });
  it("bounds anonymous writes using a hashed existing rate-limit window", async () => {
    const { consumeGuestSaveWriteLimit } = await import("../../app/features/onboarding/guest-saves.server");
    const db = createDb(env.DB), ip = "203.0.113.44";
    for (let i = 0; i < 120; i++) await consumeGuestSaveWriteLimit(db, ip, now);
    await expect(consumeGuestSaveWriteLimit(db, ip, now)).rejects.toThrow("GUEST_SAVE_RATE_LIMIT");
    await expect(consumeGuestSaveWriteLimit(db, ip, "2026-11-13T00:15:00.000Z")).resolves.toBeUndefined();
    expect((await env.DB.prepare("SELECT count(*) n FROM rate_limit_windows WHERE bucket_hash=?").bind(ip).first<{n: number}>())?.n).toBe(0);
  });
});

describe("guest unsave versus merge", () => {
  it("reports a conflict when merge wins after the active-session read", async () => {
    const { db, id, placeIds: [placeId], userId } = await fixture();
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
    let first = true;
    const racedDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "query") return { ...target.query, guestTasteSessions: {
          ...target.query.guestTasteSessions,
          findFirst: async (...args: Parameters<typeof target.query.guestTasteSessions.findFirst>) => {
            const result = await target.query.guestTasteSessions.findFirst(...args);
            if (first) {
              first = false;
              await mergeGuestTasteSessionFromRequest(target, request(id), userId, now);
            }
            return result;
          },
        } };
        return Reflect.get(target, property, receiver);
      },
    }) as typeof db;
    await expect(setGuestSavedPlace(racedDb, { sessionId: id, placeId, saved: false, now })).rejects.toThrow("GUEST_SESSION_UNAVAILABLE");
    expect(await db.select().from(savedPlaces).where(eq(savedPlaces.userId, userId))).toHaveLength(1);
  });
  it("keeps an unsave committed before merge out of the member account", async () => {
    const { db, id, placeIds: [placeId], userId } = await fixture();
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: false, now });
    expect((await mergeGuestTasteSessionFromRequest(db, request(id), userId, now)).merged).toBe(true);
    expect(await db.select().from(savedPlaces).where(eq(savedPlaces.userId, userId))).toHaveLength(0);
  });
});

describe("member save choice retention", () => {
  it("deletes explicit save choice markers when the member withdraws", async () => {
    const { withdrawAccount } = await import("../../app/features/auth/account.server");
    const { db, placeIds: [placeId], userId } = await fixture();
    await setSaved(db, { userId, placeId, saved: false, now });
    await withdrawAccount(db, { userId, now: new Date(now) });
    expect((await env.DB.prepare("SELECT count(*) n FROM member_save_choices WHERE user_id=?").bind(userId).first<{n: number}>())?.n).toBe(0);
  });
});
