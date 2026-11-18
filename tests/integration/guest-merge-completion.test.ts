import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type AppDb } from "../../app/db/client.server";
import { guestSavedPlaces, guestTasteBadges, guestTasteSessions, productEvents, savedPlaces, sessions, userTasteBadges, users } from "../../app/db/schema";
import { mergeGuestTasteSessionFromRequest } from "../../app/features/onboarding/guest-merge.server";
import { createGuestSession } from "../../app/features/onboarding/guest-session.server";
import { setGuestSavedPlace } from "../../app/features/onboarding/guest-saves.server";
import { action as guestAction } from "../../app/routes/guest-saves-resource";

const NOW = "2026-11-18T00:00:00.000Z";
const badges = ["food-gukbap", "style-old-school"];

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

async function member(db: AppDb) {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email: `${id}@example.test`, displayName: "합성 회원", role: "USER", createdAt: NOW, updatedAt: NOW });
  return id;
}

async function fixture() {
  const db = createDb(env.DB), guestId = crypto.randomUUID();
  await createGuestSession(db, { id: guestId, now: NOW });
  const placeIds = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of placeIds) {
    await env.DB.prepare("INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES (?,?,'합성 식당','PUBLISHED','광주 동구','동명',35.149,126.9232,'합성',?,?)")
      .bind(id, id, NOW, NOW).run();
    await setGuestSavedPlace(db, { sessionId: guestId, placeId: id, saved: true, now: NOW });
  }
  await db.insert(guestTasteBadges).values(badges.map(badgeId => ({ sessionId: guestId, badgeId, selectedAt: NOW })));
  return { db, guestId, placeIds, userId: await member(db) };
}

const request = (id: string) => new Request("https://retaste.test/login", { headers: { Cookie: `retaste_guest=${id}` } });

async function memberPayload(db: AppDb, id: string) {
  return {
    badges: (await db.select({ id: userTasteBadges.badgeId }).from(userTasteBadges).where(and(eq(userTasteBadges.userId, id), eq(userTasteBadges.source, "USER")))).map(row => row.id).sort(),
    saves: (await db.select({ id: savedPlaces.placeId }).from(savedPlaces).where(eq(savedPlaces.userId, id))).map(row => row.id).sort(),
  };
}

async function guestPayload(db: AppDb, id: string) {
  return {
    badges: (await db.select({ id: guestTasteBadges.badgeId }).from(guestTasteBadges).where(eq(guestTasteBadges.sessionId, id))).map(row => row.id).sort(),
    saves: (await db.select({ id: guestSavedPlaces.placeId }).from(guestSavedPlaces).where(eq(guestSavedPlaces.sessionId, id))).map(row => row.id).sort(),
  };
}

describe("guest choice inheritance completion", () => {
  it.each([
    ["2026-11-17T23:59:59.999Z", false],
    [NOW, false],
    ["2026-11-18T00:00:00.001Z", true],
  ] as const)("copies combined choices only while the session is unexpired: %s", async (expiresAt, active) => {
    const { db, guestId, placeIds, userId } = await fixture();
    await db.update(guestTasteSessions).set({ expiresAt }).where(eq(guestTasteSessions.id, guestId));
    const result = await mergeGuestTasteSessionFromRequest(db, request(guestId), userId, NOW);
    expect(result.merged).toBe(active);
    expect(await memberPayload(db, userId)).toEqual(active ? { badges: [...badges].sort(), saves: [...placeIds].sort() } : { badges: [], saves: [] });
    expect(await guestPayload(db, guestId)).toEqual(active ? { badges: [], saves: [] } : { badges: [...badges].sort(), saves: [...placeIds].sort() });
    const session = await db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, guestId) });
    expect(session?.mergedUserId).toBe(active ? userId : null);
    expect(session?.expiresAt).toBe(expiresAt);
    expect(result.expireCookie).toEqual(active ? expect.stringContaining("Max-Age=0") : null);
  });

  it("gives exactly one of two concurrent accounts the whole payload and never copies to the loser", async () => {
    const { db, guestId, placeIds, userId } = await fixture();
    const otherId = await member(db);
    const results = await Promise.all([userId, otherId, userId, otherId].map(id => mergeGuestTasteSessionFromRequest(db, request(guestId), id, NOW)));
    expect(results.filter(result => result.merged)).toHaveLength(1);
    expect(results.filter(result => result.expireCookie)).toHaveLength(1);
    const winner = (await db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, guestId) }))!.mergedUserId!;
    expect([userId, otherId]).toContain(winner);
    const loser = winner === userId ? otherId : userId;
    expect(await memberPayload(db, winner)).toEqual({ badges: [...badges].sort(), saves: [...placeIds].sort() });
    expect(await memberPayload(db, loser)).toEqual({ badges: [], saves: [] });
    expect(await guestPayload(db, guestId)).toEqual({ badges: [], saves: [] });
    const events = await db.select().from(productEvents).where(eq(productEvents.guestSessionId, guestId));
    expect(events).toEqual([expect.objectContaining({ eventName: "GUEST_CONVERTED", userId: winner })]);
    for (const id of [winner, loser]) {
      expect((await mergeGuestTasteSessionFromRequest(db, request(guestId), id, NOW)).merged).toBe(false);
    }
    expect(await memberPayload(db, loser)).toEqual({ badges: [], saves: [] });
  });

  it("rolls back both copies and source cleanup on a late precommit failure, then retries exactly once", async () => {
    const { db, guestId, placeIds, userId } = await fixture();
    const trigger = `guest_merge_claim_${guestId.replaceAll("-", "")}`;
    await env.DB.exec(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF merged_user_id ON guest_taste_sessions WHEN OLD.id='${guestId}' BEGIN SELECT RAISE(ABORT,'synthetic claim failure'); END`);
    try {
      await expect(mergeGuestTasteSessionFromRequest(db, request(guestId), userId, NOW)).rejects.toThrow("synthetic claim failure");
      expect(await memberPayload(db, userId)).toEqual({ badges: [], saves: [] });
      expect(await guestPayload(db, guestId)).toEqual({ badges: [...badges].sort(), saves: [...placeIds].sort() });
      expect((await db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, guestId) }))?.mergedUserId).toBeNull();
      expect(await db.select().from(productEvents).where(eq(productEvents.guestSessionId, guestId))).toEqual([]);
    } finally {
      await env.DB.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    }
    const retry = await mergeGuestTasteSessionFromRequest(db, request(guestId), userId, NOW);
    expect(retry.merged).toBe(true);
    expect(retry.expireCookie).toContain("Max-Age=0");
    expect(await memberPayload(db, userId)).toEqual({ badges: [...badges].sort(), saves: [...placeIds].sort() });
    expect(await guestPayload(db, guestId)).toEqual({ badges: [], saves: [] });
    expect((await mergeGuestTasteSessionFromRequest(db, request(guestId), userId, NOW)).merged).toBe(false);
    expect(await db.select().from(productEvents).where(eq(productEvents.guestSessionId, guestId))).toHaveLength(1);
  });

  it("takes the destination from the authenticated session and rejects identity fields in the form", async () => {
    const { db, guestId, placeIds, userId } = await fixture();
    const otherId = await member(db), sessionId = crypto.randomUUID();
    await db.insert(sessions).values({ id: sessionId, userId, createdAt: NOW, expiresAt: "2026-11-19T00:00:00.000Z" });
    const makeRequest = (body: URLSearchParams) => new Request("https://retaste.test/resources/guest-saves", {
      method: "POST", headers: { Origin: "https://retaste.test", "Content-Type": "application/x-www-form-urlencoded", Cookie: `retaste_session=${sessionId}; retaste_guest=${guestId}` }, body,
    });
    const rejected = await guestAction({ request: makeRequest(new URLSearchParams({ intent: "merge", userId: otherId })) } as never);
    expect(rejected.status).toBe(400);
    expect(await memberPayload(db, userId)).toEqual({ badges: [], saves: [] });
    expect(await memberPayload(db, otherId)).toEqual({ badges: [], saves: [] });
    expect(await guestPayload(db, guestId)).toEqual({ badges: [...badges].sort(), saves: [...placeIds].sort() });
    const accepted = await guestAction({ request: makeRequest(new URLSearchParams({ intent: "merge" })) } as never);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true, merged: true });
    expect(await memberPayload(db, userId)).toEqual({ badges: [...badges].sort(), saves: [...placeIds].sort() });
    expect(await memberPayload(db, otherId)).toEqual({ badges: [], saves: [] });
  });
});
