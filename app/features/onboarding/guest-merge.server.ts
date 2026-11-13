import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  guestSavedPlaces,
  memberSaveChoices,
  places,
  savedPlaces,
  guestTasteBadges,
  guestTasteSessions,
  userTasteBadges,
} from "../../db/schema";
import { TASTE_BADGE_CATALOG } from "../members/profile-taste-badges";
import {
  expiredGuestSessionCookie,
  readGuestSessionId,
} from "./guest-session.server";
import { recordProductEvent } from "./onboarding-events.server";

const ONBOARDING_EVIDENCE = JSON.stringify({ source: "ONBOARDING", version: 1 });
const VALID_BADGE_IDS_JSON = JSON.stringify(TASTE_BADGE_CATALOG.map((badge) => badge.id));

function activeSessionConditions(sessionId: string, now: string) {
  return and(
    eq(guestTasteSessions.id, sessionId),
    isNull(guestTasteSessions.mergedUserId),
    gt(guestTasteSessions.expiresAt, now),
  );
}

export async function mergeGuestTasteSessionFromRequest(
  db: AppDb,
  request: Request,
  userId: string,
  now: string,
): Promise<{ merged: boolean; expireCookie: string | null }> {
  const sessionId = readGuestSessionId(request);
  if (!sessionId) return { merged: false, expireCookie: null };

  const copyCurrentBadges = db.insert(userTasteBadges).select(
    db.select({
      userId: sql<string>`${userId}`.as("user_id"),
      badgeId: guestTasteBadges.badgeId,
      source: sql<"USER">`'USER'`.as("source"),
      score: sql<number>`0.8`.as("score"),
      evidenceJson: sql<string>`${ONBOARDING_EVIDENCE}`.as("evidence_json"),
      createdAt: sql<string>`${now}`.as("created_at"),
      updatedAt: sql<string>`${now}`.as("updated_at"),
    })
      .from(guestTasteBadges)
      .innerJoin(
        guestTasteSessions,
        eq(guestTasteSessions.id, guestTasteBadges.sessionId),
      )
      .where(and(
        activeSessionConditions(sessionId, now),
        sql`${guestTasteBadges.badgeId} in (select value from json_each(${VALID_BADGE_IDS_JSON}))`,
      )),
  ).onConflictDoNothing();
  const copyCurrentSaves = db.insert(savedPlaces).select(
    db.select({
      userId: sql<string>`${userId}`.as("user_id"),
      placeId: guestSavedPlaces.placeId,
      createdAt: sql<string>`${now}`.as("created_at"),
    }).from(guestSavedPlaces)
      .innerJoin(guestTasteSessions, eq(guestTasteSessions.id, guestSavedPlaces.sessionId))
      .innerJoin(places, eq(places.id, guestSavedPlaces.placeId))
      .where(and(activeSessionConditions(sessionId, now), eq(places.status, "PUBLISHED"),
        sql`not exists (select 1 from ${memberSaveChoices} where ${memberSaveChoices.userId}=${userId} and ${memberSaveChoices.placeId}=${guestSavedPlaces.placeId})`,
      )),
  ).onConflictDoNothing();
  const markMerged = db.update(guestTasteSessions)
    .set({ mergedUserId: userId, updatedAt: now })
    .where(activeSessionConditions(sessionId, now));
  const claimed = sql`exists (select 1 from ${guestTasteSessions} where ${guestTasteSessions.id}=${sessionId} and ${guestTasteSessions.mergedUserId}=${userId})`;
  const [, , sessionUpdate] = await db.batch([
    copyCurrentBadges,
    copyCurrentSaves,
    markMerged,
    db.delete(guestSavedPlaces).where(and(eq(guestSavedPlaces.sessionId, sessionId), claimed)),
    db.delete(guestTasteBadges).where(and(eq(guestTasteBadges.sessionId, sessionId), claimed)),
  ]);
  if (sessionUpdate?.meta?.changes !== 1) {
    return { merged: false, expireCookie: null };
  }

  try {
    await recordProductEvent(db, {
      eventName: "GUEST_CONVERTED",
      guestSessionId: sessionId,
      userId,
      occurredAt: now,
    });
  } catch {
    console.error("PRODUCT_EVENT_WRITE_FAILED");
  }

  return {
    merged: true,
    expireCookie: expiredGuestSessionCookie(request.url),
  };
}

export async function appendGuestTasteMergeCookie(input: {
  headers: Headers;
  db: AppDb;
  request: Request;
  userId: string;
  now: string;
}): Promise<void> {
  try {
    const result = await mergeGuestTasteSessionFromRequest(
      input.db,
      input.request,
      input.userId,
      input.now,
    );
    if (result.expireCookie) {
      input.headers.append("Set-Cookie", result.expireCookie);
    }
  } catch {
    console.error("GUEST_TASTE_MERGE_FAILED");
  }
}
