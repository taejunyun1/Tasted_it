import { lt, lte } from "drizzle-orm";

import { createDb, type AppDb } from "../../db/client.server";
import { guestTasteSessions, productEvents, rateLimitWindows } from "../../db/schema";

export const PRODUCT_EVENT_RETENTION_DAYS = 30;
export const RATE_WINDOW_RETENTION_HOURS = 24;

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
    new Date(Date.parse(input.now) - RATE_WINDOW_RETENTION_HOURS * 3_600_000).toISOString()));

  return {
    guestSessions: deletedGuestSessions.length,
    productEvents: deletedProductEvents.length,
  };
}

export async function runScheduledOnboardingDataLifecycle(env: Env, options?: { now?: string }) {
  const cutoff = options?.now ?? new Date().toISOString();
  let result: Awaited<ReturnType<typeof purgeExpiredOnboardingData>>;
  try { result = await purgeExpiredOnboardingData(createDb(env.DB), { now: cutoff }); }
  catch (error) {
    await recordLifecycleResult(env.DB, cutoff, null);
    throw error;
  }
  await recordLifecycleResult(env.DB, cutoff, result);
  return result;
}

async function recordLifecycleResult(database: D1Database, cutoff: string,
  result: Awaited<ReturnType<typeof purgeExpiredOnboardingData>> | null) {
  const outcome = result ? "COMPLETED" : "PARTIAL_OR_UNKNOWN";
  try {
    const saved = await database.prepare(`INSERT INTO admin_audit_logs
      (id,actor_user_id,action,target_type,target_id,after_state,created_at)
      VALUES(?,NULL,'ONBOARDING_DATA_LIFECYCLE','LIFECYCLE','onboarding',?,?)`)
      .bind(crypto.randomUUID(), JSON.stringify({ version: 1, status: outcome, cutoff,
        guestSessions: result?.guestSessions ?? null, productEvents: result?.productEvents ?? null,
        rateWindows: null }), new Date().toISOString()).run();
    if (!saved.success) throw new Error("LIFECYCLE_TELEMETRY_UNAVAILABLE");
  } catch {
    // Observability failure must not turn a completed cleanup into a failed job.
    console.error("ONBOARDING_LIFECYCLE_TELEMETRY_FAILED", { outcome });
  }
}
