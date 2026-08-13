import { and, eq, gt, gte, isNotNull, isNull, lte, max, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { AppDb } from "../../db/client.server";
import {
  adminAuditLogs,
  businessLicenses,
  currentVotes,
  placeLivenessStates,
  placeRevalidationCases,
  placeRevisions,
  places,
  placeSourceLinks,
  reviewerVisitReviews,
  savedPlaces,
} from "../../db/schema";
import type { KakaoLivenessStatus, LivenessDecision, LivenessPlace, LivenessStatus } from "./place-liveness";

const LEASE_MS = 5 * 60 * 1_000;
const NORMAL_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
const RECENT_ACTIVITY_MS = 90 * 24 * 60 * 60 * 1_000;
const AUTO_HIDE_REASON = "AUTOMATED_PLACE_LIVENESS_HIDE";
const AUTO_HIDE_SOURCE = "PLACE_LIVENESS_VERIFICATION";
const AUTO_HIDE_ACTION = "HIDE_PLACE_FOR_LIVENESS";
const AUTO_RECOVERY_REASON = "AUTOMATED_PLACE_LIVENESS_RECOVERY";
const AUTO_RECOVERY_RESOLUTION = "AUTOMATED_PLACE_LIVENESS_MATCHED";
const AUTO_RECOVERY_ACTION = "RESTORE_PLACE_FOR_LIVENESS";

export type LivenessTarget = {
  placeId: string;
  place: LivenessPlace;
  status: LivenessStatus;
  recommendationExcluded: boolean;
  consecutiveNotFound: number;
  firstNotFoundAt: string | null;
  lastCheckedAt: string | null;
  protectedUntil: string | null;
  placeUpdatedAt: string;
  leaseToken: string;
};

export type PlaceLivenessEvidence = {
  reviewerVisitReviewCount: number;
  reviewerPhotoCount: number;
  recentReviewerActivityAt: string | null;
  currentVoteCount: number;
  savedPlaceCount: number;
  recentMemberActivityAt: string | null;
  openBusinessLicenseCount: number;
  recentOpenSourceAt: string | null;
};

export async function claimDuePlaceLivenessTargets(
  db: AppDb,
  input: { now: string; limit: number; leaseToken: string },
): Promise<LivenessTarget[]> {
  const limit = Math.max(0, Math.min(Math.floor(input.limit), 1_000));
  if (limit === 0 || !input.leaseToken.trim()) return [];

  const now = new Date(input.now);
  const normalCheckDueAt = new Date(now.getTime() - NORMAL_CHECK_INTERVAL_MS).toISOString();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
  const leaseAvailable = or(
    isNull(placeLivenessStates.leaseExpiresAt),
    lte(placeLivenessStates.leaseExpiresAt, input.now),
  );
  const stateDue = or(
    isNull(placeLivenessStates.nextCheckAt),
    lte(placeLivenessStates.nextCheckAt, input.now),
  );
  const candidates = await db.select({
    placeId: places.id,
    name: places.name,
    address: places.address,
    latitude: places.latitude,
    longitude: places.longitude,
    phone: places.phone,
    kakaoPlaceId: places.kakaoPlaceId,
    placeUpdatedAt: places.updatedAt,
    status: placeLivenessStates.status,
    recommendationExcluded: placeLivenessStates.recommendationExcluded,
    consecutiveNotFound: placeLivenessStates.consecutiveNotFound,
    firstNotFoundAt: placeLivenessStates.firstNotFoundAt,
    lastCheckedAt: placeLivenessStates.lastCheckedAt,
    protectedUntil: placeLivenessStates.protectedUntil,
  })
    .from(places)
    .leftJoin(placeLivenessStates, eq(placeLivenessStates.placeId, places.id))
    .where(or(
      and(
        eq(places.status, "PUBLISHED"),
        isNull(placeLivenessStates.placeId),
        or(isNull(places.lastVerifiedAt), lte(places.lastVerifiedAt, normalCheckDueAt)),
      ),
      and(
        isNotNull(placeLivenessStates.placeId),
        or(eq(places.status, "PUBLISHED"), eq(placeLivenessStates.status, "HIDDEN")),
        stateDue,
        leaseAvailable,
      ),
    ))
    .limit(limit * 3);

  const claimed: LivenessTarget[] = [];
  for (const candidate of candidates) {
    if (claimed.length >= limit) break;
    const rows = candidate.status === null
      ? await db.insert(placeLivenessStates).values({
        placeId: candidate.placeId,
        leaseToken: input.leaseToken,
        leaseExpiresAt,
        updatedAt: input.now,
      }).onConflictDoNothing().returning({ placeId: placeLivenessStates.placeId })
      : await db.update(placeLivenessStates).set({
        leaseToken: input.leaseToken,
        leaseExpiresAt,
        updatedAt: input.now,
      }).where(and(
        eq(placeLivenessStates.placeId, candidate.placeId),
        stateDue,
        leaseAvailable,
      )).returning({ placeId: placeLivenessStates.placeId });
    if (!rows.length) continue;

    claimed.push({
      placeId: candidate.placeId,
      place: {
        name: candidate.name,
        address: candidate.address,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        phone: candidate.phone,
        kakaoPlaceId: candidate.kakaoPlaceId,
      },
      status: (candidate.status ?? "MONITORING") as LivenessStatus,
      recommendationExcluded: candidate.recommendationExcluded ?? false,
      consecutiveNotFound: candidate.consecutiveNotFound ?? 0,
      firstNotFoundAt: candidate.firstNotFoundAt,
      lastCheckedAt: candidate.lastCheckedAt,
      protectedUntil: candidate.protectedUntil,
      placeUpdatedAt: candidate.placeUpdatedAt,
      leaseToken: input.leaseToken,
    });
  }
  return claimed;
}

export async function loadPlaceLivenessEvidence(
  db: AppDb,
  input: { placeId: string; now: string },
): Promise<PlaceLivenessEvidence> {
  const cutoff = new Date(new Date(input.now).getTime() - RECENT_ACTIVITY_MS).toISOString();
  const [reviewer, votes, saves, openSources] = await Promise.all([
    db.select({
      count: sql<number>`count(*)`,
      photoCount: sql<number>`coalesce(sum(${reviewerVisitReviews.photoCount}), 0)`,
      latestAt: max(reviewerVisitReviews.publishedAt),
    }).from(reviewerVisitReviews).where(and(
      eq(reviewerVisitReviews.placeId, input.placeId),
      gt(reviewerVisitReviews.photoCount, 0),
      gte(reviewerVisitReviews.publishedAt, cutoff),
    )),
    db.select({ count: sql<number>`count(*)`, latestAt: max(currentVotes.updatedAt) })
      .from(currentVotes)
      .where(and(eq(currentVotes.placeId, input.placeId), gte(currentVotes.updatedAt, cutoff))),
    db.select({ count: sql<number>`count(*)`, latestAt: max(savedPlaces.createdAt) })
      .from(savedPlaces)
      .where(and(eq(savedPlaces.placeId, input.placeId), gte(savedPlaces.createdAt, cutoff))),
    db.select({ count: sql<number>`count(*)`, latestAt: max(businessLicenses.lastSeenAt) })
      .from(placeSourceLinks)
      .innerJoin(businessLicenses, eq(businessLicenses.id, placeSourceLinks.businessLicenseId))
      .where(and(eq(placeSourceLinks.placeId, input.placeId), eq(businessLicenses.normalizedStatus, "OPEN"))),
  ]);
  const reviewerRow = reviewer[0];
  const voteRow = votes[0];
  const saveRow = saves[0];
  const sourceRow = openSources[0];
  const voteAt = voteRow?.latestAt ?? null;
  const savedAt = saveRow?.latestAt ?? null;

  return {
    reviewerVisitReviewCount: Number(reviewerRow?.count ?? 0),
    reviewerPhotoCount: Number(reviewerRow?.photoCount ?? 0),
    recentReviewerActivityAt: reviewerRow?.latestAt ?? null,
    currentVoteCount: Number(voteRow?.count ?? 0),
    savedPlaceCount: Number(saveRow?.count ?? 0),
    recentMemberActivityAt: latestTimestamp(voteAt, savedAt),
    openBusinessLicenseCount: Number(sourceRow?.count ?? 0),
    recentOpenSourceAt: sourceRow?.latestAt ?? null,
  };
}

export async function applyPlaceLivenessDecision(
  db: AppDb,
  input: { target: LivenessTarget; decision: LivenessDecision; leaseToken: string; now: string },
): Promise<"APPLIED" | "STALE_LEASE"> {
  if (input.target.leaseToken !== input.leaseToken) return "STALE_LEASE";
  const [state, place] = await Promise.all([
    db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, input.target.placeId) }),
    db.query.places.findFirst({ where: eq(places.id, input.target.placeId) }),
  ]);
  if (!state || !place || state.leaseToken !== input.leaseToken || place.updatedAt !== input.target.placeUpdatedAt) {
    return "STALE_LEASE";
  }

  const shouldCreateCase = input.decision.shouldOpenCase || input.decision.shouldHide;
  const firstNotFoundAt = input.decision.kakaoStatus === "MATCHED"
    ? null
    : input.decision.kakaoStatus === "NOT_FOUND"
      && input.decision.consecutiveNotFound > state.consecutiveNotFound
      && state.firstNotFoundAt === null
      ? input.now
      : state.firstNotFoundAt;
  const evidenceJson = JSON.stringify(input.decision.evidence);
  const shouldRecover = input.decision.kakaoStatus === "MATCHED"
    && state.status === "HIDDEN"
    && place.status === "HIDDEN";
  const beforeState = placeStateSnapshot(place);
  const afterState = {
    status: input.decision.shouldHide ? "HIDDEN" as const : shouldRecover ? "PUBLISHED" as const : place.status,
    closedAt: input.decision.shouldHide ? input.now : shouldRecover ? null : place.closedAt,
    lastVerifiedAt: input.decision.kakaoStatus === "MATCHED" ? input.now : place.lastVerifiedAt,
  };
  const commitToken = crypto.randomUUID();
  const committedLease = and(
    eq(placeLivenessStates.placeId, place.id),
    eq(placeLivenessStates.leaseToken, commitToken),
  );
  const committedLeaseExists = sql<boolean>`exists (
    select 1 from ${placeLivenessStates}
    where ${committedLease}
  )`;
  const claimedPlaceVersionExists = sql<boolean>`exists (
    select 1 from ${places}
    where ${places.id} = ${place.id}
      and ${places.updatedAt} = ${input.target.placeUpdatedAt}
  )`;
  const noOpenUnknownCase = sql<boolean>`not exists (
    select 1 from ${placeRevalidationCases}
    where ${placeRevalidationCases.placeId} = ${place.id}
      and ${placeRevalidationCases.reasonType} = 'UNKNOWN'
      and ${placeRevalidationCases.status} in ('OPEN', 'REVIEWING')
  )`;
  const statements: BatchItem<"sqlite">[] = [
    db.update(placeLivenessStates).set({
      leaseToken: commitToken,
      leaseExpiresAt: null,
    }).where(and(
      eq(placeLivenessStates.placeId, place.id),
      eq(placeLivenessStates.leaseToken, input.leaseToken),
      claimedPlaceVersionExists,
    )),
    ...(input.decision.kakaoStatus === "MATCHED" || input.decision.shouldHide
      ? [db.update(places).set({
        status: afterState.status,
        closedAt: afterState.closedAt,
        lastVerifiedAt: afterState.lastVerifiedAt,
        updatedAt: input.now,
      }).where(and(
        eq(places.id, place.id),
        eq(places.updatedAt, input.target.placeUpdatedAt),
        committedLeaseExists,
      ))]
      : []),
    ...(shouldCreateCase
      ? [db.insert(placeRevalidationCases).select(
        db.select({
          id: sql<string>`${crypto.randomUUID()}`.as("id"),
          placeId: sql<string>`${place.id}`.as("place_id"),
          reasonType: sql<"UNKNOWN">`'UNKNOWN'`.as("reason_type"),
          status: sql<"OPEN">`'OPEN'`.as("status"),
          evidenceJson: sql<string>`${JSON.stringify({
            source: AUTO_HIDE_SOURCE,
            kakaoStatus: input.decision.kakaoStatus,
            consecutiveNotFound: input.decision.consecutiveNotFound,
            evidence: input.decision.evidence,
          })}`.as("evidence_json"),
          resolution: sql<null>`null`.as("resolution"),
          reviewedBy: sql<null>`null`.as("reviewed_by"),
          reviewedAt: sql<null>`null`.as("reviewed_at"),
          createdAt: sql<string>`${input.now}`.as("created_at"),
          updatedAt: sql<string>`${input.now}`.as("updated_at"),
        }).from(placeLivenessStates).where(and(committedLease, noOpenUnknownCase)),
      )]
      : []),
    ...(shouldRecover
      ? [db.update(placeRevalidationCases).set({
        status: "RESOLVED",
        resolution: AUTO_RECOVERY_RESOLUTION,
        reviewedBy: null,
        reviewedAt: input.now,
        updatedAt: input.now,
      }).where(and(
        eq(placeRevalidationCases.placeId, place.id),
        eq(placeRevalidationCases.reasonType, "UNKNOWN"),
        or(eq(placeRevalidationCases.status, "OPEN"), eq(placeRevalidationCases.status, "REVIEWING")),
        committedLeaseExists,
      ))]
      : []),
    ...(input.decision.shouldHide
      ? [
        db.insert(placeRevisions).select(
          db.select({
            id: sql<string>`${crypto.randomUUID()}`.as("id"),
            placeId: sql<string>`${place.id}`.as("place_id"),
            actorUserId: sql<null>`null`.as("actor_user_id"),
            action: sql<"STATUS_CHANGE">`'STATUS_CHANGE'`.as("action"),
            reason: sql<string>`${AUTO_HIDE_REASON}`.as("reason"),
            beforeJson: sql<string>`${JSON.stringify(beforeState)}`.as("before_json"),
            afterJson: sql<string>`${JSON.stringify(afterState)}`.as("after_json"),
            sourceType: sql<string>`${AUTO_HIDE_SOURCE}`.as("source_type"),
            sourceId: sql<null>`null`.as("source_id"),
            createdAt: sql<string>`${input.now}`.as("created_at"),
          }).from(placeLivenessStates).where(committedLease),
        ),
        db.insert(adminAuditLogs).select(
          db.select({
            id: sql<string>`${crypto.randomUUID()}`.as("id"),
            actorUserId: sql<null>`null`.as("actor_user_id"),
            action: sql<string>`${AUTO_HIDE_ACTION}`.as("action"),
            targetType: sql<"PLACE">`'PLACE'`.as("target_type"),
            targetId: sql<string>`${place.id}`.as("target_id"),
            beforeState: sql<string>`${JSON.stringify(beforeState)}`.as("before_state"),
            afterState: sql<string>`${JSON.stringify(afterState)}`.as("after_state"),
            createdAt: sql<string>`${input.now}`.as("created_at"),
          }).from(placeLivenessStates).where(committedLease),
        ),
      ]
      : []),
    ...(shouldRecover
      ? [
        db.insert(placeRevisions).select(
          db.select({
            id: sql<string>`${crypto.randomUUID()}`.as("id"),
            placeId: sql<string>`${place.id}`.as("place_id"),
            actorUserId: sql<null>`null`.as("actor_user_id"),
            action: sql<"STATUS_CHANGE">`'STATUS_CHANGE'`.as("action"),
            reason: sql<string>`${AUTO_RECOVERY_REASON}`.as("reason"),
            beforeJson: sql<string>`${JSON.stringify(beforeState)}`.as("before_json"),
            afterJson: sql<string>`${JSON.stringify(afterState)}`.as("after_json"),
            sourceType: sql<string>`${AUTO_HIDE_SOURCE}`.as("source_type"),
            sourceId: sql<null>`null`.as("source_id"),
            createdAt: sql<string>`${input.now}`.as("created_at"),
          }).from(placeLivenessStates).where(committedLease),
        ),
        db.insert(adminAuditLogs).select(
          db.select({
            id: sql<string>`${crypto.randomUUID()}`.as("id"),
            actorUserId: sql<null>`null`.as("actor_user_id"),
            action: sql<string>`${AUTO_RECOVERY_ACTION}`.as("action"),
            targetType: sql<"PLACE">`'PLACE'`.as("target_type"),
            targetId: sql<string>`${place.id}`.as("target_id"),
            beforeState: sql<string>`${JSON.stringify(beforeState)}`.as("before_state"),
            afterState: sql<string>`${JSON.stringify(afterState)}`.as("after_state"),
            createdAt: sql<string>`${input.now}`.as("created_at"),
          }).from(placeLivenessStates).where(committedLease),
        ),
      ]
      : []),
    db.update(placeLivenessStates).set({
      status: input.decision.status,
      kakaoStatus: input.decision.kakaoStatus as KakaoLivenessStatus,
      matchScore: input.decision.evidence.score.total,
      consecutiveNotFound: input.decision.consecutiveNotFound,
      firstNotFoundAt,
      lastMatchedAt: input.decision.kakaoStatus === "MATCHED" ? input.now : state.lastMatchedAt,
      lastCheckedAt: input.now,
      nextCheckAt: input.decision.nextCheckAt,
      recommendationExcluded: input.decision.recommendationExcluded,
      leaseToken: null,
      leaseExpiresAt: null,
      evidenceJson,
      updatedAt: input.now,
    }).where(committedLease),
  ];
  const [firstStatement, ...remainingStatements] = statements;
  if (!firstStatement) throw new Error("PLACE_LIVENESS_BATCH_EMPTY");
  const [leaseClaim] = await db.batch([firstStatement, ...remainingStatements]);
  return (leaseClaim as { meta?: { changes?: number } } | undefined)?.meta?.changes === 1
    ? "APPLIED"
    : "STALE_LEASE";
}

function latestTimestamp(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

function placeStateSnapshot(place: {
  status: "DRAFT" | "PUBLISHED" | "HIDDEN";
  closedAt: string | null;
  lastVerifiedAt: string | null;
}) {
  return {
    status: place.status,
    closedAt: place.closedAt,
    lastVerifiedAt: place.lastVerifiedAt,
  };
}
