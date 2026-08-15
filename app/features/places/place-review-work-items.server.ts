import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  adminAuditLogs,
  businessLicenseExclusions,
  businessLicenses,
  categories,
  naverLocalCategoryVerifications,
  placeLivenessStates,
  placeReviewWorkItems,
  places,
} from "../../db/schema";
import {
  evaluateReviewAdvance,
  type NaverReviewDecision,
  type ReviewBlockCode,
  type ReviewStage,
} from "./place-review-pipeline";

const MAX_REVIEW_BATCH_SIZE = 25;

export type ReviewSourceKind = "PUBLIC_DATA" | "PLACE_SUGGESTION" | "CATEGORY_RECALL" | "LIVENESS_RECHECK";
export type NewReviewSubject =
  | { businessLicenseId: string; placeId?: never }
  | { placeId: string; businessLicenseId?: never };

type TransitionSkipCode = ReviewBlockCode | "STALE_WORK_ITEM" | "NOT_ACTIVE";
type TransitionResult = { advanced: string[]; skipped: Array<{ workItemId: string; code: TransitionSkipCode }> };
type StateChangeResult = { changed: string[]; skipped: Array<{ workItemId: string; code: "STALE_WORK_ITEM" | "NOT_ACTIVE" }> };

function uniqueWorkItemIds(workItemIds: string[]) {
  const ids = [...new Set(workItemIds.filter(Boolean))];
  if (ids.length > MAX_REVIEW_BATCH_SIZE) throw new Error("PLACE_REVIEW_BATCH_LIMIT_EXCEEDED");
  return ids;
}

export function newReviewWorkItemValues(input: NewReviewSubject & {
  sourceKind: ReviewSourceKind;
  now: string;
}) {
  const subjectId = input.businessLicenseId ?? input.placeId;
  return {
    id: `review:${input.sourceKind.toLowerCase()}:${subjectId}:${input.now}`,
    businessLicenseId: input.businessLicenseId ?? null,
    placeId: input.placeId ?? null,
    sourceKind: input.sourceKind,
    stage: "SOURCE_REVIEW" as const,
    status: "ACTIVE" as const,
    selectedCategoryId: null,
    categoryOverrideReason: null,
    manualEvidenceReason: null,
    stageVersion: 0,
    claimToken: null,
    claimedBy: null,
    claimedAt: null,
    lastTransitionBy: null,
    lastTransitionAt: null,
    holdCode: null,
    holdNote: null,
    completedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export async function createReviewWorkItem(db: AppDb, input: NewReviewSubject & {
  sourceKind: ReviewSourceKind;
  now: string;
}) {
  const values = newReviewWorkItemValues(input);
  await db.insert(placeReviewWorkItems).values(values).onConflictDoNothing();
  return values;
}

function naverDecisionForCandidate(
  status: typeof naverLocalCategoryVerifications.$inferSelect["status"] | null | undefined,
  hasManualEvidence: boolean,
): NaverReviewDecision {
  if (status === "VERIFIED") return "VERIFIED";
  if (status === "FAILED") return "FAILED";
  if (hasManualEvidence) return "MANUAL_OVERRIDE";
  if (status === "LIKELY" || status === "AMBIGUOUS") return "AMBIGUOUS";
  return "NOT_FOUND";
}

function naverDecisionForPlace(
  status: typeof placeLivenessStates.$inferSelect["naverStatus"] | null | undefined,
  hasManualEvidence: boolean,
): NaverReviewDecision {
  if (status === "MATCHED") return "MATCHED";
  if (status === "ERROR") return "FAILED";
  if (hasManualEvidence) return "MANUAL_OVERRIDE";
  if (status === "AMBIGUOUS") return "AMBIGUOUS";
  return "NOT_FOUND";
}

async function reviewEvidence(db: AppDb, workItem: typeof placeReviewWorkItems.$inferSelect, manualEvidenceReason?: string) {
  const hasManualEvidence = Boolean(manualEvidenceReason?.trim() || workItem.manualEvidenceReason?.trim());
  const [businessLicense, place, candidateNaver, placeLiveness, selectedCategory, activeExclusion] = await Promise.all([
    workItem.businessLicenseId
      ? db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, workItem.businessLicenseId) })
      : Promise.resolve(undefined),
    workItem.placeId
      ? db.query.places.findFirst({ where: eq(places.id, workItem.placeId) })
      : Promise.resolve(undefined),
    workItem.businessLicenseId
      ? db.query.naverLocalCategoryVerifications.findFirst({ where: eq(naverLocalCategoryVerifications.businessLicenseId, workItem.businessLicenseId) })
      : Promise.resolve(undefined),
    workItem.placeId
      ? db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, workItem.placeId) })
      : Promise.resolve(undefined),
    workItem.selectedCategoryId
      ? db.query.categories.findFirst({ where: eq(categories.id, workItem.selectedCategoryId) })
      : Promise.resolve(undefined),
    workItem.businessLicenseId
      ? db.query.businessLicenseExclusions.findFirst({ where: and(
        eq(businessLicenseExclusions.businessLicenseId, workItem.businessLicenseId),
        eq(businessLicenseExclusions.status, "ACTIVE"),
      ) })
      : Promise.resolve(undefined),
  ]);
  const sourceReady = businessLicense
    ? businessLicense.normalizedStatus === "OPEN"
      && Boolean(businessLicense.roadAddress ?? businessLicense.lotAddress)
      && businessLicense.latitude != null
      && businessLicense.longitude != null
    : Boolean(place?.address && place.latitude != null && place.longitude != null);

  return {
    sourceReady,
    naverDecision: businessLicense
      ? naverDecisionForCandidate(candidateNaver?.status, hasManualEvidence)
      : naverDecisionForPlace(placeLiveness?.naverStatus, hasManualEvidence),
    selectedCategoryId: workItem.selectedCategoryId,
    categoryActive: Boolean(selectedCategory?.isActive),
    // Duplicate candidates are introduced in the dedicated fourth-stage service.
    // Until then, this value only permits a card already in the stage to wait there.
    openDuplicateCount: 0,
    activeExclusion: Boolean(activeExclusion),
  };
}

export async function advancePlaceReviewWorkItems(db: AppDb, input: {
  workItemIds: string[];
  expectedStage: ReviewStage;
  expectedVersions: Record<string, number>;
  actorUserId: string;
  now: string;
  manualEvidenceReason?: string;
}): Promise<TransitionResult> {
  const workItemIds = uniqueWorkItemIds(input.workItemIds);
  const advanced: string[] = [];
  const skipped: TransitionResult["skipped"] = [];

  for (const workItemId of workItemIds) {
    const workItem = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) });
    if (!workItem || workItem.status !== "ACTIVE") {
      skipped.push({ workItemId, code: "NOT_ACTIVE" });
      continue;
    }
    if (workItem.stage !== input.expectedStage || input.expectedVersions[workItemId] !== workItem.stageVersion) {
      skipped.push({ workItemId, code: "STALE_WORK_ITEM" });
      continue;
    }

    const evidence = await reviewEvidence(db, workItem, input.manualEvidenceReason);
    const result = evaluateReviewAdvance(workItem.stage, evidence);
    if (!result.ok) {
      skipped.push({ workItemId, code: result.code });
      continue;
    }

    const changed = await db.update(placeReviewWorkItems).set({
      stage: result.nextStage,
      stageVersion: workItem.stageVersion + 1,
      manualEvidenceReason: input.manualEvidenceReason?.trim() || workItem.manualEvidenceReason,
      lastTransitionBy: input.actorUserId,
      lastTransitionAt: input.now,
      updatedAt: input.now,
    }).where(and(
      eq(placeReviewWorkItems.id, workItem.id),
      eq(placeReviewWorkItems.stage, input.expectedStage),
      eq(placeReviewWorkItems.stageVersion, workItem.stageVersion),
      eq(placeReviewWorkItems.status, "ACTIVE"),
    )).returning({ id: placeReviewWorkItems.id });
    if (!changed.length) {
      skipped.push({ workItemId, code: "STALE_WORK_ITEM" });
      continue;
    }

    await db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(),
      actorUserId: input.actorUserId,
      action: "PLACE_REVIEW_STAGE_CHANGE",
      targetType: "PLACE_REVIEW_WORK_ITEM",
      targetId: workItem.id,
      beforeState: JSON.stringify({ stage: workItem.stage, stageVersion: workItem.stageVersion }),
      afterState: JSON.stringify({ stage: result.nextStage, stageVersion: workItem.stageVersion + 1 }),
      createdAt: input.now,
    });
    advanced.push(workItemId);
  }

  return { advanced, skipped };
}

async function changeReviewItemStatus(
  db: AppDb,
  input: {
    workItemIds: string[];
    actorUserId: string;
    code: string;
    note: string;
    now: string;
    status: "ON_HOLD" | "EXCLUDED";
    action: "PLACE_REVIEW_HOLD" | "PLACE_REVIEW_EXCLUDE";
  },
): Promise<StateChangeResult> {
  const workItemIds = uniqueWorkItemIds(input.workItemIds);
  const changed: string[] = [];
  const skipped: StateChangeResult["skipped"] = [];

  for (const workItemId of workItemIds) {
    const workItem = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) });
    if (!workItem || workItem.status !== "ACTIVE") {
      skipped.push({ workItemId, code: "NOT_ACTIVE" });
      continue;
    }
    const updated = await db.update(placeReviewWorkItems).set({
      status: input.status,
      holdCode: input.code.trim() || null,
      holdNote: input.note.trim() || null,
      lastTransitionBy: input.actorUserId,
      lastTransitionAt: input.now,
      updatedAt: input.now,
    }).where(and(
      eq(placeReviewWorkItems.id, workItem.id),
      eq(placeReviewWorkItems.status, "ACTIVE"),
      eq(placeReviewWorkItems.stageVersion, workItem.stageVersion),
    )).returning({ id: placeReviewWorkItems.id });
    if (!updated.length) {
      skipped.push({ workItemId, code: "STALE_WORK_ITEM" });
      continue;
    }
    await db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(), actorUserId: input.actorUserId, action: input.action,
      targetType: "PLACE_REVIEW_WORK_ITEM", targetId: workItem.id,
      beforeState: JSON.stringify({ status: workItem.status, stage: workItem.stage }),
      afterState: JSON.stringify({ status: input.status, code: input.code.trim(), note: input.note.trim() }),
      createdAt: input.now,
    });
    changed.push(workItemId);
  }

  return { changed, skipped };
}

export function holdPlaceReviewItems(db: AppDb, input: {
  workItemIds: string[];
  actorUserId: string;
  code: string;
  note: string;
  now: string;
}) {
  return changeReviewItemStatus(db, { ...input, status: "ON_HOLD", action: "PLACE_REVIEW_HOLD" });
}

export function excludePlaceReviewItems(db: AppDb, input: {
  workItemIds: string[];
  actorUserId: string;
  code: string;
  note: string;
  now: string;
}) {
  return changeReviewItemStatus(db, { ...input, status: "EXCLUDED", action: "PLACE_REVIEW_EXCLUDE" });
}
