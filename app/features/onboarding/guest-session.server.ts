import { and, eq, exists, gt, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { AppDb } from "../../db/client.server";
import { guestTasteBadges, guestTasteSessions } from "../../db/schema";
import {
  TASTE_BADGE_CATALOG,
  type TasteBadgeCategory,
} from "../members/profile-taste-badges";
import type { OnboardingStep } from "./onboarding";

export const GUEST_COOKIE_NAME = "retaste_guest";
export const GUEST_TTL_SECONDS = 60 * 60 * 24 * 30;

const ONBOARDING_STEPS: OnboardingStep[] = ["LOCATION", "FOOD", "STYLE", "PREVIEW"];
const badgeById = new Map(TASTE_BADGE_CATALOG.map((badge) => [badge.id, badge]));

export type GuestOnboardingState = {
  sessionId: string;
  step: OnboardingStep;
  locationMode: "DEVICE" | "DEFAULT";
  foodBadgeIds: string[];
  styleBadgeIds: string[];
  expiresAt: string;
  completedAt: string | null;
  skippedAt: string | null;
};

export type SaveGuestOnboardingInput = {
  sessionId: string;
  step: OnboardingStep;
  locationMode: "DEVICE" | "DEFAULT";
  foodBadgeIds: string[];
  styleBadgeIds: string[];
  now: string;
};

function guestSessionCookieAttributes(requestUrl: string, maxAge: number) {
  const attributes = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (new URL(requestUrl).protocol === "https:") attributes.push("Secure");
  return attributes.join("; ");
}

function validStep(value: unknown): value is OnboardingStep {
  return typeof value === "string" && ONBOARDING_STEPS.includes(value as OnboardingStep);
}

function stepFromCompletedSteps(completedStepsJson: string): OnboardingStep {
  try {
    const completed = JSON.parse(completedStepsJson);
    if (Array.isArray(completed)) {
      const step = completed.at(-1);
      if (validStep(step)) return step;
    }
  } catch {
    // A malformed legacy value must not make a guest session unreadable.
  }
  return "LOCATION";
}

function isValidBadgeSelection(input: SaveGuestOnboardingInput) {
  const allBadgeIds = [...input.foodBadgeIds, ...input.styleBadgeIds];
  if (new Set(allBadgeIds).size !== allBadgeIds.length) return false;
  if (input.foodBadgeIds.length > 5 || input.styleBadgeIds.length > 3) return false;

  const hasCategory = (badgeId: string, category: TasteBadgeCategory) => badgeById.get(badgeId)?.category === category;
  return input.foodBadgeIds.every((badgeId) => hasCategory(badgeId, "FOOD"))
    && input.styleBadgeIds.every((badgeId) => {
      const category = badgeById.get(badgeId)?.category;
      return category === "STYLE" || category === "TASTE";
    });
}

function activeGuestSessionConditions(sessionId: string, now: string) {
  return and(
    eq(guestTasteSessions.id, sessionId),
    isNull(guestTasteSessions.mergedUserId),
    gt(guestTasteSessions.expiresAt, now),
  );
}

function activeGuestSessionExists(db: AppDb, sessionId: string, now: string) {
  return exists(
    db.select({ id: guestTasteSessions.id })
      .from(guestTasteSessions)
      .where(activeGuestSessionConditions(sessionId, now)),
  );
}

export function readGuestSessionId(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;

  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== GUEST_COOKIE_NAME) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

export function guestSessionCookie(id: string, requestUrl: string): string {
  return `${GUEST_COOKIE_NAME}=${encodeURIComponent(id)}; ${guestSessionCookieAttributes(requestUrl, GUEST_TTL_SECONDS)}`;
}

export function expiredGuestSessionCookie(requestUrl: string): string {
  return `${GUEST_COOKIE_NAME}=; ${guestSessionCookieAttributes(requestUrl, 0)}`;
}

export async function createGuestSession(
  db: AppDb,
  input: { id: string; now: string },
): Promise<typeof guestTasteSessions.$inferSelect> {
  const expiresAt = new Date(new Date(input.now).getTime() + GUEST_TTL_SECONDS * 1_000).toISOString();
  await db.insert(guestTasteSessions).values({
    id: input.id,
    locationMode: "DEFAULT",
    completedStepsJson: "[]",
    expiresAt,
    createdAt: input.now,
    updatedAt: input.now,
  });
  const session = await db.query.guestTasteSessions.findFirst({
    where: eq(guestTasteSessions.id, input.id),
  });
  if (!session) throw new Error("GUEST_SESSION_CREATE_FAILED");
  return session;
}

export async function getOrCreateGuestSession(
  db: AppDb,
  request: Request,
  now: string,
): Promise<{ session: typeof guestTasteSessions.$inferSelect; setCookie: string | null }> {
  const sessionId = readGuestSessionId(request);
  if (sessionId) {
    const session = await db.query.guestTasteSessions.findFirst({
      where: activeGuestSessionConditions(sessionId, now),
    });
    if (session) return { session, setCookie: null };
  }

  const session = await createGuestSession(db, { id: crypto.randomUUID(), now });
  return { session, setCookie: guestSessionCookie(session.id, request.url) };
}

export async function getGuestOnboarding(
  db: AppDb,
  sessionId: string,
  now: string,
): Promise<GuestOnboardingState | null> {
  const session = await db.query.guestTasteSessions.findFirst({
    where: activeGuestSessionConditions(sessionId, now),
  });
  if (!session) return null;

  const selected = await db
    .select({ badgeId: guestTasteBadges.badgeId })
    .from(guestTasteBadges)
    .where(eq(guestTasteBadges.sessionId, session.id));
  const foodBadgeIds = selected
    .filter(({ badgeId }) => badgeById.get(badgeId)?.category === "FOOD")
    .map(({ badgeId }) => badgeId)
    .sort();
  const styleBadgeIds = selected
    .filter(({ badgeId }) => {
      const category = badgeById.get(badgeId)?.category;
      return category === "STYLE" || category === "TASTE";
    })
    .map(({ badgeId }) => badgeId)
    .sort();

  return {
    sessionId: session.id,
    step: stepFromCompletedSteps(session.completedStepsJson),
    locationMode: session.locationMode,
    foodBadgeIds,
    styleBadgeIds,
    expiresAt: session.expiresAt,
    completedAt: session.completedAt,
    skippedAt: session.skippedAt,
  };
}

export async function getGuestOnboardingFromRequest(
  db: AppDb,
  request: Request,
  now: string,
): Promise<GuestOnboardingState | null> {
  const sessionId = readGuestSessionId(request);
  return sessionId ? getGuestOnboarding(db, sessionId, now) : null;
}

export async function saveGuestOnboarding(
  db: AppDb,
  input: SaveGuestOnboardingInput,
): Promise<void> {
  if (!isValidBadgeSelection(input)) throw new Error("GUEST_ONBOARDING_BADGES_INVALID");

  const selectedBadgeIds = [...input.foodBadgeIds, ...input.styleBadgeIds];
  const statements: BatchItem<"sqlite">[] = [
    db.delete(guestTasteBadges).where(and(
      eq(guestTasteBadges.sessionId, input.sessionId),
      activeGuestSessionExists(db, input.sessionId, input.now),
    )),
    ...selectedBadgeIds.map((badgeId) => db.insert(guestTasteBadges).select(
      db.select({
        sessionId: guestTasteSessions.id,
        badgeId: sql<string>`${badgeId}`.as("badge_id"),
        selectedAt: sql<string>`${input.now}`.as("selected_at"),
      }).from(guestTasteSessions).where(activeGuestSessionConditions(input.sessionId, input.now)),
    )),
    db.update(guestTasteSessions).set({
      locationMode: input.locationMode,
      completedStepsJson: JSON.stringify([input.step]),
      updatedAt: input.now,
    }).where(activeGuestSessionConditions(input.sessionId, input.now)),
  ];
  const [first, ...rest] = statements;
  if (!first) throw new Error("GUEST_SESSION_UNAVAILABLE");
  const results = await db.batch([first, ...rest]);
  const sessionUpdate = results.at(-1) as { meta?: { changes?: number } } | undefined;
  if (sessionUpdate?.meta?.changes !== 1) throw new Error("GUEST_SESSION_UNAVAILABLE");
}
