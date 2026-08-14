import { desc, lte } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  currentVotes,
  goldenPickEvents,
  guestTasteSessions,
  invalidatedVoteEvents,
  placeLivenessStates,
  productEvents,
  reviewerVisitPhotos,
  reviewerVisitReviews,
  voteEvents,
} from "../../db/schema";
import {
  AUDIT_VERSION,
  checkGoldenPickLedger,
  checkPhotoMetadata,
  checkRecommendationEligibility,
  checkRetention,
  checkVoteLedger,
  summarizeFindings,
} from "./record-audit";
import type { RecordAuditReport } from "./record-audit.types";

const DEFAULT_MAX_ROWS = 500;

async function readCapped<T>(
  label: string,
  query: Promise<T[]>,
  maxRows: number,
  caps: string[],
): Promise<T[]> {
  const rows = await query;
  if (rows.length > maxRows) caps.push(label);
  return rows.slice(0, maxRows);
}

function retentionCutoff(now: string): string {
  return new Date(new Date(now).getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
}

export async function runRecordAudit(
  db: AppDb,
  input: { now: string; sourceCommit: string; maxRows?: number },
): Promise<RecordAuditReport> {
  const maxRows = Math.min(Math.max(input.maxRows ?? DEFAULT_MAX_ROWS, 1), DEFAULT_MAX_ROWS);
  const caps: string[] = [];
  const cutoff = retentionCutoff(input.now);

  const [votes, events, invalidations, reviews, photos, goldenEvents, guestSessions, productEventRows, liveness] = await Promise.all([
    readCapped("currentVotes", db.select({
      eventId: currentVotes.eventId,
      placeId: currentVotes.placeId,
      userId: currentVotes.userId,
      value: currentVotes.value,
    }).from(currentVotes).limit(maxRows + 1), maxRows, caps),
    readCapped("voteEvents", db.select({
      id: voteEvents.id,
      placeId: voteEvents.placeId,
      userId: voteEvents.userId,
      value: voteEvents.value,
      createdAt: voteEvents.createdAt,
    }).from(voteEvents).orderBy(desc(voteEvents.createdAt)).limit(maxRows + 1), maxRows, caps),
    readCapped("invalidatedVoteEvents", db.select({ voteEventId: invalidatedVoteEvents.voteEventId })
      .from(invalidatedVoteEvents).limit(maxRows + 1), maxRows, caps),
    readCapped("reviewerVisitReviews", db.select({ id: reviewerVisitReviews.id, photoCount: reviewerVisitReviews.photoCount })
      .from(reviewerVisitReviews).orderBy(desc(reviewerVisitReviews.publishedAt)).limit(maxRows + 1), maxRows, caps),
    readCapped("reviewerVisitPhotos", db.select({
      id: reviewerVisitPhotos.id,
      reviewId: reviewerVisitPhotos.reviewId,
      position: reviewerVisitPhotos.position,
      byteSize: reviewerVisitPhotos.byteSize,
    }).from(reviewerVisitPhotos).limit(maxRows + 1), maxRows, caps),
    readCapped("goldenPickEvents", db.select({
      id: goldenPickEvents.id,
      placeId: goldenPickEvents.placeId,
      reviewerUserId: goldenPickEvents.reviewerUserId,
      eventType: goldenPickEvents.eventType,
      previousEventId: goldenPickEvents.previousEventId,
      expiresAt: goldenPickEvents.expiresAt,
      effectiveAt: goldenPickEvents.effectiveAt,
    }).from(goldenPickEvents).orderBy(desc(goldenPickEvents.effectiveAt)).limit(maxRows + 1), maxRows, caps),
    readCapped("guestTasteSessions", db.select({ id: guestTasteSessions.id })
      .from(guestTasteSessions).where(lte(guestTasteSessions.expiresAt, input.now)).limit(maxRows + 1), maxRows, caps),
    readCapped("productEvents", db.select({ id: productEvents.id })
      .from(productEvents).where(lte(productEvents.occurredAt, cutoff)).limit(maxRows + 1), maxRows, caps),
    readCapped("placeLivenessStates", db.select({
      placeId: placeLivenessStates.placeId,
      status: placeLivenessStates.status,
      recommendationExcluded: placeLivenessStates.recommendationExcluded,
    }).from(placeLivenessStates).orderBy(desc(placeLivenessStates.updatedAt)).limit(maxRows + 1), maxRows, caps),
  ]);

  const findings = [
    ...checkVoteLedger({
      events,
      currentVotes: votes,
      invalidatedEventIds: new Set(invalidations.map((row) => row.voteEventId)),
    }),
    ...checkPhotoMetadata({ reviews, photos }),
    ...checkGoldenPickLedger({ now: input.now, events: goldenEvents }),
    ...checkRetention({
      expiredGuestSessionIds: guestSessions.map((row) => row.id),
      expiredProductEventIds: productEventRows.map((row) => row.id),
    }),
    ...checkRecommendationEligibility(liveness),
  ].map((finding) => ({ ...finding, isIncomplete: caps.length > 0 }));

  return {
    version: AUDIT_VERSION,
    generatedAt: input.now,
    dataWindow: { from: cutoff, to: input.now },
    sourceCommit: input.sourceCommit,
    queryCapsReached: caps,
    findings,
    summary: summarizeFindings(findings),
  };
}
