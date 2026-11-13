import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { eq } from "drizzle-orm";
import { adminAuditLogs, currentVotes, integrityCases, invalidatedVoteEvents, places, ratingRecomputeJobs, users, voteEvents } from "../../app/db/schema";
import { buildIntegrityTransitionBatch, buildVoteInvalidationBatch, invalidateVoteEvent, scanVoteIntegrity, snapshotIntegrityTransition, snapshotVoteInvalidation, transitionIntegrityCase } from "../../app/features/ratings/integrity.server";

import { commitAdminOperation, prepareAdminOperation } from "../../app/features/operations/admin-operation.server";

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

  it.each(["USER", "PLACE"] as const)("rejects a vote outside the confirmed %s case", async (subjectType) => {
    const { db, userId, adminId, placeId } = await seed(`integrity-scope-${crypto.randomUUID()}`);
    const eventId = crypto.randomUUID(); const caseId = crypto.randomUUID();
    await db.insert(voteEvents).values({ id: eventId, placeId, userId, value: 1, eventType: "CREATE", createdAt: now });
    await db.insert(integrityCases).values({ id: caseId, signalType: "TEST", subjectType, subjectId: "another-subject", dedupeKey: caseId, status: "CONFIRMED", evidenceJson: "{}", createdAt: now, updatedAt: now });
    await expect(invalidateVoteEvent(db, { voteEventId: eventId, integrityCaseId: caseId, actorUserId: adminId, reason: "검수", now })).rejects.toThrow("INTEGRITY_EVENT_SCOPE_MISMATCH");
    expect(await db.select().from(invalidatedVoteEvents).where(eq(invalidatedVoteEvents.voteEventId, eventId))).toHaveLength(0);
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, eventId))).toHaveLength(0);
  });

  it("keeps a user case narrowed to its evidence place", async () => {
    const { db, userId, adminId, placeId } = await seed(`integrity-narrow-${crypto.randomUUID()}`);
    const eventId = crypto.randomUUID(); const caseId = crypto.randomUUID();
    await db.insert(voteEvents).values({ id: eventId, placeId, userId, value: 1, eventType: "CREATE", createdAt: now });
    await db.insert(integrityCases).values({ id: caseId, signalType: "REPEATED_VOTE_CHANGE", subjectType: "USER", subjectId: userId, dedupeKey: caseId, status: "CONFIRMED", evidenceJson: JSON.stringify({ placeId: "another-place" }), createdAt: now, updatedAt: now });
    await expect(invalidateVoteEvent(db, { voteEventId: eventId, integrityCaseId: caseId, actorUserId: adminId, reason: "검수", now })).rejects.toThrow("INTEGRITY_EVENT_SCOPE_MISMATCH");
  });

  it("does not duplicate an invalidation audit on replay or reassign it to another case", async () => {
    const { db, userId, adminId, placeId } = await seed(`integrity-replay-${crypto.randomUUID()}`);
    const eventId = crypto.randomUUID(); const caseId = crypto.randomUUID(); const otherCase = crypto.randomUUID();
    await db.insert(voteEvents).values({ id: eventId, placeId, userId, value: 1, eventType: "CREATE", createdAt: now });
    await db.insert(integrityCases).values([caseId, otherCase].map((id) => ({ id, signalType: "TEST", subjectType: "USER" as const, subjectId: userId, dedupeKey: id, status: "CONFIRMED" as const, evidenceJson: "{}", createdAt: now, updatedAt: now })));
    const input = { voteEventId: eventId, integrityCaseId: caseId, actorUserId: adminId, reason: "검수", now };
    await invalidateVoteEvent(db, input);
    await invalidateVoteEvent(db, input);
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, eventId))).toHaveLength(1);
    await expect(invalidateVoteEvent(db, { ...input, integrityCaseId: otherCase })).rejects.toThrow("VOTE_ALREADY_INVALIDATED");
  });

  it("allows one terminal transition when administrators race", async () => {
    const { db, adminId } = await seed(`integrity-race-${crypto.randomUUID()}`);
    const caseId = crypto.randomUUID();
    await db.insert(integrityCases).values({ id: caseId, signalType: "TEST", subjectType: "USER", subjectId: "subject", dedupeKey: caseId, status: "OPEN", evidenceJson: "{}", createdAt: now, updatedAt: now });
    const outcomes = await Promise.allSettled([
      transitionIntegrityCase(db, { caseId, actorUserId: adminId, status: "CONFIRMED", reason: "확인", now }),
      transitionIntegrityCase(db, { caseId, actorUserId: adminId, status: "DISMISSED", reason: "해제", now }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, caseId))).toHaveLength(1);
  });
  it("rejects a stale prepared transition inside the operation transaction", async () => {
    const { db, adminId } = await seed(`integrity-prepared-${crypto.randomUUID()}`);
    const caseId = crypto.randomUUID(), sessionId = crypto.randomUUID();
    await db.insert(integrityCases).values({ id: caseId, signalType: "TEST", subjectType: "USER", subjectId: "subject", dedupeKey: caseId, status: "OPEN", evidenceJson: "{}", createdAt: now, updatedAt: now });
    await adminSession(adminId, sessionId);
    const context = { actorUserId: adminId, sessionId, now, kind: "INTEGRITY_CASE_TRANSITION" as const };
    const payload = await snapshotIntegrityTransition(db, { caseId, actorUserId: adminId, status: "CONFIRMED", reason: "확인", now });
    const prepared = await prepareAdminOperation(env.DB, { ...context, payload, summary: { title: "사건 확인", count: 1 } });
    await db.update(integrityCases).set({ evidenceJson: '{"placeId":"changed"}' }).where(eq(integrityCases.id, caseId));
    await expect(commitAdminOperation(env.DB, { ...context, ...prepared }, (op) => buildIntegrityTransitionBatch(env.DB, op.id, op.payload, adminId, now))).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await db.query.integrityCases.findFirst({ where: eq(integrityCases.id, caseId) })).toMatchObject({ status: "OPEN" });
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, prepared.operationId))).toHaveLength(0);
  });

  it("commits the prepared invalidation, queue and one operation receipt together", async () => {
    const { db, userId, adminId, placeId } = await seed(`integrity-operation-${crypto.randomUUID()}`);
    const eventId = crypto.randomUUID(), caseId = crypto.randomUUID(), sessionId = crypto.randomUUID();
    await db.insert(voteEvents).values({ id: eventId, placeId, userId, value: 1, eventType: "CREATE", createdAt: now });
    await db.insert(integrityCases).values({ id: caseId, signalType: "TEST", subjectType: "USER", subjectId: userId, dedupeKey: caseId, status: "CONFIRMED", evidenceJson: JSON.stringify({ placeId }), createdAt: now, updatedAt: now });
    await adminSession(adminId, sessionId);
    const context = { actorUserId: adminId, sessionId, now, kind: "VOTE_INVALIDATE" as const };
    const payload = await snapshotVoteInvalidation(db, { voteEventId: eventId, integrityCaseId: caseId, actorUserId: adminId, reason: "검수", now });
    const prepared = await prepareAdminOperation(env.DB, { ...context, payload, summary: { title: "투표 무효화", count: 1 } });
    const commit = () => commitAdminOperation(env.DB, { ...context, ...prepared }, (op) => buildVoteInvalidationBatch(env.DB, op.id, op.payload, adminId, now));
    expect(await commit()).toMatchObject({ replayed: false });
    expect(await commit()).toMatchObject({ replayed: true });
    expect(await db.query.voteEvents.findFirst({ where: eq(voteEvents.id, eventId) })).toBeDefined();
    expect(await db.query.invalidatedVoteEvents.findFirst({ where: eq(invalidatedVoteEvents.voteEventId, eventId) })).toMatchObject({ integrityCaseId: caseId });
    expect(await db.select().from(ratingRecomputeJobs).where(eq(ratingRecomputeJobs.placeId, placeId))).toHaveLength(1);
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, prepared.operationId))).toHaveLength(1);
  });

});

async function adminSession(adminId: string, sessionId: string) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sessionId, adminId, "2099-01-01T00:00:00.000Z", now),
    env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)").bind(sessionId, adminId, now, "2099-01-01T00:00:00.000Z"),
  ]);
}
