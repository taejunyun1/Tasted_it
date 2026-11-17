import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createDb } from "../../app/db/client.server";
import { currentVotes, operationalAlerts, places, ratingConfigs, ratingRecomputeJobs, ratingSnapshots, users, voteEvents } from "../../app/db/schema";
import { recomputePlaceRating } from "../../app/features/ratings/recompute.server";
import { castVote, withdrawVote } from "../../app/features/ratings/vote.server";

const now = "2026-11-18T00:00:00.000Z";
const withdrawnAt = "2026-11-18T00:01:00.000Z";

async function fixture(userCount = 1) {
  const db = createDb(env.DB), prefix = `config-withdraw-${crypto.randomUUID()}`;
  await db.delete(operationalAlerts).where(eq(operationalAlerts.sourceId, "ACTIVE_RATING_CONFIG_NOT_FOUND"));
  const config = await db.query.ratingConfigs.findFirst({ where: eq(ratingConfigs.id, "rating-config-v2") });
  if (!config) throw new Error("Missing seeded config");
  await db.insert(places).values({ id: prefix, slug: prefix, name: "합성 철회 장소", status: "PUBLISHED", address: "합성 주소", neighborhood: "합성", latitude: 35.1, longitude: 126.9, searchText: prefix, createdAt: now, updatedAt: now });
  const voterIds = Array.from({ length: userCount }, (_, index) => `${prefix}-${index}`);
  for (const id of voterIds) {
    await db.insert(users).values({ id, email: `${id}@example.test`, displayName: "합성 회원", role: "USER", createdAt: now, updatedAt: now });
    await castVote(db, { placeId: prefix, userId: id, value: 1, eventId: `${id}-create`, now });
  }
  await db.delete(ratingRecomputeJobs).where(eq(ratingRecomputeJobs.placeId, prefix));
  const snapshot = await recomputePlaceRating(db, { placeId: prefix, now });
  expect(snapshot.isStale).toBe(false);
  return {
    db, placeId: prefix, voterIds,
    withdraw: (index = 0) => withdrawVote(db, { placeId: prefix, userId: voterIds[index], eventId: `${voterIds[index]}-withdraw`, expectedEventId: `${voterIds[index]}-create`, now: withdrawnAt }),
    restore: () => db.update(ratingConfigs).set({ algorithmVersion: config.algorithmVersion, activeFrom: config.activeFrom, activeUntil: config.activeUntil, updatedAt: config.updatedAt }).where(eq(ratingConfigs.id, config.id)),
  };
}

async function expectCommittedWithdrawal(f: Awaited<ReturnType<typeof fixture>>, index = 0) {
  const id = f.voterIds[index];
  expect(await f.db.query.currentVotes.findFirst({ where: eq(currentVotes.userId, id) })).toBeUndefined();
  expect(await f.db.query.voteEvents.findFirst({ where: eq(voteEvents.id, `${id}-create`) })).toMatchObject({ eventType: "CREATE", value: 1 });
  expect(await f.db.query.voteEvents.findFirst({ where: eq(voteEvents.id, `${id}-withdraw`) })).toMatchObject({ eventType: "WITHDRAW", previousEventId: `${id}-create`, value: 1 });
  expect(await f.db.query.ratingSnapshots.findFirst({ where: eq(ratingSnapshots.placeId, f.placeId) })).toMatchObject({ isStale: true });
  expect(await f.db.query.ratingRecomputeJobs.findMany({ where: eq(ratingRecomputeJobs.placeId, f.placeId) })).toEqual([]);
}

function failureMessages(error: unknown): string {
  if (!(error instanceof Error)) return "";
  return `${error.message}\n${failureMessages(error.cause)}`;
}

describe("vote withdrawal without a current rating config", () => {
  it.each(["future", "unsupported"] as const)("preserves withdrawal and deduplicates a safe alert for a %s config", async (mode) => {
    const f = await fixture(2);
    await f.db.update(ratingConfigs).set(mode === "future" ? { activeFrom: "2090-01-01T00:00:00.000Z" } : { algorithmVersion: "unsupported-withdrawal-fixture" }).where(eq(ratingConfigs.id, "rating-config-v2"));
    try {
      for (let index = 0; index < f.voterIds.length; index += 1) {
        await expect(f.withdraw(index)).resolves.toBe(true);
        await expectCommittedWithdrawal(f, index);
      }
      const alerts = await f.db.query.operationalAlerts.findMany({ where: eq(operationalAlerts.sourceId, "ACTIVE_RATING_CONFIG_NOT_FOUND") });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ alertType: "RATING_RECOMPUTE", status: "OPEN", occurrenceCount: 2, lastOccurredAt: withdrawnAt });
      expect(JSON.parse(alerts[0].detailsJson)).toEqual({ code: "ACTIVE_RATING_CONFIG_NOT_FOUND" });
      expect(alerts[0].message).not.toContain(f.placeId);
    } finally { await f.restore(); }
  });

  it("preserves withdrawal when the selected config becomes ineligible before the enqueue CAS", async () => {
    const f = await fixture();
    const original = f.db.query.ratingConfigs.findFirst.bind(f.db.query.ratingConfigs);
    const selected = vi.spyOn(f.db.query.ratingConfigs, "findFirst").mockImplementationOnce((queryConfig) => {
      const query = original(queryConfig);
      const execute = query.execute.bind(query);
      vi.spyOn(query, "execute").mockImplementationOnce(async () => {
        const config = await execute();
        expect(config?.id).toBe("rating-config-v2");
        await f.db.update(ratingConfigs).set({ activeFrom: "2090-01-01T00:00:00.000Z" }).where(eq(ratingConfigs.id, "rating-config-v2"));
        return config;
      });
      return query;
    });
    try {
      await expect(f.withdraw()).resolves.toBe(true);
      expect(selected).toHaveBeenCalled();
      await expectCommittedWithdrawal(f);
      const alert = await f.db.query.operationalAlerts.findFirst({ where: eq(operationalAlerts.sourceId, "ACTIVE_RATING_CONFIG_NOT_FOUND") });
      expect(alert).toMatchObject({ alertType: "RATING_RECOMPUTE", occurrenceCount: 1, status: "OPEN" });
      expect(JSON.parse(alert!.detailsJson)).toEqual({ code: "RATING_CONFIG_CHANGED" });
    } finally { selected.mockRestore(); await f.restore(); }
  });

  it("propagates an unrelated enqueue storage error after preserving the committed withdrawal", async () => {
    const f = await fixture();
    await env.DB.exec("CREATE TRIGGER reject_withdrawal_enqueue BEFORE INSERT ON rating_recompute_jobs BEGIN SELECT RAISE(ABORT,'fixture enqueue failure'); END;");
    try {
      const failure: unknown = await f.withdraw().catch((error: unknown) => error);
      expect(failureMessages(failure)).toContain("fixture enqueue failure");
      await expectCommittedWithdrawal(f);
      expect(await f.db.query.operationalAlerts.findMany({ where: eq(operationalAlerts.sourceId, "ACTIVE_RATING_CONFIG_NOT_FOUND") })).toEqual([]);
    } finally { await env.DB.exec("DROP TRIGGER reject_withdrawal_enqueue"); }
  });

  it("propagates an alert write failure instead of claiming clean completion", async () => {
    const f = await fixture();
    await f.db.update(ratingConfigs).set({ activeFrom: "2090-01-01T00:00:00.000Z" }).where(eq(ratingConfigs.id, "rating-config-v2"));
    await env.DB.exec("CREATE TRIGGER reject_withdrawal_alert BEFORE INSERT ON operational_alerts WHEN NEW.source_id='ACTIVE_RATING_CONFIG_NOT_FOUND' BEGIN SELECT RAISE(ABORT,'fixture alert failure'); END;");
    try {
      const failure: unknown = await f.withdraw().catch((error: unknown) => error);
      expect(failureMessages(failure)).toContain("fixture alert failure");
      await expectCommittedWithdrawal(f);
      expect(await f.db.query.operationalAlerts.findMany({ where: eq(operationalAlerts.sourceId, "ACTIVE_RATING_CONFIG_NOT_FOUND") })).toEqual([]);
    } finally { await env.DB.exec("DROP TRIGGER reject_withdrawal_alert"); await f.restore(); }
  });
});
