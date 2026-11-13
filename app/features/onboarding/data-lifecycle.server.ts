import { lt, lte } from "drizzle-orm";

import { createDb, type AppDb } from "../../db/client.server";
import { guestTasteSessions, productEvents, rateLimitWindows } from "../../db/schema";

export const PRODUCT_EVENT_RETENTION_DAYS = 30;

export async function purgeExpiredOnboardingData(db: AppDb, input: { now: string }) {
  const productEventCutoff = new Date(
    new Date(input.now).getTime() - PRODUCT_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const deletedProductEvents = await db.delete(productEvents)
    .where(lte(productEvents.occurredAt, productEventCutoff))
    .returning({ id: productEvents.id });
  const deletedGuestSessions = await db.delete(guestTasteSessions)
    .where(lte(guestTasteSessions.expiresAt, input.now))
    .returning({ id: guestTasteSessions.id });

  // Existing daily lifecycle also removes expired anonymous/auth rate windows.
  await db.delete(rateLimitWindows).where(lt(rateLimitWindows.windowStartedAt,
    new Date(Date.parse(input.now) - 86_400_000).toISOString()));

  return {
    guestSessions: deletedGuestSessions.length,
    productEvents: deletedProductEvents.length,
  };
}

export async function runScheduledOnboardingDataLifecycle(env: Env, options?: { now?: string }) {
  return purgeExpiredOnboardingData(createDb(env.DB), {
    now: options?.now ?? new Date().toISOString(),
  });
}
