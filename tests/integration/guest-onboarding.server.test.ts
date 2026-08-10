import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import {
  guestTasteBadges,
  guestTasteSessions,
  users,
} from "../../app/db/schema";
import {
  GUEST_COOKIE_NAME,
  GUEST_TTL_SECONDS,
  createGuestSession,
  getGuestOnboarding,
  getGuestOnboardingFromRequest,
  getOrCreateGuestSession,
  saveGuestOnboarding,
} from "../../app/features/onboarding/guest-session.server";

describe("guest onboarding", () => {
  it("creates a 30-day guest session and replaces selected badges", async () => {
    const db = createDb(env.DB);
    const created = await createGuestSession(db, { id: `guest-${crypto.randomUUID()}`, now: "2026-08-10T00:00:00Z" });
    expect(created.expiresAt).toBe("2026-09-09T00:00:00.000Z");

    await saveGuestOnboarding(db, {
      sessionId: created.id,
      step: "STYLE",
      locationMode: "DEVICE",
      foodBadgeIds: ["food-gukbap"],
      styleBadgeIds: ["style-old-school"],
      now: "2026-08-10T00:01:00Z",
    });

    const restored = await getGuestOnboarding(db, created.id, "2026-08-10T00:02:00Z");
    expect(restored?.foodBadgeIds).toEqual(["food-gukbap"]);
    expect(restored?.styleBadgeIds).toEqual(["style-old-school"]);

    await saveGuestOnboarding(db, {
      sessionId: created.id,
      step: "PREVIEW",
      locationMode: "DEFAULT",
      foodBadgeIds: ["food-ramen"],
      styleBadgeIds: ["taste-spicy", "style-market"],
      now: "2026-08-10T00:03:00Z",
    });

    const replaced = await getGuestOnboarding(db, created.id, "2026-08-10T00:04:00Z");
    expect(replaced).toMatchObject({
      step: "PREVIEW",
      locationMode: "DEFAULT",
      foodBadgeIds: ["food-ramen"],
      styleBadgeIds: ["style-market", "taste-spicy"],
      expiresAt: "2026-09-09T00:00:00.000Z",
    });
  });

  it("creates a new guest session only when the request cookie is unavailable", async () => {
    const db = createDb(env.DB);
    const now = "2026-08-10T00:00:00Z";
    const first = await getOrCreateGuestSession(db, new Request("https://example.com/onboarding"), now);
    expect(first.setCookie).toContain(`${GUEST_COOKIE_NAME}=${first.session.id}`);
    expect(first.setCookie).toContain(`Max-Age=${GUEST_TTL_SECONDS}`);
    expect(first.setCookie).toContain("Secure");

    const second = await getOrCreateGuestSession(
      db,
      new Request("https://example.com/onboarding", { headers: { Cookie: first.setCookie! } }),
      "2026-08-10T00:01:00Z",
    );
    expect(second).toMatchObject({ session: { id: first.session.id }, setCookie: null });

    const restored = await getGuestOnboardingFromRequest(
      db,
      new Request("https://example.com/onboarding", { headers: { Cookie: first.setCookie! } }),
      "2026-08-10T00:01:00Z",
    );
    expect(restored?.sessionId).toBe(first.session.id);
  });

  it("rejects unknown badges and category limit violations before writing", async () => {
    const db = createDb(env.DB);
    const created = await createGuestSession(db, { id: `guest-${crypto.randomUUID()}`, now: "2026-08-10T00:00:00Z" });

    await expect(saveGuestOnboarding(db, {
      sessionId: created.id,
      step: "FOOD",
      locationMode: "DEFAULT",
      foodBadgeIds: ["food-not-in-catalog"],
      styleBadgeIds: [],
      now: "2026-08-10T00:01:00Z",
    })).rejects.toThrow("GUEST_ONBOARDING_BADGES_INVALID");

    await expect(saveGuestOnboarding(db, {
      sessionId: created.id,
      step: "STYLE",
      locationMode: "DEFAULT",
      foodBadgeIds: ["food-gukbap"],
      styleBadgeIds: ["style-old-school", "style-market", "taste-spicy", "taste-rich"],
      now: "2026-08-10T00:01:00Z",
    })).rejects.toThrow("GUEST_ONBOARDING_BADGES_INVALID");

    const badges = await db.select().from(guestTasteBadges).where(eq(guestTasteBadges.sessionId, created.id));
    expect(badges).toEqual([]);
  });

  it("does not write expired or merged guest sessions", async () => {
    const db = createDb(env.DB);
    const expired = await createGuestSession(db, { id: `guest-${crypto.randomUUID()}`, now: "2026-08-10T00:00:00Z" });
    await db.update(guestTasteSessions).set({ expiresAt: "2026-08-10T00:01:00.000Z" }).where(eq(guestTasteSessions.id, expired.id));

    await expect(saveGuestOnboarding(db, {
      sessionId: expired.id,
      step: "FOOD",
      locationMode: "DEFAULT",
      foodBadgeIds: ["food-gukbap"],
      styleBadgeIds: [],
      now: "2026-08-10T00:01:00Z",
    })).rejects.toThrow("GUEST_SESSION_UNAVAILABLE");
    expect(await getGuestOnboarding(db, expired.id, "2026-08-10T00:01:00Z")).toBeNull();

    const merged = await createGuestSession(db, { id: `guest-${crypto.randomUUID()}`, now: "2026-08-10T00:00:00Z" });
    const userId = `user-${crypto.randomUUID()}`;
    await db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "병합 사용자",
      role: "USER",
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: "2026-08-10T00:00:00Z",
    });
    await db.update(guestTasteSessions).set({ mergedUserId: userId }).where(eq(guestTasteSessions.id, merged.id));

    await expect(saveGuestOnboarding(db, {
      sessionId: merged.id,
      step: "FOOD",
      locationMode: "DEFAULT",
      foodBadgeIds: ["food-gukbap"],
      styleBadgeIds: [],
      now: "2026-08-10T00:01:00Z",
    })).rejects.toThrow("GUEST_SESSION_UNAVAILABLE");
    const badges = await db.select().from(guestTasteBadges).where(eq(guestTasteBadges.sessionId, merged.id));
    expect(badges).toEqual([]);
  });
});
