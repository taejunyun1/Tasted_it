import { and, eq, getTableColumns, gt, sql, type SQLWrapper } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, placeCorrectionRequests, placeRevisions, places, users } from "../../db/schema";

const TOKEN_TTL_MS = 30 * 60 * 1000;
function newToken() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
async function tokenHash(token: string) { const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)); return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

const correctionTypes = ["INFORMATION", "MOVED", "TEMPORARILY_CLOSED", "CLOSED", "RIGHTS", "OTHER"] as const;
type CorrectionType = (typeof correctionTypes)[number];

export async function createPlaceCorrectionRequest(db: AppDb, input: {
  id: string; placeId: string | null; requesterUserId: string | null; requesterEmail: string; requesterRelation: string;
  requestType: CorrectionType; requestedChanges: Record<string, unknown>; evidenceNote: string | null; now: Date;
}) {
  const email = input.requesterEmail.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("EMAIL_INVALID");
  if (!input.requesterRelation.trim()) throw new Error("REQUESTER_RELATION_REQUIRED");
  if (!correctionTypes.includes(input.requestType)) throw new Error("CORRECTION_TYPE_INVALID");
  const token = newToken(); const now = input.now.toISOString();
  await db.insert(placeCorrectionRequests).values({
    id: input.id, placeId: input.placeId, requesterUserId: input.requesterUserId, requesterEmail: email,
    requesterRelation: input.requesterRelation.trim(), requestType: input.requestType, status: "PENDING_VERIFICATION",
    requestedChangesJson: JSON.stringify(input.requestedChanges), evidenceNote: input.evidenceNote?.trim() || null,
    verificationTokenHash: await tokenHash(token), verificationExpiresAt: new Date(input.now.getTime() + TOKEN_TTL_MS).toISOString(),
    createdAt: now, updatedAt: now,
  });
  return { id: input.id, email, token };
}

export async function verifyPlaceCorrectionRequest(db: AppDb, input: { token: string; now: Date }) {
  const now = input.now.toISOString();
  const verified = await db.update(placeCorrectionRequests).set({ status: "SUBMITTED", verifiedAt: now, verificationTokenHash: null, updatedAt: now }).where(and(
    eq(placeCorrectionRequests.verificationTokenHash, await tokenHash(input.token)),
    eq(placeCorrectionRequests.status, "PENDING_VERIFICATION"), gt(placeCorrectionRequests.verificationExpiresAt, now),
  )).returning({ id: placeCorrectionRequests.id });
  if (verified.length !== 1) throw new Error("CORRECTION_TOKEN_INVALID");
  return verified[0]!;
}

function unchanged(columns: Record<string, SQLWrapper>, row: Record<string, unknown>) {
  return and(...Object.entries(columns).map(([key, column]) => sql`${column} is ${row[key]}`));
}
function currentAdmin(userId: string) {
  return sql`exists (select 1 from users where id=${userId} and role='ADMIN')`;
}
// D1 batches are transactions. A failed CAS must abort the entire batch so a
// request, place, revision and audit can never commit only partially.
function requireOneChanged(db: AppDb) {
  return db.run(sql`SELECT json(CASE WHEN changes()=1 THEN 'true' ELSE 'CORRECTION_CAS_CONFLICT' END)`);
}
async function correctionBatch(db: AppDb, statements: Parameters<AppDb["batch"]>[0]) {
  try { return await db.batch(statements); }
  catch (error) {
    let cause: unknown = error;
    for (let index = 0; index < 4 && cause instanceof Error; index += 1) {
      if (cause.message.includes("malformed JSON")) throw new Error("CORRECTION_NOT_APPLICABLE");
      cause = cause.cause;
    }
    throw error;
  }
}

function allowedChanges(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("CORRECTION_CHANGES_INVALID");
  const input = raw as Record<string, unknown>; const output: Record<string, string | number | null> = {};
  for (const key of ["name", "address", "neighborhood", "phone", "parkingSummary"] as const) if (typeof input[key] === "string" || input[key] === null) output[key] = input[key] as string | null;
  for (const key of ["latitude", "longitude"] as const) if (typeof input[key] === "number" && Number.isFinite(input[key])) output[key] = input[key];
  if (input.status === "HIDDEN" || input.status === "PUBLISHED") output.status = input.status;
  return output;
}

export async function applyPlaceCorrection(db: AppDb, input: { requestId: string; actorUserId: string; reason: string; now: string; preservePublicationState?: boolean }) {
  const [request, actor] = await Promise.all([
    db.query.placeCorrectionRequests.findFirst({ where: eq(placeCorrectionRequests.id, input.requestId) }),
    db.query.users.findFirst({ where: eq(users.id, input.actorUserId) }),
  ]);
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  if (!request || !request.placeId || !["SUBMITTED", "REVIEWING"].includes(request.status)) throw new Error("CORRECTION_NOT_APPLICABLE");
  if (!input.reason.trim()) throw new Error("REVIEW_REASON_REQUIRED");
  const place = await db.query.places.findFirst({ where: eq(places.id, request.placeId) });
  if (!place) throw new Error("PLACE_NOT_FOUND");
  const changes = allowedChanges(JSON.parse(request.requestedChangesJson));
  if (input.preservePublicationState && Object.hasOwn(changes, "status")) throw new Error("PLACE_ADMIN_PREVIEW_REQUIRED");
  if (!request.verifiedAt) throw new Error("CORRECTION_NOT_APPLICABLE");
  if (!Object.keys(changes).length) throw new Error("CORRECTION_CHANGES_EMPTY");
  const after = { ...place, ...changes, closedAt: changes.status === "HIDDEN" && request.requestType === "CLOSED" ? input.now : place.closedAt, updatedAt: input.now };
  if (changes.name || changes.address || changes.neighborhood) after.searchText = `${after.name} ${after.address} ${after.neighborhood}`.toLocaleLowerCase("ko-KR");
  const afterEvidence = input.preservePublicationState
    ? { changedFields: { ...changes, searchText: after.searchText, updatedAt: input.now }, publicationState: "PRESERVED" }
    : after;
  await correctionBatch(db, [
    db.update(placeCorrectionRequests).set({ status: "APPLIED", adminResponse: input.reason.trim(), reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(and(unchanged(getTableColumns(placeCorrectionRequests), request), currentAdmin(input.actorUserId))),
    requireOneChanged(db),
    db.update(places).set({ ...changes, searchText: after.searchText, ...(input.preservePublicationState ? {} : { closedAt: after.closedAt }), updatedAt: input.now }).where(unchanged(getTableColumns(places), place)),
    requireOneChanged(db),
    db.insert(placeRevisions).values({ id: crypto.randomUUID(), placeId: place.id, actorUserId: input.actorUserId, action: "CORRECTION", reason: input.reason.trim(), beforeJson: JSON.stringify(place), afterJson: JSON.stringify(afterEvidence), sourceType: "CORRECTION_REQUEST", sourceId: request.id, createdAt: input.now }),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "APPLY_PLACE_CORRECTION", targetType: "PLACE", targetId: place.id, beforeState: JSON.stringify(place), afterState: JSON.stringify(afterEvidence), createdAt: input.now }),
  ]);
  return after;
}

export async function transitionPlaceCorrection(db: AppDb, input: { requestId: string; actorUserId: string; status: "REVIEWING" | "REJECTED"; reason: string; now: string }) {
  const [actor, request] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, input.actorUserId) }),
    db.query.placeCorrectionRequests.findFirst({ where: eq(placeCorrectionRequests.id, input.requestId) }),
  ]);
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  if (!input.reason.trim()) throw new Error("REVIEW_REASON_REQUIRED");
  if (!request?.verifiedAt || !["SUBMITTED", "REVIEWING"].includes(request.status) || !["REVIEWING", "REJECTED"].includes(input.status)) throw new Error("CORRECTION_NOT_APPLICABLE");
  await correctionBatch(db, [
    db.update(placeCorrectionRequests).set({ status: input.status, adminResponse: input.reason.trim(), reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(and(unchanged(getTableColumns(placeCorrectionRequests), request), currentAdmin(input.actorUserId))),
    requireOneChanged(db),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "TRANSITION_PLACE_CORRECTION", targetType: "CORRECTION_REQUEST", targetId: input.requestId, beforeState: JSON.stringify({ status: request.status, adminResponse: request.adminResponse }), afterState: JSON.stringify({ status: input.status, adminResponse: input.reason.trim() }), createdAt: input.now }),
  ]);
}
