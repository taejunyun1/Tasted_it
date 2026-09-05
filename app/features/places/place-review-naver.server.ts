import { and, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { naverLocalCategoryVerifications, placeLivenessStates, placeReviewWorkItems } from "../../db/schema";
import { verifyPendingCandidatesWithNaver } from "../candidates/naver-pending-candidate-verification.server";
import type { NaverLocalSearchAdapter } from "../candidates/naver-local-search.server";
import { verifyPlacesLivenessWithNaver } from "./naver-place-liveness.server";
import { advancePlaceReviewWorkItems } from "./place-review-work-items.server";
import { enforceReviewDiningExclusion } from "./local-dining-review.server";

// Each item can perform one external request plus several D1 writes. The UI runs up
// to fifty of these as separate, sequential requests so a single Worker never exceeds
// its resource limit.
export const MAX_NAVER_REVIEW_BATCH_SIZE = 1;

export async function verifyReviewItemsWithNaver(db: AppDb, input: {
  workItemIds: string[];
  actorUserId: string;
  now: string;
  dailyLimit?: number;
  adapter: NaverLocalSearchAdapter;
  confidentAdvanceEnabled?: boolean;
}) {
  const workItemIds = [...new Set(input.workItemIds.filter(Boolean))];
  if (!workItemIds.length) throw new Error("PLACE_REVIEW_BATCH_LIMIT_EXCEEDED");
  const batchWorkItemIds = workItemIds.slice(0, MAX_NAVER_REVIEW_BATCH_SIZE);
  const workItems = await db.select().from(placeReviewWorkItems).where(inArray(placeReviewWorkItems.id, batchWorkItemIds));
  const eligible: typeof workItems = [];
  for (const item of workItems.filter((item) => item.status === "ACTIVE" && item.stage === "NAVER_VERIFICATION")) {
    const dining = await enforceReviewDiningExclusion(db, item, input.actorUserId, input.now);
    if (dining.decision.decision !== "EXCLUDE") eligible.push(item);
  }
  const businessIds = eligible.flatMap((item) => item.businessLicenseId ? [item.businessLicenseId] : []);
  const placeIds = eligible.flatMap((item) => item.placeId ? [item.placeId] : []);
  const candidateResult = businessIds.length
    ? await verifyPendingCandidatesWithNaver(db, { candidateIds: businessIds, limit: businessIds.length, now: input.now, dailyLimit: input.dailyLimit, adapter: input.adapter, actorUserId: input.actorUserId })
    : null;
  const placeResult = placeIds.length
    ? await verifyPlacesLivenessWithNaver(db, { placeIds, now: input.now, dailyLimit: input.dailyLimit, adapter: input.adapter, actorUserId: input.actorUserId })
    : null;
  const naverMappings = businessIds.length
    ? await db.select({ businessLicenseId: naverLocalCategoryVerifications.businessLicenseId, categoryId: naverLocalCategoryVerifications.mappedCategoryId, status: naverLocalCategoryVerifications.status })
      .from(naverLocalCategoryVerifications)
      .where(inArray(naverLocalCategoryVerifications.businessLicenseId, businessIds))
    : [];
  const placeMappings = placeIds.length
    ? await db.select({ placeId: placeLivenessStates.placeId, categoryId: placeLivenessStates.naverMappedCategoryId, status: placeLivenessStates.naverStatus })
      .from(placeLivenessStates).where(inArray(placeLivenessStates.placeId, placeIds))
    : [];
  const categoryByBusinessId = new Map(naverMappings.flatMap((item) => item.status === "VERIFIED" && item.categoryId ? [[item.businessLicenseId, item.categoryId] as const] : []));
  for (const workItem of eligible) {
    const dining = await enforceReviewDiningExclusion(db, workItem, input.actorUserId, input.now);
    if (dining.decision.decision === "EXCLUDE" || (workItem.businessLicenseId && !dining.candidateFresh) || workItem.selectedCategoryId) continue;
    const categoryId = workItem.businessLicenseId ? categoryByBusinessId.get(workItem.businessLicenseId) : placeMappings.find((item) => item.placeId === workItem.placeId && item.status === "MATCHED")?.categoryId ?? null;
    if (!categoryId) continue;
    await db.update(placeReviewWorkItems).set({ selectedCategoryId: categoryId, categoryOverrideReason: null, updatedAt: input.now })
      .where(and(
        eq(placeReviewWorkItems.id, workItem.id),
        eq(placeReviewWorkItems.stage, "NAVER_VERIFICATION"),
        eq(placeReviewWorkItems.stageVersion, workItem.stageVersion),
        eq(placeReviewWorkItems.status, "ACTIVE"),
      ));
  }
  const versions = Object.fromEntries(eligible.map((item) => [item.id, item.stageVersion]));
  const advancedResult = eligible.length ? await advancePlaceReviewWorkItems(db, {
    workItemIds: eligible.map((item) => item.id), expectedStage: "NAVER_VERIFICATION", expectedVersions: versions, actorUserId: input.actorUserId, now: input.now, confidentAdvanceEnabled: input.confidentAdvanceEnabled,
  }) : { advanced: [], skipped: [] };
  const candidateFailed = candidateResult?.failed ?? 0;
  const placeFailed = placeResult?.failed ?? 0;
  return {
    scanned: (candidateResult?.scanned ?? 0) + (placeResult?.scanned ?? 0),
    passed: advancedResult.advanced.length,
    attention: Math.max(0, eligible.length - advancedResult.advanced.length - candidateFailed - placeFailed),
    failed: candidateFailed + placeFailed,
    skipped: advancedResult.skipped,
    processedWorkItemIds: batchWorkItemIds,
    deferred: workItemIds.length - batchWorkItemIds.length,
  };
}

export async function approveManualReviewEvidence(db: AppDb, input: {
  workItemId: string;
  expectedStageVersion: number;
  actorUserId: string;
  reason: string;
  now: string;
  confidentAdvanceEnabled?: boolean;
}) {
  const reason = input.reason.trim();
  if (reason.length < 20) throw new Error("MANUAL_EVIDENCE_REASON_REQUIRED");
  const result = await advancePlaceReviewWorkItems(db, {
    workItemIds: [input.workItemId], expectedStage: "NAVER_VERIFICATION", expectedVersions: { [input.workItemId]: input.expectedStageVersion }, actorUserId: input.actorUserId, now: input.now, manualEvidenceReason: reason, confidentAdvanceEnabled: input.confidentAdvanceEnabled,
  });
  if (!result.advanced.length) throw new Error(result.skipped[0]?.code ?? "NAVER_REVIEW_REQUIRED");
  return { workItemId: input.workItemId, nextStage: "CATEGORY_CONFIRMATION" as const };
}
