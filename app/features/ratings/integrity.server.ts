import { and, eq, gte, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, integrityCases, invalidatedVoteEvents, places, users, voteEvents } from "../../db/schema";
import { enqueueRatingRecompute, markRatingStale } from "./recompute.server";

type CaseStatus = "OPEN" | "REVIEWING" | "DISMISSED" | "CONFIRMED";

function before(iso: string, milliseconds: number) {
  return new Date(new Date(iso).getTime() - milliseconds).toISOString();
}

export async function scanVoteIntegrity(db: AppDb, input: { now: string }) {
  const since24h = before(input.now, 24 * 60 * 60 * 1000);
  const since10m = before(input.now, 10 * 60 * 1000);
  const events = await db.select().from(voteEvents).where(gte(voteEvents.createdAt, since24h)).limit(5000);
  const userIds = [...new Set(events.map((event) => event.userId))];
  const userRows = userIds.length ? await db.select().from(users).where(inArray(users.id, userIds)) : [];
  const userById = new Map(userRows.map((user) => [user.id, user]));
  const placeIds = [...new Set(events.map((event) => event.placeId))];
  const placeRows = placeIds.length ? await db.select().from(places).where(inArray(places.id, placeIds)) : [];
  const placeById = new Map(placeRows.map((place) => [place.id, place]));
  const candidates: Array<{ signalType: string; subjectType: "USER" | "PLACE"; subjectId: string; evidence: unknown }> = [];

  const recentByUser = new Map<string, typeof events>();
  const recentByPlace = new Map<string, typeof events>();
  const changesByUserPlace = new Map<string, typeof events>();
  for (const event of events) {
    if (event.createdAt >= since10m) {
      recentByUser.set(event.userId, [...(recentByUser.get(event.userId) ?? []), event]);
      recentByPlace.set(event.placeId, [...(recentByPlace.get(event.placeId) ?? []), event]);
    }
    if (event.eventType === "CHANGE") {
      const key = `${event.userId}:${event.placeId}`;
      changesByUserPlace.set(key, [...(changesByUserPlace.get(key) ?? []), event]);
    }
  }
  for (const [userId, userEvents] of recentByUser) {
    const user = userById.get(userId);
    if (user && new Date(input.now).getTime() - new Date(user.createdAt).getTime() <= 24 * 60 * 60 * 1000 && userEvents.length >= 15) {
      candidates.push({ signalType: "NEW_ACCOUNT_VOTE_BURST", subjectType: "USER", subjectId: userId, evidence: { count: userEvents.length, windowMinutes: 10 } });
    }
  }
  for (const [key, changed] of changesByUserPlace) if (changed.length >= 5) {
    candidates.push({ signalType: "REPEATED_VOTE_CHANGE", subjectType: "USER", subjectId: key.split(":")[0], evidence: { placeId: key.slice(key.indexOf(":") + 1), count: changed.length, windowHours: 24 } });
  }
  for (const [placeId, placeEvents] of recentByPlace) if (placeEvents.length >= 20) {
    candidates.push({ signalType: "PLACE_VOTE_BURST", subjectType: "PLACE", subjectId: placeId, evidence: { count: placeEvents.length, windowMinutes: 10 } });
  }
  const hiddenCounts = new Map<string, number>();
  for (const event of events) if (placeById.get(event.placeId)?.status !== "PUBLISHED") hiddenCounts.set(event.placeId, (hiddenCounts.get(event.placeId) ?? 0) + 1);
  for (const [placeId, count] of hiddenCounts) if (count >= 3) candidates.push({ signalType: "HIDDEN_PLACE_VOTES", subjectType: "PLACE", subjectId: placeId, evidence: { count, windowHours: 24 } });

  let created = 0;
  const day = input.now.slice(0, 10);
  for (const candidate of candidates) {
    const dedupeKey = `${candidate.signalType}:${candidate.subjectId}:${day}`;
    const existing = await db.query.integrityCases.findFirst({ where: eq(integrityCases.dedupeKey, dedupeKey) });
    if (existing) continue;
    await db.insert(integrityCases).values({ id: crypto.randomUUID(), signalType: candidate.signalType, subjectType: candidate.subjectType, subjectId: candidate.subjectId, dedupeKey, status: "OPEN", evidenceJson: JSON.stringify(candidate.evidence), createdAt: input.now, updatedAt: input.now });
    created += 1;
  }
  return { scannedEvents: events.length, created };
}

export async function transitionIntegrityCase(db: AppDb, input: {
  caseId: string; actorUserId: string; status: CaseStatus; reason: string; now: string;
}) {
  const actor = await db.query.users.findFirst({ where: eq(users.id, input.actorUserId) });
  if (!actor || actor.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  const item = await db.query.integrityCases.findFirst({ where: eq(integrityCases.id, input.caseId) });
  if (!item) throw new Error("INTEGRITY_CASE_NOT_FOUND");
  const allowed = item.status === "OPEN"
    ? ["REVIEWING", "DISMISSED", "CONFIRMED"]
    : item.status === "REVIEWING" ? ["DISMISSED", "CONFIRMED"] : [];
  if (!allowed.includes(input.status)) throw new Error("INVALID_INTEGRITY_TRANSITION");
  if ((input.status === "DISMISSED" || input.status === "CONFIRMED") && !input.reason.trim()) throw new Error("INTEGRITY_REASON_REQUIRED");
  await db.batch([
    db.update(integrityCases).set({ status: input.status, resolutionReason: input.reason.trim() || null, reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(eq(integrityCases.id, input.caseId)),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "TRANSITION_INTEGRITY_CASE", targetType: "INTEGRITY_CASE", targetId: input.caseId, beforeState: JSON.stringify({ status: item.status }), afterState: JSON.stringify({ status: input.status, reason: input.reason.trim() }), createdAt: input.now }),
  ]);
}

export async function invalidateVoteEvent(db: AppDb, input: {
  voteEventId: string; integrityCaseId: string; actorUserId: string; reason: string; now: string;
}) {
  if (!input.reason.trim()) throw new Error("INVALIDATION_REASON_REQUIRED");
  const actor = await db.query.users.findFirst({ where: eq(users.id, input.actorUserId) });
  if (!actor || actor.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  const item = await db.query.integrityCases.findFirst({ where: eq(integrityCases.id, input.integrityCaseId) });
  if (!item || item.status !== "CONFIRMED") throw new Error("CONFIRMED_CASE_REQUIRED");
  const event = await db.query.voteEvents.findFirst({ where: eq(voteEvents.id, input.voteEventId) });
  if (!event) throw new Error("VOTE_EVENT_NOT_FOUND");
  await db.batch([
    db.insert(invalidatedVoteEvents).values({ voteEventId: input.voteEventId, integrityCaseId: input.integrityCaseId, reason: input.reason.trim(), invalidatedBy: input.actorUserId, invalidatedAt: input.now }).onConflictDoNothing(),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "INVALIDATE_VOTE_EVENT", targetType: "VOTE_EVENT", targetId: input.voteEventId, beforeState: null, afterState: JSON.stringify({ integrityCaseId: input.integrityCaseId, reason: input.reason.trim() }), createdAt: input.now }),
  ]);
  await markRatingStale(db, event.placeId, input.now);
  await enqueueRatingRecompute(db, { placeId: event.placeId, reason: "VOTE_INVALIDATED", now: input.now });
}

export async function listIntegrityCases(db: AppDb, status?: CaseStatus) {
  return db.select().from(integrityCases).where(status ? eq(integrityCases.status, status) : undefined);
}
