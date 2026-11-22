import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { placeCorrectionRequests, placeLivenessStates, placeRevalidationCases, placeRevisions, placeReviewWorkItems, places } from "../../db/schema";
import { readCorrectionChanges, reviewableCorrectionStatuses } from "./place-correction.server";
import { buildSafeSameNameMergeGroups } from "./place-same-name-merge.server";
import {
  buildLivenessRow,
  isAttentionState,
  matchesLivenessFilter,
  parseCorrectionChanges,
  parseLivenessFilter,
  type LivenessRow,
  type LivenessStateRow,
} from "./place-operations-liveness";

export async function listLivenessOperations(db: AppDb, rawFilter: string | null) {
  const livenessFilter = parseLivenessFilter(rawFilter);
  const [revalidations, livenessStates] = await Promise.all([
    db.select({
      id: placeRevalidationCases.id,
      placeId: placeRevalidationCases.placeId,
      reasonType: placeRevalidationCases.reasonType,
      evidenceJson: placeRevalidationCases.evidenceJson,
      placeName: places.name,
    }).from(placeRevalidationCases)
      .leftJoin(places, eq(places.id, placeRevalidationCases.placeId))
      .where(inArray(placeRevalidationCases.status, ["OPEN", "REVIEWING"]))
      .orderBy(asc(placeRevalidationCases.createdAt))
      .limit(200),
    db.select({
      placeId: placeLivenessStates.placeId,
      placeName: places.name,
      status: placeLivenessStates.status,
      kakaoStatus: placeLivenessStates.kakaoStatus,
      naverStatus: placeLivenessStates.naverStatus,
      naverMatchScore: placeLivenessStates.naverMatchScore,
      naverEvidenceCodesJson: placeLivenessStates.naverEvidenceCodesJson,
      matchScore: placeLivenessStates.matchScore,
      consecutiveNotFound: placeLivenessStates.consecutiveNotFound,
      protectedUntil: placeLivenessStates.protectedUntil,
      evidenceJson: placeLivenessStates.evidenceJson,
    }).from(placeLivenessStates).innerJoin(places, eq(places.id, placeLivenessStates.placeId))
      .orderBy(desc(placeLivenessStates.updatedAt))
      .limit(1_000),
  ]);
  const statesByPlace = new Map(livenessStates.map((state) => [state.placeId, state as LivenessStateRow]));
  const caseRows = revalidations.map((item) => buildLivenessRow({
    caseId: item.id,
    placeId: item.placeId,
    placeName: item.placeName ?? item.placeId,
    reasonType: item.reasonType,
    caseEvidenceJson: item.evidenceJson,
    state: statesByPlace.get(item.placeId),
  }));
  const casePlaceIds = new Set(revalidations.map((item) => item.placeId));
  const stateRows = livenessStates
    .filter((state) => isAttentionState(state))
    .filter((state) => !casePlaceIds.has(state.placeId))
    .map((state) => buildLivenessRow({
      caseId: null,
      placeId: state.placeId,
      placeName: state.placeName,
      reasonType: "LIVENESS_STATE",
      caseEvidenceJson: null,
      state: state as LivenessStateRow,
    }));
  return {
    livenessFilter,
    livenessRows: [...caseRows, ...stateRows].filter((row) => matchesLivenessFilter(row, livenessFilter)) as LivenessRow[],
  };
}

export async function listDuplicateOperations(db: AppDb) {
  const [placeRows, revisions] = await Promise.all([
    db.select({
      id: places.id,
      name: places.name,
      address: places.address,
      status: places.status,
      latitude: places.latitude,
      longitude: places.longitude,
      createdAt: places.createdAt,
    }).from(places).orderBy(asc(places.name)).limit(1_000),
    db.select({
      id: placeRevisions.id,
      placeId: placeRevisions.placeId,
      action: placeRevisions.action,
      reason: placeRevisions.reason,
      createdAt: placeRevisions.createdAt,
      beforeJson: placeRevisions.beforeJson,
    }).from(placeRevisions).orderBy(desc(placeRevisions.createdAt)).limit(100),
  ]);
  const names = new Map(placeRows.map((place) => [place.id, place.name]));
  return {
    places: placeRows.map((place) => ({ id: place.id, name: place.name, address: place.address, status: place.status })),
    safeSameNameMergeGroups: buildSafeSameNameMergeGroups(placeRows).map((group) => ({
      id: group.id,
      label: group.label,
      count: group.count,
      targetPlaceId: group.targetPlaceId,
      sourcePlaceIds: group.sourcePlaceIds,
    })),
    revisions: revisions.map((item) => ({
      id: item.id,
      placeId: item.placeId,
      placeName: names.get(item.placeId) ?? item.placeId,
      action: item.action,
      reason: item.reason,
      createdAt: item.createdAt,
      restorable: Boolean(item.beforeJson),
    })),
  };
}

export async function listCorrectionOperations(db: AppDb, requestedPage = 1) {
  const pageSize = 25;
  const where = and(inArray(placeCorrectionRequests.status, reviewableCorrectionStatuses), gt(placeCorrectionRequests.verifiedAt, ""));
  const total = await db.$count(placeCorrectionRequests, where);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const rows = await db.select({
    id: placeCorrectionRequests.id,
    placeId: placeCorrectionRequests.placeId,
    status: placeCorrectionRequests.status,
    requestType: placeCorrectionRequests.requestType,
    requesterRelation: placeCorrectionRequests.requesterRelation,
    requestedChangesJson: placeCorrectionRequests.requestedChangesJson,
    evidenceNote: placeCorrectionRequests.evidenceNote,
    adminResponse: placeCorrectionRequests.adminResponse,
    updatedAt: placeCorrectionRequests.updatedAt,
    placeName: places.name,
    placeStatus: places.status,
    hasOpenReview: sql<boolean>`exists (select 1 from ${placeReviewWorkItems} where ${placeReviewWorkItems.placeId}=${places.id}
      and ${placeReviewWorkItems.status} in ('ACTIVE', 'ON_HOLD'))`.mapWith(Boolean),
  }).from(placeCorrectionRequests)
    .leftJoin(places, eq(places.id, placeCorrectionRequests.placeId))
    .where(where)
    .orderBy(sql`case when ${placeCorrectionRequests.requestType} in ('CLOSED','RIGHTS') then 0 else 1 end`, asc(placeCorrectionRequests.createdAt), asc(placeCorrectionRequests.id))
    .limit(pageSize).offset((page - 1) * pageSize);
  return {
    rows: rows.map(({ requestedChangesJson, placeStatus, hasOpenReview, ...item }) => {
      let canApply = false;
      if (placeStatus && item.requestType !== "CLOSED") {
        try {
          const changes = readCorrectionChanges(requestedChangesJson);
          canApply = Object.keys(changes).length > 0 && !Object.hasOwn(changes, "status");
        } catch { /* Invalid or legacy data is review-only. */ }
      }
      return {
        ...item,
        changes: parseCorrectionChanges(requestedChangesJson),
        canApply,
        canRecall: item.requestType === "CLOSED" && placeStatus === "PUBLISHED" && !hasOpenReview,
      };
    }),
    pagination: { page, pageSize, total, totalPages },
  };
}
