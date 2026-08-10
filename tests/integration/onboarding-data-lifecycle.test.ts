import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import {
  guestTasteBadges,
  guestTasteSessions,
  productEvents,
} from "../../app/db/schema";
import {
  PRODUCT_EVENT_RETENTION_DAYS,
  purgeExpiredOnboardingData,
  runScheduledOnboardingDataLifecycle,
} from "../../app/features/onboarding/data-lifecycle.server";

describe("onboarding data lifecycle", () => {
  it("purges expired guest state by cascade and deletes product events after 30 days", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const expiredSessionId = `lifecycle-expired-${suffix}`;
    const activeSessionId = `lifecycle-active-${suffix}`;
    expect(PRODUCT_EVENT_RETENTION_DAYS).toBe(30);
    await db.insert(guestTasteSessions).values([
      {
        id: expiredSessionId,
        locationMode: "DEFAULT",
        completedStepsJson: "[]",
        expiresAt: "2026-08-09T00:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
      {
        id: activeSessionId,
        locationMode: "DEFAULT",
        completedStepsJson: "[]",
        expiresAt: "2026-09-09T00:00:00.000Z",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
    await db.insert(guestTasteBadges).values([
      { sessionId: expiredSessionId, badgeId: "food-gukbap", selectedAt: "2026-07-01T00:00:00.000Z" },
      { sessionId: activeSessionId, badgeId: "food-ramen", selectedAt: "2026-08-01T00:00:00.000Z" },
    ]);
    const oldEventId = crypto.randomUUID();
    const recentEventId = crypto.randomUUID();
    await db.insert(productEvents).values([
      {
        id: oldEventId,
        guestSessionId: activeSessionId,
        eventName: "ONBOARDING_STEP_COMPLETED",
        metadataJson: "{}",
        occurredAt: "2026-07-10T23:59:59.999Z",
      },
      {
        id: recentEventId,
        guestSessionId: expiredSessionId,
        eventName: "ONBOARDING_STEP_COMPLETED",
        metadataJson: "{}",
        occurredAt: "2026-08-01T00:00:00.000Z",
      },
    ]);

    const result = await purgeExpiredOnboardingData(db, { now: "2026-08-10T00:00:00.000Z" });

    expect(result).toEqual({ guestSessions: 1, productEvents: 1 });
    await expect(db.select().from(guestTasteSessions).where(eq(guestTasteSessions.id, expiredSessionId)))
      .resolves.toEqual([]);
    await expect(db.select().from(guestTasteBadges).where(eq(guestTasteBadges.sessionId, expiredSessionId)))
      .resolves.toEqual([]);
    await expect(db.select().from(guestTasteBadges).where(eq(guestTasteBadges.sessionId, activeSessionId)))
      .resolves.toHaveLength(1);
    await expect(db.select().from(productEvents).where(eq(productEvents.id, oldEventId)))
      .resolves.toEqual([]);
    await expect(db.select().from(productEvents).where(eq(productEvents.id, recentEventId)))
      .resolves.toEqual([expect.objectContaining({ id: recentEventId, guestSessionId: null })]);
  });

  it("runs the same deterministic purge through the scheduled entry point", async () => {
    const db = createDb(env.DB);
    const sessionId = `lifecycle-scheduled-${crypto.randomUUID()}`;
    await db.insert(guestTasteSessions).values({
      id: sessionId,
      locationMode: "DEFAULT",
      completedStepsJson: "[]",
      expiresAt: "2026-08-09T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(runScheduledOnboardingDataLifecycle(env, { now: "2026-08-10T00:00:00.000Z" }))
      .resolves.toMatchObject({ guestSessions: 1 });
    await expect(db.select().from(guestTasteSessions).where(eq(guestTasteSessions.id, sessionId)))
      .resolves.toEqual([]);
  });
});
