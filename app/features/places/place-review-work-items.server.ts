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
import { REVIEW_BATCH_MAX } from "./place-review-io";
import {
  confidentAdvanceAllowed,
  evaluateReviewAdvance,
  hasManualReviewEvidence,
  type ConfidentAdvanceEvidence,
  type NaverReviewDecision,
  type ReviewBlockCode,
  type ReviewStage,
} from "./place-review-pipeline";
import { openReviewDuplicateCount } from "./place-review-duplicates.server";
import { classifyFoodVenue } from "./food-venue-policy";
import { regionFromAddress } from "../regions/region-pack";

export type ReviewSourceKind = "PUBLIC_DATA" | "PLACE_SUGGESTION" | "CATEGORY_RECALL" | "LIVENESS_RECHECK";
export type NewReviewSubject =
  | { businessLicenseId: string; placeId?: never }
  | { placeId: string; businessLicenseId?: never };

type TransitionSkipCode = ReviewBlockCode | "STALE_WORK_ITEM" | "NOT_ACTIVE" | "CONFIDENT_ADVANCE_DISABLED";
type TransitionResult = { advanced: string[]; skipped: Array<{ workItemId: string; code: TransitionSkipCode }> };
type StateChangeResult = { changed: string[]; skipped: Array<{ workItemId: string; code: "STALE_WORK_ITEM" | "NOT_ACTIVE" }> };

function uniqueWorkItemIds(workItemIds: string[]) {
  const ids = [...new Set(workItemIds.filter(Boolean))];
  if (ids.length > REVIEW_BATCH_MAX) throw new Error("PLACE_REVIEW_BATCH_LIMIT_EXCEEDED");
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
  if (hasManualEvidence) return "MANUAL_OVERRIDE";
  if (status === "FAILED") return "FAILED";
  if (status === "LIKELY" || status === "AMBIGUOUS") return "AMBIGUOUS";
  return "NOT_FOUND";
}

function naverDecisionForPlace(
  status: typeof placeLivenessStates.$inferSelect["naverStatus"] | null | undefined,
  hasManualEvidence: boolean,
): NaverReviewDecision {
  if (status === "MATCHED") return "MATCHED";
  if (hasManualEvidence) return "MANUAL_OVERRIDE";
  if (status === "ERROR") return "FAILED";
  if (status === "AMBIGUOUS") return "AMBIGUOUS";
  return "NOT_FOUND";
}

async function reviewEvidence(
  db: AppDb,
  workItem: typeof placeReviewWorkItems.$inferSelect,
  manualEvidenceReason?: string,
): Promise<ConfidentAdvanceEvidence> {
  const hasManualEvidence = hasManualReviewEvidence(manualEvidenceReason) || hasManualReviewEvidence(workItem.manualEvidenceReason);
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
  const mappedCategory = !selectedCategory && candidateNaver?.mappedCategoryId
    ? await db.query.categories.findFirst({ where: eq(categories.id, candidateNaver.mappedCategoryId) })
    : undefined;
  const leafCategory = selectedCategory ?? mappedCategory;
  const sourceReady = businessLicense
    ? businessLicense.normalizedStatus === "OPEN"
      && Boolean(businessLicense.roadAddress ?? businessLicense.lotAddress)
      && businessLicense.latitude != null
      && businessLicense.longitude != null
    : Boolean(place?.address && place.latitude != null && place.longitude != null);
  const openDuplicateCount = await openReviewDuplicateCount(db, workItem);

  return {
    sourceReady,
    naverDecision: businessLicense
      ? naverDecisionForCandidate(candidateNaver?.status, hasManualEvidence)
      : naverDecisionForPlace(placeLiveness?.naverStatus, hasManualEvidence),
    selectedCategoryId: workItem.selectedCategoryId,
    categoryActive: Boolean(leafCategory?.isActive),
    openDuplicateCount,
    activeExclusion: Boolean(activeExclusion),
    categoryLeaf: Boolean(leafCategory?.parentId),
    hasManualEvidence,
  };
}

async function applyStoredLeafCategory(
  db: AppDb,
  workItem: typeof placeReviewWorkItems.$inferSelect,
  now: string,
) {
  if (workItem.selectedCategoryId || !workItem.businessLicenseId) return workItem;
  const verification = await db.query.naverLocalCategoryVerifications.findFirst({
    where: eq(naverLocalCategoryVerifications.businessLicenseId, workItem.businessLicenseId),
  });
  if (verification?.status !== "VERIFIED" || !verification.mappedCategoryId) return workItem;
  const mapped = await db.query.categories.findFirst({ where: eq(categories.id, verification.mappedCategoryId) });
  if (!mapped?.parentId || !mapped.isActive) return workItem;
  const updated = await db.update(placeReviewWorkItems).set({
    selectedCategoryId: mapped.id,
    categoryOverrideReason: null,
    updatedAt: now,
  }).where(and(
    eq(placeReviewWorkItems.id, workItem.id),
    eq(placeReviewWorkItems.stage, workItem.stage),
    eq(placeReviewWorkItems.stageVersion, workItem.stageVersion),
    eq(placeReviewWorkItems.status, "ACTIVE"),
  )).returning();
  return updated[0] ?? workItem;
}

async function chainConfidentReviewAdvance(db: AppDb, input: {
  workItemId: string;
  actorUserId: string;
  now: string;
}) {
  for (let step = 0; step < 4; step += 1) {
    const current = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, input.workItemId) });
    if (!current || current.status !== "ACTIVE") return;
    const withCategory = await applyStoredLeafCategory(db, current, input.now);
    const evidence = await reviewEvidence(db, withCategory);
    if (!confidentAdvanceAllowed(withCategory.stage, evidence)) return;
    const result = await advancePlaceReviewWorkItems(db, {
      workItemIds: [withCategory.id],
      expectedStage: withCategory.stage,
      expectedVersions: { [withCategory.id]: withCategory.stageVersion },
      actorUserId: input.actorUserId,
      now: input.now,
      skipChain: true,
    });
    if (!result.advanced.length) return;
  }
}

export async function advancePlaceReviewWorkItems(db: AppDb, input: {
  workItemIds: string[];
  expectedStage: ReviewStage;
  expectedVersions: Record<string, number>;
  actorUserId: string;
  now: string;
  manualEvidenceReason?: string;
  confidentAdvanceEnabled?: boolean;
  skipChain?: boolean;
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

    const manualEvidenceReason = hasManualReviewEvidence(input.manualEvidenceReason)
      ? input.manualEvidenceReason?.trim()
      : workItem.manualEvidenceReason;

    const changed = await db.update(placeReviewWorkItems).set({
      stage: result.nextStage,
      stageVersion: workItem.stageVersion + 1,
      manualEvidenceReason,
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

  if (
    input.confidentAdvanceEnabled
    && !input.skipChain
    && workItemIds.length === 1
    && advanced.length === 1
  ) {
    await chainConfidentReviewAdvance(db, {
      workItemId: advanced[0]!,
      actorUserId: input.actorUserId,
      now: input.now,
    });
  }

  return { advanced, skipped };
}

export async function advanceConfidentReviewWorkItems(db: AppDb, input: {
  workItemIds: string[];
  expectedStage: ReviewStage;
  expectedVersions: Record<string, number>;
  actorUserId: string;
  now: string;
  confidentAdvanceEnabled?: boolean;
}): Promise<TransitionResult> {
  const workItemIds = uniqueWorkItemIds(input.workItemIds);
  if (!input.confidentAdvanceEnabled) {
    return {
      advanced: [],
      skipped: workItemIds.map((workItemId) => ({ workItemId, code: "CONFIDENT_ADVANCE_DISABLED" as const })),
    };
  }

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

    const withCategory = await applyStoredLeafCategory(db, workItem, input.now);
    const evidence = await reviewEvidence(db, withCategory);
    if (!confidentAdvanceAllowed(withCategory.stage, evidence)) {
      const evaluation = evaluateReviewAdvance(withCategory.stage, evidence);
      skipped.push({ workItemId, code: evaluation.ok ? "CATEGORY_REQUIRED" : evaluation.code });
      continue;
    }

    const result = await advancePlaceReviewWorkItems(db, {
      workItemIds: [withCategory.id],
      expectedStage: withCategory.stage,
      expectedVersions: { [withCategory.id]: withCategory.stageVersion },
      actorUserId: input.actorUserId,
      now: input.now,
      confidentAdvanceEnabled: true,
    });
    if (result.advanced.length) advanced.push(workItemId);
    skipped.push(...result.skipped);
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

type AutoNonFoodSkipCode = "NOT_ACTIVE" | "NOT_SOURCE_REVIEW" | "NOT_NON_FOOD" | "STALE_WORK_ITEM";

export async function autoExcludeNonFoodReviewItems(db: AppDb, input: {
  workItemIds: string[];
  actorUserId: string;
  now: string;
}): Promise<{ changed: string[]; skipped: Array<{ workItemId: string; code: AutoNonFoodSkipCode }> }> {
  const workItemIds = uniqueWorkItemIds(input.workItemIds);
  const changed: string[] = [];
  const skipped: Array<{ workItemId: string; code: AutoNonFoodSkipCode }> = [];

  for (const workItemId of workItemIds) {
    const workItem = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) });
    if (!workItem || workItem.status !== "ACTIVE") {
      skipped.push({ workItemId, code: "NOT_ACTIVE" });
      continue;
    }
    if (workItem.stage !== "SOURCE_REVIEW") {
      skipped.push({ workItemId, code: "NOT_SOURCE_REVIEW" });
      continue;
    }

    const license = workItem.businessLicenseId
      ? await db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, workItem.businessLicenseId) })
      : undefined;
    const decision = classifyFoodVenue({ businessName: license?.businessName ?? "", businessSubtype: license?.businessSubtype ?? null });
    if (decision.decision !== "EXCLUDE") {
      skipped.push({ workItemId, code: "NOT_NON_FOOD" });
      continue;
    }

    const note = `${decision.matchedRule} · ${decision.matchMethod}`;
    const updated = await db.update(placeReviewWorkItems).set({
      status: "EXCLUDED",
      holdCode: "AUTO_NON_FOOD",
      holdNote: note,
      lastTransitionBy: input.actorUserId,
      lastTransitionAt: input.now,
      updatedAt: input.now,
    }).where(and(
      eq(placeReviewWorkItems.id, workItem.id),
      eq(placeReviewWorkItems.status, "ACTIVE"),
      eq(placeReviewWorkItems.stage, "SOURCE_REVIEW"),
      eq(placeReviewWorkItems.stageVersion, workItem.stageVersion),
    )).returning({ id: placeReviewWorkItems.id });
    if (!updated.length) {
      skipped.push({ workItemId, code: "STALE_WORK_ITEM" });
      continue;
    }
    await db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(),
      actorUserId: input.actorUserId,
      action: "PLACE_REVIEW_AUTO_EXCLUDE_NON_FOOD",
      targetType: "PLACE_REVIEW_WORK_ITEM",
      targetId: workItem.id,
      beforeState: JSON.stringify({ status: workItem.status, stage: workItem.stage }),
      afterState: JSON.stringify({ status: "EXCLUDED", code: "AUTO_NON_FOOD", note }),
      createdAt: input.now,
    });
    changed.push(workItemId);
  }

  return { changed, skipped };
}

export async function updateReviewItemAddresses(db: AppDb, input: {
  workItemIds: string[];
  addressByWorkItem: Record<string, string>;
  actorUserId: string;
  now: string;
}) {
  const workItemIds = uniqueWorkItemIds(input.workItemIds);
  const changed: string[] = [];
  const skipped: Array<{ workItemId: string; code: "NOT_ACTIVE" | "REVIEW_ADDRESS_REQUIRED" | "REVIEW_ADDRESS_REGION_INVALID" }> = [];

  for (const workItemId of workItemIds) {
    const address = input.addressByWorkItem[workItemId]?.trim() ?? "";
    if (!address) {
      skipped.push({ workItemId, code: "REVIEW_ADDRESS_REQUIRED" });
      continue;
    }
    const region = regionFromAddress(address);
    if (!region) {
      skipped.push({ workItemId, code: "REVIEW_ADDRESS_REGION_INVALID" });
      continue;
    }

    const workItem = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) });
    if (!workItem || workItem.status !== "ACTIVE" || workItem.stage !== "NAVER_VERIFICATION") {
      skipped.push({ workItemId, code: "NOT_ACTIVE" });
      continue;
    }

    if (workItem.businessLicenseId) {
      const license = await db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, workItem.businessLicenseId) });
      const current = (license?.roadAddress ?? license?.lotAddress ?? "").trim();
      if (current !== address || license?.regionCode !== region) {
        await db.update(businessLicenses).set({
          roadAddress: address,
          regionCode: region,
          latitude: current === address ? license?.latitude ?? null : null,
          longitude: current === address ? license?.longitude ?? null : null,
          updatedAt: input.now,
        }).where(eq(businessLicenses.id, workItem.businessLicenseId));
        await db.delete(naverLocalCategoryVerifications).where(eq(naverLocalCategoryVerifications.businessLicenseId, workItem.businessLicenseId));
      }
    } else if (workItem.placeId) {
      const place = await db.query.places.findFirst({ where: eq(places.id, workItem.placeId) });
      if ((place?.address ?? "").trim() !== address) {
        await db.update(places).set({ address, updatedAt: input.now }).where(eq(places.id, workItem.placeId));
        await db.delete(placeLivenessStates).where(eq(placeLivenessStates.placeId, workItem.placeId));
      }
    } else {
      skipped.push({ workItemId, code: "NOT_ACTIVE" });
      continue;
    }

    await db.update(placeReviewWorkItems).set({ updatedAt: input.now }).where(eq(placeReviewWorkItems.id, workItem.id));
    await db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(),
      actorUserId: input.actorUserId,
      action: "PLACE_REVIEW_ADDRESS_UPDATE",
      targetType: "PLACE_REVIEW_WORK_ITEM",
      targetId: workItem.id,
      beforeState: JSON.stringify({ subject: workItem.businessLicenseId ? "BUSINESS_LICENSE" : "PLACE" }),
      afterState: JSON.stringify({ address, region }),
      createdAt: input.now,
    });
    changed.push(workItemId);
  }

  return { changed, skipped };
}
