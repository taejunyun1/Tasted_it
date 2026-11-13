import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { guestSavedPlaces, guestTasteBadges, guestTasteSessions, places, rateLimitWindows } from "../../db/schema";
import { readGuestSessionId } from "./guest-session.server";

export const GUEST_SAVE_LIMIT = 50;
export function activeGuestChoiceSession(sessionId: string, now: string) {
  return and(eq(guestTasteSessions.id, sessionId), isNull(guestTasteSessions.mergedUserId), gt(guestTasteSessions.expiresAt, now));
}
export async function getGuestSavedPlace(db: AppDb, input: { sessionId: string; placeId: string; now: string }) {
  const rows = await db.select({ id: guestSavedPlaces.placeId }).from(guestSavedPlaces)
    .innerJoin(guestTasteSessions, eq(guestTasteSessions.id, guestSavedPlaces.sessionId))
    .where(and(activeGuestChoiceSession(input.sessionId, input.now), eq(guestSavedPlaces.placeId, input.placeId))).limit(1);
  return rows.length > 0;
}
export async function setGuestSavedPlace(db: AppDb, input: { sessionId: string; placeId: string; saved: boolean; now: string }) {
  const active = await db.query.guestTasteSessions.findFirst({ where: activeGuestChoiceSession(input.sessionId, input.now) });
  if (!active) throw new Error("GUEST_SESSION_UNAVAILABLE");
  if (input.saved) {
    await db.insert(guestSavedPlaces).select(db.select({
      sessionId: guestTasteSessions.id,
      placeId: sql<string>`${input.placeId}`.as("place_id"),
      createdAt: sql<string>`${input.now}`.as("created_at"),
    }).from(guestTasteSessions).where(and(
      activeGuestChoiceSession(input.sessionId, input.now),
      sql`exists (select 1 from ${places} where ${places.id}=${input.placeId} and ${places.status}='PUBLISHED')`,
      sql`(select count(*) from ${guestSavedPlaces} where ${guestSavedPlaces.sessionId}=${input.sessionId}) < ${GUEST_SAVE_LIMIT}`,
    ))).onConflictDoNothing();
    if (!await getGuestSavedPlace(db, input)) {
      if (!await db.query.guestTasteSessions.findFirst({ where: activeGuestChoiceSession(input.sessionId, input.now) })) throw new Error("GUEST_SESSION_UNAVAILABLE");
      const place = await db.query.places.findFirst({ where: and(eq(places.id, input.placeId), eq(places.status, "PUBLISHED")) });
      throw new Error(place ? "GUEST_SAVE_LIMIT" : "GUEST_PLACE_UNAVAILABLE");
    }
  } else {
    await db.delete(guestSavedPlaces).where(and(eq(guestSavedPlaces.sessionId, input.sessionId), eq(guestSavedPlaces.placeId, input.placeId),
      sql`exists (select 1 from ${guestTasteSessions} where ${activeGuestChoiceSession(input.sessionId, input.now)})`));
    if (!await db.query.guestTasteSessions.findFirst({ where: activeGuestChoiceSession(input.sessionId, input.now) })) throw new Error("GUEST_SESSION_UNAVAILABLE");
  }
}
export async function getGuestChoiceMergeState(db: AppDb, request: Request, now: string): Promise<"PENDING" | "EXPIRED" | "NONE"> {
  const sessionId = readGuestSessionId(request);
  if (!sessionId) return "NONE";
  const session = await db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, sessionId) });
  if (!session || session.mergedUserId) return "NONE";
  if (session.expiresAt <= now) return "EXPIRED";
  const [saves, badges] = await Promise.all([
    db.select({ id: guestSavedPlaces.placeId }).from(guestSavedPlaces).where(eq(guestSavedPlaces.sessionId, sessionId)).limit(1),
    db.select({ id: guestTasteBadges.badgeId }).from(guestTasteBadges).where(eq(guestTasteBadges.sessionId, sessionId)).limit(1),
  ]);
  return saves.length > 0 || badges.length > 0 ? "PENDING" : "NONE";
}
export async function hasPendingGuestChoices(db: AppDb, request: Request, now: string) {
  return await getGuestChoiceMergeState(db, request, now) === "PENDING";
}

// Bound anonymous write/session churn without retaining the raw client address.
export async function consumeGuestSaveWriteLimit(db: AppDb, clientAddress: string | null, now: string) {
  const windowMs = 15 * 60_000;
  const windowStartedAt = new Date(Math.floor(Date.parse(now) / windowMs) * windowMs).toISOString();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`guest-save-write:${clientAddress ?? "local-no-address"}`));
  const bucketHash = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
  await db.delete(rateLimitWindows).where(lt(rateLimitWindows.windowStartedAt, new Date(Date.parse(now) - 86_400_000).toISOString()));
  const [window] = await db.insert(rateLimitWindows).values({ bucketHash, windowStartedAt, attemptCount: 1 })
    .onConflictDoUpdate({ target: [rateLimitWindows.bucketHash, rateLimitWindows.windowStartedAt], set: { attemptCount: sql`${rateLimitWindows.attemptCount} + 1` } })
    .returning({ count: rateLimitWindows.attemptCount });
  if (!window || window.count > 120) throw new Error("GUEST_SAVE_RATE_LIMIT");
}
