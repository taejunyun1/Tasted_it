import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  guestTasteBadges,
  guestTasteSessions,
  userTasteBadges,
} from "../../db/schema";
import { TASTE_BADGE_CATALOG } from "../members/profile-taste-badges";
import {
  expiredGuestSessionCookie,
  readGuestSessionId,
} from "./guest-session.server";

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
  ).onConflictDoUpdate({
    target: [
      userTasteBadges.userId,
      userTasteBadges.badgeId,
      userTasteBadges.source,
    ],
    set: {
      score: sql`max(${userTasteBadges.score}, excluded.score)`,
      evidenceJson: ONBOARDING_EVIDENCE,
      updatedAt: now,
    },
  });
  const markMerged = db.update(guestTasteSessions)
    .set({ mergedUserId: userId, updatedAt: now })
    .where(activeSessionConditions(sessionId, now));
  const [, sessionUpdate] = await db.batch([copyCurrentBadges, markMerged]);
  if (sessionUpdate?.meta?.changes !== 1) {
    return { merged: false, expireCookie: null };
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
