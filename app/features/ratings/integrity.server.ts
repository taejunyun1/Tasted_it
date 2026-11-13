import { eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../db/client.server";
import { integrityCases, invalidatedVoteEvents, places, users, voteEvents } from "../../db/schema";
import { getActiveRatingConfig } from "./rating-config.server";

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

type IntegrityCase = typeof integrityCases.$inferSelect;
type VoteEvent = typeof voteEvents.$inferSelect;

function assertEventScope(item: Pick<IntegrityCase, "evidenceJson" | "subjectType" | "subjectId">, event: Pick<VoteEvent, "userId" | "placeId">) {
  let evidence: Record<string, unknown>;
  try {
    evidence = JSON.parse(item.evidenceJson);
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) throw new Error();
  } catch {
    throw new Error("INTEGRITY_EVENT_SCOPE_MISMATCH");
  }
  const subjectMatches = item.subjectType === "USER" ? item.subjectId === event.userId
    : item.subjectType === "PLACE" && item.subjectId === event.placeId;
  if (!subjectMatches || ("placeId" in evidence && evidence.placeId !== event.placeId)
    || ("userId" in evidence && evidence.userId !== event.userId)) {
    throw new Error("INTEGRITY_EVENT_SCOPE_MISMATCH");
  }
}

function checkedReason(reason: string, required: boolean) {
  const value = reason.trim();
  if (required && !value) throw new Error("INTEGRITY_REASON_REQUIRED");
  if (value.length > 1000) throw new Error("INTEGRITY_REASON_TOO_LONG");
  return value;
}

export async function transitionIntegrityCase(db: AppDb, input: {
  caseId: string; actorUserId: string; status: CaseStatus; reason: string; now: string;
  expectedUpdatedAt?: string;
}) {
  const actor = await db.query.users.findFirst({ where: eq(users.id, input.actorUserId) });
  if (!actor || actor.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  const item = await db.query.integrityCases.findFirst({ where: eq(integrityCases.id, input.caseId) });
  if (!item) throw new Error("INTEGRITY_CASE_NOT_FOUND");
  if (input.expectedUpdatedAt && item.updatedAt !== input.expectedUpdatedAt) throw new Error("INTEGRITY_CASE_CHANGED");
  const allowed = item.status === "OPEN" ? ["REVIEWING", "DISMISSED", "CONFIRMED"]
    : item.status === "REVIEWING" ? ["DISMISSED", "CONFIRMED"] : [];
  if (!allowed.includes(input.status)) throw new Error("INVALID_INTEGRITY_TRANSITION");
  const reason = checkedReason(input.reason, input.status === "DISMISSED" || input.status === "CONFIRMED");
  // Audit and change share a D1 transaction and the same old-state guard. A second
  // administrator cannot overwrite the first resolution or create a phantom audit.
  const guard = "EXISTS (SELECT 1 FROM users WHERE id=? AND role='ADMIN') AND EXISTS (SELECT 1 FROM integrity_cases WHERE id=? AND status=? AND updated_at=? AND evidence_json=? AND subject_type=? AND subject_id=?)";
  const bindings = [input.actorUserId, item.id, item.status, item.updatedAt, item.evidenceJson, item.subjectType, item.subjectId];
  const results = await db.$client.batch([
    db.$client.prepare(`INSERT INTO admin_audit_logs (id,actor_user_id,action,target_type,target_id,before_state,after_state,created_at) SELECT ?,?,'TRANSITION_INTEGRITY_CASE','INTEGRITY_CASE',?,?,?,? WHERE ${guard}`)
      .bind(crypto.randomUUID(), input.actorUserId, item.id, JSON.stringify({ status: item.status }), JSON.stringify({ status: input.status, reason }), input.now, ...bindings),
    db.$client.prepare(`UPDATE integrity_cases SET status=?,resolution_reason=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=? AND ${guard}`)
      .bind(input.status, reason || null, input.actorUserId, input.now, input.now, item.id, ...bindings),
  ]);
  if (results[1].meta.changes !== 1) throw new Error("INTEGRITY_CASE_CHANGED");
}

export async function invalidateVoteEvent(db: AppDb, input: {
  voteEventId: string; integrityCaseId: string; actorUserId: string; reason: string; now: string;
  expectedUpdatedAt?: string;
}) {
  const actor = await db.query.users.findFirst({ where: eq(users.id, input.actorUserId) });
  if (!actor || actor.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  if (!input.reason.trim()) throw new Error("INVALIDATION_REASON_REQUIRED");
  const reason = checkedReason(input.reason, true);
  const item = await db.query.integrityCases.findFirst({ where: eq(integrityCases.id, input.integrityCaseId) });
  if (!item || item.status !== "CONFIRMED") throw new Error("CONFIRMED_CASE_REQUIRED");
  if (input.expectedUpdatedAt && item.updatedAt !== input.expectedUpdatedAt) throw new Error("INTEGRITY_CASE_CHANGED");
  const event = await db.query.voteEvents.findFirst({ where: eq(voteEvents.id, input.voteEventId) });
  if (!event) throw new Error("VOTE_EVENT_NOT_FOUND");
  assertEventScope(item, event);
  const existing = await db.query.invalidatedVoteEvents.findFirst({ where: eq(invalidatedVoteEvents.voteEventId, event.id) });
  if (existing) {
    if (existing.integrityCaseId !== item.id) throw new Error("VOTE_ALREADY_INVALIDATED");
    return;
  }
  const config = await getActiveRatingConfig(db, input.now);
  const auditId = crypto.randomUUID();
  const guard = "EXISTS (SELECT 1 FROM users WHERE id=? AND role='ADMIN') AND EXISTS (SELECT 1 FROM integrity_cases WHERE id=? AND status='CONFIRMED' AND updated_at=? AND evidence_json=? AND subject_type=? AND subject_id=?) AND EXISTS (SELECT 1 FROM vote_events WHERE id=? AND user_id=? AND place_id=?) AND (SELECT id FROM rating_configs WHERE active_until IS NULL ORDER BY active_from DESC LIMIT 1)=? AND NOT EXISTS (SELECT 1 FROM invalidated_vote_events WHERE vote_event_id=?)";
  const bindings = [input.actorUserId, item.id, item.updatedAt, item.evidenceJson, item.subjectType, item.subjectId, event.id, event.userId, event.placeId, config.id, event.id];
  const results = await db.$client.batch([
    db.$client.prepare(`INSERT INTO admin_audit_logs (id,actor_user_id,action,target_type,target_id,before_state,after_state,created_at) SELECT ?,?,'INVALIDATE_VOTE_EVENT','VOTE_EVENT',?,NULL,?,? WHERE ${guard}`)
      .bind(auditId, input.actorUserId, event.id, JSON.stringify({ integrityCaseId: item.id, reason }), input.now, ...bindings),
    db.$client.prepare(`INSERT INTO invalidated_vote_events (vote_event_id,integrity_case_id,reason,invalidated_by,invalidated_at) SELECT ?,?,?,?,? WHERE ${guard}`)
      .bind(event.id, item.id, reason, input.actorUserId, input.now, ...bindings),
    db.$client.prepare("UPDATE rating_snapshots SET is_stale=1,updated_at=? WHERE place_id=? AND EXISTS (SELECT 1 FROM admin_audit_logs WHERE id=?)")
      .bind(input.now, event.placeId, auditId),
    db.$client.prepare("INSERT INTO rating_recompute_jobs (id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at) SELECT ?,?,?,'PLACE','PENDING','VOTE_INVALIDATED',0,?,? WHERE EXISTS (SELECT 1 FROM admin_audit_logs WHERE id=?) AND NOT EXISTS (SELECT 1 FROM rating_recompute_jobs WHERE place_id=? AND config_id=? AND status IN ('PENDING','RUNNING'))")
      .bind(crypto.randomUUID(), event.placeId, config.id, input.now, input.now, auditId, event.placeId, config.id),
  ]);
  if (results[1].meta.changes !== 1) {
    const prior = await db.query.invalidatedVoteEvents.findFirst({ where: eq(invalidatedVoteEvents.voteEventId, event.id) });
    if (prior?.integrityCaseId === item.id) return;
    throw new Error(prior ? "VOTE_ALREADY_INVALIDATED" : "INTEGRITY_CASE_CHANGED");
  }
}

export async function listIntegrityCases(db: AppDb, status?: CaseStatus) {
  return db.select().from(integrityCases).where(status ? eq(integrityCases.status, status) : undefined);
}

// These snapshots are private server-side operation payloads. The confirmation
// route posts only the operation ID; B02 applies these checks and writes together.
export async function snapshotIntegrityTransition(db: AppDb, input: {
  caseId: string; actorUserId: string; status: CaseStatus; reason: string; now: string;
}) {
  const actor = await db.query.users.findFirst({ where: eq(users.id, input.actorUserId) });
  if (!actor || actor.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  const item = await db.query.integrityCases.findFirst({ where: eq(integrityCases.id, input.caseId) });
  if (!item) throw new Error("INTEGRITY_CASE_NOT_FOUND");
  const allowed = item.status === "OPEN" ? ["REVIEWING", "DISMISSED", "CONFIRMED"]
    : item.status === "REVIEWING" ? ["DISMISSED", "CONFIRMED"] : [];
  if (!allowed.includes(input.status)) throw new Error("INVALID_INTEGRITY_TRANSITION");
  const reason = checkedReason(input.reason, input.status === "CONFIRMED" || input.status === "DISMISSED");
  return { version: 1 as const, item: caseRevision(item), status: input.status, reason };
}

function caseRevision(item: IntegrityCase) {
  return { id: item.id, status: item.status, updatedAt: item.updatedAt, evidenceJson: item.evidenceJson, subjectType: item.subjectType, subjectId: item.subjectId };
}

export type IntegrityTransitionSnapshot = Awaited<ReturnType<typeof snapshotIntegrityTransition>>;
export function buildIntegrityTransitionBatch(database: D1Database, operationId: string, value: unknown, actorUserId: string, now: string) {
  const snapshot = transitionSnapshotSchema.parse(value);
  const { item, status, reason } = snapshot;
  const allowed = item.status === "OPEN" ? ["REVIEWING", "DISMISSED", "CONFIRMED"] : item.status === "REVIEWING" ? ["DISMISSED", "CONFIRMED"] : [];
  if (!allowed.includes(status)) throw new Error("INVALID_INTEGRITY_TRANSITION");
  checkedReason(reason, status === "DISMISSED" || status === "CONFIRMED");
  return {
    checks: [caseCheck(database, operationId, item)],
    statements: [database.prepare("UPDATE integrity_cases SET status=?,resolution_reason=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?")
      .bind(status, reason || null, actorUserId, now, now, item.id)],
    result: { caseId: item.id, status },
  };
}

export async function snapshotVoteInvalidation(db: AppDb, input: {
  voteEventId: string; integrityCaseId: string; actorUserId: string; reason: string; now: string;
}) {
  const actor = await db.query.users.findFirst({ where: eq(users.id, input.actorUserId) });
  if (!actor || actor.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  if (!input.reason.trim()) throw new Error("INVALIDATION_REASON_REQUIRED");
  const reason = checkedReason(input.reason, true);
  const item = await db.query.integrityCases.findFirst({ where: eq(integrityCases.id, input.integrityCaseId) });
  if (!item || item.status !== "CONFIRMED") throw new Error("CONFIRMED_CASE_REQUIRED");
  const event = await db.query.voteEvents.findFirst({ where: eq(voteEvents.id, input.voteEventId) });
  if (!event) throw new Error("VOTE_EVENT_NOT_FOUND");
  assertEventScope(item, event);
  if (await db.query.invalidatedVoteEvents.findFirst({ where: eq(invalidatedVoteEvents.voteEventId, event.id) })) throw new Error("VOTE_ALREADY_INVALIDATED");
  const config = await getActiveRatingConfig(db, input.now);
  return { version: 1 as const, item: caseRevision(item), event: { id: event.id, userId: event.userId, placeId: event.placeId }, configId: config.id, reason };
}

export type VoteInvalidationSnapshot = Awaited<ReturnType<typeof snapshotVoteInvalidation>>;
export function buildVoteInvalidationBatch(database: D1Database, operationId: string, value: unknown, actorUserId: string, now: string) {
  const snapshot = invalidationSnapshotSchema.parse(value);
  const { item, event, configId, reason } = snapshot;
  if (item.status !== "CONFIRMED") throw new Error("CONFIRMED_CASE_REQUIRED");
  assertEventScope(item, event);
  checkedReason(reason, true);
  return {
    checks: [
      caseCheck(database, operationId, item),
      database.prepare("INSERT INTO admin_operation_checks (operation_id,check_name,passed) SELECT ?,'vote',CASE WHEN EXISTS (SELECT 1 FROM vote_events WHERE id=? AND user_id=? AND place_id=?) AND NOT EXISTS (SELECT 1 FROM invalidated_vote_events WHERE vote_event_id=?) AND (SELECT id FROM rating_configs WHERE active_until IS NULL ORDER BY active_from DESC LIMIT 1)=? THEN 1 ELSE 0 END")
        .bind(operationId, event.id, event.userId, event.placeId, event.id, configId),
    ],
    statements: [
      database.prepare("INSERT INTO invalidated_vote_events (vote_event_id,integrity_case_id,reason,invalidated_by,invalidated_at) VALUES (?,?,?,?,?)").bind(event.id, item.id, reason, actorUserId, now),
      database.prepare("UPDATE rating_snapshots SET is_stale=1,updated_at=? WHERE place_id=?").bind(now, event.placeId),
      database.prepare("INSERT INTO rating_recompute_jobs (id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at) SELECT ?,?,?,'PLACE','PENDING','VOTE_INVALIDATED',0,?,? WHERE NOT EXISTS (SELECT 1 FROM rating_recompute_jobs WHERE place_id=? AND config_id=? AND status IN ('PENDING','RUNNING'))")
        .bind(crypto.randomUUID(), event.placeId, configId, now, now, event.placeId, configId),
    ],
    result: { caseId: item.id, voteEventId: event.id, placeId: event.placeId, invalidated: true },
  };
}

const caseRevisionSchema = z.object({
  id: z.string().min(1), status: z.enum(["OPEN", "REVIEWING", "DISMISSED", "CONFIRMED"]), updatedAt: z.string(),
  evidenceJson: z.string(), subjectType: z.enum(["USER", "PLACE", "REVIEWER_CLUSTER"]), subjectId: z.string().min(1),
});
const transitionSnapshotSchema = z.object({ version: z.literal(1), item: caseRevisionSchema, status: z.enum(["REVIEWING", "DISMISSED", "CONFIRMED"]), reason: z.string().max(1000) });
const invalidationSnapshotSchema = z.object({ version: z.literal(1), item: caseRevisionSchema, event: z.object({ id: z.string().min(1), userId: z.string().min(1), placeId: z.string().min(1) }), configId: z.string().min(1), reason: z.string().trim().min(1).max(1000) });
function caseCheck(database: D1Database, operationId: string, item: z.infer<typeof caseRevisionSchema>) {
  return database.prepare("INSERT INTO admin_operation_checks (operation_id,check_name,passed) SELECT ?,'integrity-case',CASE WHEN EXISTS (SELECT 1 FROM integrity_cases WHERE id=? AND status=? AND updated_at=? AND evidence_json=? AND subject_type=? AND subject_id=?) THEN 1 ELSE 0 END")
    .bind(operationId, item.id, item.status, item.updatedAt, item.evidenceJson, item.subjectType, item.subjectId);
}
