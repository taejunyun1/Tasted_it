import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, currentVotes, integrityCases, invalidatedVoteEvents, places, ratingRecomputeJobs, users, voteEvents } from "../../app/db/schema";
import { invalidateVoteEvent, scanVoteIntegrity, transitionIntegrityCase } from "../../app/features/ratings/integrity.server";

const now = "2026-08-06T12:00:00.000Z";

async function seed(prefix: string) {
  const db = createDb(env.DB);
  const userId = `${prefix}-user`; const adminId = `${prefix}-admin`; const placeId = `${prefix}-place`;
  await db.insert(users).values([
    { id: userId, email: `${userId}@example.com`, displayName: userId, role: "USER", createdAt: "2026-08-06T11:55:00.000Z", updatedAt: now },
    { id: adminId, email: `${adminId}@example.com`, displayName: adminId, role: "ADMIN", createdAt: now, updatedAt: now },
  ]);
  await db.insert(places).values({ id: placeId, slug: placeId, name: placeId, status: "PUBLISHED", address: "광주 동구", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: placeId, createdAt: now, updatedAt: now });
  return { db, userId, adminId, placeId };
}

describe("rating integrity", () => {
  it("opens one deduplicated case for a new-account vote burst", async () => {
    const { db, userId } = await seed(`integrity-burst-${crypto.randomUUID()}`);
    for (let index = 0; index < 15; index += 1) {
      const placeId = `integrity-burst-place-${crypto.randomUUID()}`;
      await db.insert(places).values({ id: placeId, slug: placeId, name: placeId, status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: placeId, createdAt: now, updatedAt: now });
      await db.insert(voteEvents).values({ id: crypto.randomUUID(), placeId, userId, value: 1, eventType: "CREATE", createdAt: `2026-08-06T11:5${index % 10}:00.000Z` });
    }
    expect(await scanVoteIntegrity(db, { now })).toMatchObject({ created: 1 });
    expect(await scanVoteIntegrity(db, { now })).toMatchObject({ created: 0 });
    const cases = await db.select().from(integrityCases);
    expect(cases.find((item) => item.subjectId === userId)).toMatchObject({ signalType: "NEW_ACCOUNT_VOTE_BURST", status: "OPEN" });
  });

  it("requires a reason for terminal transitions and writes an audit log", async () => {
    const { db, adminId } = await seed(`integrity-transition-${crypto.randomUUID()}`);
    const caseId = crypto.randomUUID();
    await db.insert(integrityCases).values({ id: caseId, signalType: "TEST", subjectType: "USER", subjectId: "subject", dedupeKey: caseId, status: "OPEN", evidenceJson: "{}", createdAt: now, updatedAt: now });
    await expect(transitionIntegrityCase(db, { caseId, actorUserId: adminId, status: "CONFIRMED", reason: "", now })).rejects.toThrow("INTEGRITY_REASON_REQUIRED");
    await transitionIntegrityCase(db, { caseId, actorUserId: adminId, status: "CONFIRMED", reason: "자동화된 투표 확인", now });
    expect((await db.select().from(integrityCases)).find((item) => item.id === caseId)?.status).toBe("CONFIRMED");
    expect((await db.select().from(adminAuditLogs)).some((item) => item.targetId === caseId)).toBe(true);
  });

  it("invalidates without deleting the raw event and queues recomputation", async () => {
    const { db, userId, adminId, placeId } = await seed(`integrity-invalidate-${crypto.randomUUID()}`);
    const eventId = crypto.randomUUID(); const caseId = crypto.randomUUID();
    await db.insert(voteEvents).values({ id: eventId, placeId, userId, value: 1, eventType: "CREATE", createdAt: now });
    await db.insert(currentVotes).values({ placeId, userId, eventId, value: 1, updatedAt: now });
    await db.insert(integrityCases).values({ id: caseId, signalType: "TEST", subjectType: "USER", subjectId: userId, dedupeKey: caseId, status: "CONFIRMED", evidenceJson: "{}", resolutionReason: "확인", reviewedBy: adminId, reviewedAt: now, createdAt: now, updatedAt: now });
    await invalidateVoteEvent(db, { voteEventId: eventId, integrityCaseId: caseId, actorUserId: adminId, reason: "조작 투표", now });
    expect((await db.select().from(voteEvents)).some((event) => event.id === eventId)).toBe(true);
    expect((await db.select().from(invalidatedVoteEvents)).some((event) => event.voteEventId === eventId)).toBe(true);
    expect((await db.select().from(ratingRecomputeJobs)).some((job) => job.placeId === placeId && job.status === "PENDING")).toBe(true);
  });
});
