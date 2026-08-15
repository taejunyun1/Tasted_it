import { eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { placeReviewWorkItems } from "../../db/schema";
import { verifyPendingCandidatesWithNaver } from "../candidates/naver-pending-candidate-verification.server";
import type { NaverLocalSearchAdapter } from "../candidates/naver-local-search.server";
import { verifyPlacesLivenessWithNaver } from "./naver-place-liveness.server";
import { advancePlaceReviewWorkItems } from "./place-review-work-items.server";

// NAVER verification performs one external request plus several D1 writes per item.
// Keep this deliberately small to stay below the Cloudflare Worker request resource limit.
export const MAX_NAVER_REVIEW_BATCH_SIZE = 5;

export async function verifyReviewItemsWithNaver(db: AppDb, input: {
  workItemIds: string[];
  actorUserId: string;
  now: string;
  dailyLimit: number;
  adapter: NaverLocalSearchAdapter;
}) {
  const workItemIds = [...new Set(input.workItemIds.filter(Boolean))];
  if (!workItemIds.length || workItemIds.length > MAX_NAVER_REVIEW_BATCH_SIZE) throw new Error("PLACE_REVIEW_BATCH_LIMIT_EXCEEDED");
  const workItems = await db.select().from(placeReviewWorkItems).where(inArray(placeReviewWorkItems.id, workItemIds));
  const eligible = workItems.filter((item) => item.status === "ACTIVE" && item.stage === "NAVER_VERIFICATION");
  const businessIds = eligible.flatMap((item) => item.businessLicenseId ? [item.businessLicenseId] : []);
  const placeIds = eligible.flatMap((item) => item.placeId ? [item.placeId] : []);
  const candidateResult = businessIds.length
    ? await verifyPendingCandidatesWithNaver(db, { candidateIds: businessIds, limit: businessIds.length, now: input.now, dailyLimit: input.dailyLimit, adapter: input.adapter, actorUserId: input.actorUserId })
    : null;
  const placeResult = placeIds.length
    ? await verifyPlacesLivenessWithNaver(db, { placeIds, now: input.now, dailyLimit: input.dailyLimit - (candidateResult?.apiCalls ?? 0), adapter: input.adapter, actorUserId: input.actorUserId })
    : null;
  const versions = Object.fromEntries(eligible.map((item) => [item.id, item.stageVersion]));
  const advancedResult = eligible.length ? await advancePlaceReviewWorkItems(db, {
    workItemIds: eligible.map((item) => item.id), expectedStage: "NAVER_VERIFICATION", expectedVersions: versions, actorUserId: input.actorUserId, now: input.now,
  }) : { advanced: [], skipped: [] };
  const candidateFailed = candidateResult?.failed ?? 0;
  const placeFailed = placeResult?.failed ?? 0;
  return {
    scanned: (candidateResult?.scanned ?? 0) + (placeResult?.scanned ?? 0),
    passed: advancedResult.advanced.length,
    attention: Math.max(0, eligible.length - advancedResult.advanced.length - candidateFailed - placeFailed),
    failed: candidateFailed + placeFailed,
    skipped: advancedResult.skipped,
  };
}

export async function approveManualReviewEvidence(db: AppDb, input: {
  workItemId: string;
  expectedStageVersion: number;
  actorUserId: string;
  reason: string;
  now: string;
}) {
  const reason = input.reason.trim();
  if (reason.length < 20) throw new Error("MANUAL_EVIDENCE_REASON_REQUIRED");
  const result = await advancePlaceReviewWorkItems(db, {
    workItemIds: [input.workItemId], expectedStage: "NAVER_VERIFICATION", expectedVersions: { [input.workItemId]: input.expectedStageVersion }, actorUserId: input.actorUserId, now: input.now, manualEvidenceReason: reason,
  });
  if (!result.advanced.length) throw new Error(result.skipped[0]?.code ?? "NAVER_REVIEW_REQUIRED");
  return { workItemId: input.workItemId, nextStage: "CATEGORY_CONFIRMATION" as const };
}
