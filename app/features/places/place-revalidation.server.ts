import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, placeLivenessStates, placeRevalidationCases, placeRevisions, places, users } from "../../db/schema";

const MANUAL_PROTECTION_MS = 90 * 24 * 60 * 60 * 1_000;

type LivenessResolution = "OPEN" | "TEMPORARILY_CLOSED" | "CLOSED" | "MOVED";

export async function enqueueStalePlaceRevalidations(db: AppDb, input: { now: string }) {
  const cutoff = new Date(new Date(input.now).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const targets = await db.select().from(places).where(and(eq(places.status, "PUBLISHED"), or(isNull(places.lastVerifiedAt), lt(places.lastVerifiedAt, cutoff)))).limit(1_000);
  let created = 0;
  for (const place of targets) {
    const existing = await db.query.placeRevalidationCases.findFirst({ where: and(eq(placeRevalidationCases.placeId, place.id), eq(placeRevalidationCases.reasonType, "STALE_90D"), inArray(placeRevalidationCases.status, ["OPEN", "REVIEWING"])) });
    if (existing) continue;
    await db.insert(placeRevalidationCases).values({ id: crypto.randomUUID(), placeId: place.id, reasonType: "STALE_90D", status: "OPEN", evidenceJson: JSON.stringify({ lastVerifiedAt: place.lastVerifiedAt, cutoff }), createdAt: input.now, updatedAt: input.now }); created += 1;
  }
  return { scanned: targets.length, created };
}

export async function resolvePlaceRevalidation(db: AppDb, input: { caseId: string; actorUserId: string; resolution: "KEEP_PUBLISHED" | "KEEP_HIDDEN" | "RESTORE_PUBLISHED"; reason: string; now: string }) {
  const [actor, item] = await Promise.all([db.query.users.findFirst({ where: eq(users.id, input.actorUserId) }), db.query.placeRevalidationCases.findFirst({ where: eq(placeRevalidationCases.id, input.caseId) })]);
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED"); if (!item || !["OPEN", "REVIEWING"].includes(item.status)) throw new Error("REVALIDATION_NOT_REVIEWABLE"); if (!input.reason.trim()) throw new Error("REVIEW_REASON_REQUIRED");
  const place = await db.query.places.findFirst({ where: eq(places.id, item.placeId) }); if (!place) throw new Error("PLACE_NOT_FOUND");
  const status = input.resolution === "KEEP_HIDDEN" ? "HIDDEN" as const : "PUBLISHED" as const;
  const after = { ...place, status, lastVerifiedAt: input.now, closedAt: status === "PUBLISHED" ? null : place.closedAt, updatedAt: input.now };
  await db.batch([
    db.update(places).set(after).where(eq(places.id, place.id)),
    db.update(placeRevalidationCases).set({ status: "RESOLVED", resolution: `${input.resolution}:${input.reason.trim()}`, reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(eq(placeRevalidationCases.id, item.id)),
    db.insert(placeRevisions).values({ id: crypto.randomUUID(), placeId: place.id, actorUserId: input.actorUserId, action: "STATUS_CHANGE", reason: input.reason.trim(), beforeJson: JSON.stringify(place), afterJson: JSON.stringify(after), sourceType: "REVALIDATION_CASE", sourceId: item.id, createdAt: input.now }),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "RESOLVE_PLACE_REVALIDATION", targetType: "PLACE", targetId: place.id, beforeState: JSON.stringify(place), afterState: JSON.stringify(after), createdAt: input.now }),
  ]);
  return after;
}

export async function resolvePlaceLivenessCase(db: AppDb, input: {
  caseId: string;
  actorUserId: string;
  resolution: LivenessResolution;
  reason: string;
  now: string;
  preservePublicationState?: boolean;
}): Promise<void> {
  if (!isLivenessResolution(input.resolution)) throw new Error("INVALID_LIVENESS_RESOLUTION");

  const reason = input.reason.trim();
  if (!reason) throw new Error("REVIEW_REASON_REQUIRED");

  const [actor, item] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, input.actorUserId) }),
    db.query.placeRevalidationCases.findFirst({ where: eq(placeRevalidationCases.id, input.caseId) }),
  ]);
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  if (!item || !["OPEN", "REVIEWING"].includes(item.status)) throw new Error("REVALIDATION_NOT_REVIEWABLE");

  const [place, state] = await Promise.all([
    db.query.places.findFirst({ where: eq(places.id, item.placeId) }),
    db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, item.placeId) }),
  ]);
  if (!place) throw new Error("PLACE_NOT_FOUND");

  const isOpen = input.resolution === "OPEN";
  const protectedUntil = isOpen
    ? new Date(new Date(input.now).getTime() + MANUAL_PROTECTION_MS).toISOString()
    : null;
  const recordedReason = reason;
  const before = {
    place: placeSnapshot(place),
    liveness: state ? livenessSnapshot(state) : null,
  };
  const afterPlace = {
    status: input.preservePublicationState && isOpen ? place.status : isOpen ? "PUBLISHED" as const : "HIDDEN" as const,
    closedAt: isOpen ? null : input.now,
    lastVerifiedAt: isOpen ? input.now : place.lastVerifiedAt,
    updatedAt: input.now,
  };
  if (input.preservePublicationState && afterPlace.status !== place.status) throw new Error("PLACE_ADMIN_PREVIEW_REQUIRED");
  const { status: _publicationStatus, ...preservedPlaceMetadata } = afterPlace;
  const afterLiveness = {
    status: isOpen ? "VERIFIED" as const : "HIDDEN" as const,
    kakaoStatus: state?.kakaoStatus ?? "SKIPPED" as const,
    matchedKakaoPlaceId: state?.matchedKakaoPlaceId ?? null,
    matchScore: state?.matchScore ?? null,
    consecutiveNotFound: isOpen ? 0 : state?.consecutiveNotFound ?? 0,
    firstNotFoundAt: isOpen ? null : state?.firstNotFoundAt ?? null,
    lastMatchedAt: state?.lastMatchedAt ?? null,
    lastCheckedAt: input.now,
    nextCheckAt: protectedUntil ?? new Date(new Date(input.now).getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    recommendationExcluded: !isOpen,
    protectedUntil,
    leaseToken: null,
    leaseExpiresAt: null,
    evidenceJson: state?.evidenceJson ?? "{}",
    updatedAt: input.now,
  };
  const after = {
    place: input.preservePublicationState
      ? { changedFields: preservedPlaceMetadata, publicationState: "PRESERVED" }
      : { ...placeSnapshot(place), ...afterPlace },
    liveness: {
      status: afterLiveness.status,
      kakaoStatus: afterLiveness.kakaoStatus,
      matchScore: afterLiveness.matchScore,
      consecutiveNotFound: afterLiveness.consecutiveNotFound,
      recommendationExcluded: afterLiveness.recommendationExcluded,
      protectedUntil: afterLiveness.protectedUntil,
      lastCheckedAt: afterLiveness.lastCheckedAt,
    },
  };

  await db.batch([
    db.update(places).set(input.preservePublicationState ? preservedPlaceMetadata : afterPlace).where(eq(places.id, place.id)),
    db.insert(placeLivenessStates).values({ placeId: place.id, ...afterLiveness }).onConflictDoUpdate({
      target: placeLivenessStates.placeId,
      set: afterLiveness,
    }),
    db.update(placeRevalidationCases).set({
      status: "RESOLVED",
      resolution: input.resolution,
      reviewedBy: input.actorUserId,
      reviewedAt: input.now,
      updatedAt: input.now,
    }).where(eq(placeRevalidationCases.id, item.id)),
    db.insert(placeRevisions).values({
      id: crypto.randomUUID(),
      placeId: place.id,
      actorUserId: input.actorUserId,
      action: "STATUS_CHANGE",
      reason: recordedReason,
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify(after),
      sourceType: "PLACE_LIVENESS_MANUAL",
      sourceId: item.id,
      createdAt: input.now,
    }),
    db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(),
      actorUserId: input.actorUserId,
      action: "RESOLVE_PLACE_LIVENESS_CASE",
      targetType: "PLACE",
      targetId: place.id,
      beforeState: JSON.stringify(before),
      afterState: JSON.stringify({ resolution: input.resolution, reason: recordedReason, ...after }),
      createdAt: input.now,
    }),
  ]);
}

export async function clearRecommendationExclusions(db: AppDb, input: {
  actorUserId: string;
  reason: string;
  now: string;
}): Promise<{ updated: number }> {
  const actor = await db.query.users.findFirst({ where: eq(users.id, input.actorUserId) });
  if (actor?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  const reason = input.reason.trim();
  if (!reason) throw new Error("REVIEW_REASON_REQUIRED");
  const [updated] = await db.batch([
    db.update(placeLivenessStates).set({
      recommendationExcluded: false,
      updatedAt: input.now,
    }).where(and(
      eq(placeLivenessStates.recommendationExcluded, true),
      eq(placeLivenessStates.status, "SUSPECTED"),
    )).returning({ placeId: placeLivenessStates.placeId }),
    db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(),
      actorUserId: input.actorUserId,
      action: "CLEAR_PLACE_RECOMMENDATION_EXCLUSIONS",
      targetType: "PLACE_LIVENESS",
      targetId: "recommendation-exclusions",
      beforeState: JSON.stringify({ recommendationExcluded: true }),
      afterState: JSON.stringify({ recommendationExcluded: false, reason }),
      createdAt: input.now,
    }),
  ]);
  return { updated: (updated as Array<{ placeId: string }>).length };
}

function isLivenessResolution(value: string): value is LivenessResolution {
  return ["OPEN", "TEMPORARILY_CLOSED", "CLOSED", "MOVED"].includes(value);
}

function placeSnapshot(place: typeof places.$inferSelect) {
  return {
    status: place.status,
    closedAt: place.closedAt,
    lastVerifiedAt: place.lastVerifiedAt,
    updatedAt: place.updatedAt,
  };
}

function livenessSnapshot(state: typeof placeLivenessStates.$inferSelect) {
  return {
    status: state.status,
    kakaoStatus: state.kakaoStatus,
    matchScore: state.matchScore,
    consecutiveNotFound: state.consecutiveNotFound,
    recommendationExcluded: state.recommendationExcluded,
    protectedUntil: state.protectedUntil,
    lastCheckedAt: state.lastCheckedAt,
  };
}
