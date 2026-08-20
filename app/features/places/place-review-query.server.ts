import { and, asc, eq, inArray, isNotNull, like, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { AppDb } from "../../db/client.server";
import {
  businessLicenses,
  categories,
  naverLocalCategoryVerifications,
  placeLivenessStates,
  places,
  placeReviewWorkItems,
} from "../../db/schema";
import { addressLikePatterns, regionFromAddress, type RegionCode } from "../regions/region-pack";
import { naverNeedsConfirmation } from "./place-review-pipeline";
import type { PlaceReviewQuery, ReviewStepNumber } from "./place-review-pagination";

const stageByStep = {
  1: "SOURCE_REVIEW",
  2: "NAVER_VERIFICATION",
  3: "CATEGORY_CONFIRMATION",
  4: "DUPLICATE_REVIEW",
  5: "FINAL_APPROVAL",
} as const;

export type PlaceReviewQueueRow = {
  workItemId: string;
  stageVersion: number;
  subjectType: "BUSINESS_LICENSE" | "PLACE";
  subjectId: string;
  sourceKind: "PUBLIC_DATA" | "PLACE_SUGGESTION" | "CATEGORY_RECALL" | "LIVENESS_RECHECK";
  name: string;
  address: string;
  region: RegionCode | null;
  placeStatus: "DRAFT" | "PUBLISHED" | "HIDDEN" | null;
  naverStatus: string | null;
  naverScore: number | null;
  naverMappedCategoryId: string | null;
  naverMappedCategoryName: string | null;
  selectedCategoryId: string | null;
  selectedCategoryName: string | null;
  blockCodes: string[];
};

export type PlaceReviewPage = {
  rows: PlaceReviewQueueRow[];
  pagination: { page: number; pageSize: 25 | 50 | 100; total: number; totalPages: number };
};

export type PlaceReviewStageCounts = Record<ReviewStepNumber, number>;

function reviewStageForStep(step: ReviewStepNumber) {
  return stageByStep[step];
}

function reviewConditions(query: PlaceReviewQuery): SQL[] {
  const conditions: SQL[] = [eq(placeReviewWorkItems.stage, reviewStageForStep(query.step))];
  if (query.status === "pending" || query.status === "ready") conditions.push(eq(placeReviewWorkItems.status, "ACTIVE"));
  if (query.status === "hold") conditions.push(eq(placeReviewWorkItems.status, "ON_HOLD"));
  if (query.status === "attention") {
    conditions.push(and(
      eq(placeReviewWorkItems.status, "ACTIVE"),
      or(
        sql`${placeReviewWorkItems.holdCode} is not null`,
        inArray(naverLocalCategoryVerifications.status, ["NO_MATCH", "LIKELY", "AMBIGUOUS", "FAILED", "OUT_OF_SCOPE"]),
        inArray(placeLivenessStates.naverStatus, ["NOT_FOUND", "AMBIGUOUS", "ERROR"]),
      )!,
    )!);
  }
  if (query.status === "ready") {
    conditions.push(or(
      and(isNotNull(businessLicenses.latitude), isNotNull(businessLicenses.longitude)),
      and(isNotNull(places.latitude), isNotNull(places.longitude)),
    )!);
  }

  if (query.region) {
    conditions.push(or(
      eq(businessLicenses.regionCode, query.region),
      ...addressLikePatterns(query.region).map((pattern) => like(places.address, pattern)),
    )!);
  }

  if (query.query) {
    const pattern = `%${query.query}%`;
    conditions.push(or(
      like(businessLicenses.businessName, pattern),
      like(businessLicenses.roadAddress, pattern),
      like(businessLicenses.lotAddress, pattern),
      like(places.name, pattern),
      like(places.address, pattern),
    )!);
  }

  return conditions;
}

export async function listPlaceReviewWorkItems(db: AppDb, query: PlaceReviewQuery): Promise<PlaceReviewPage> {
  const conditions = reviewConditions(query);
  const [countRow] = await db.select({ total: sql<number>`count(*)` })
    .from(placeReviewWorkItems)
    .leftJoin(businessLicenses, eq(businessLicenses.id, placeReviewWorkItems.businessLicenseId))
    .leftJoin(places, eq(places.id, placeReviewWorkItems.placeId))
    .leftJoin(naverLocalCategoryVerifications, eq(naverLocalCategoryVerifications.businessLicenseId, businessLicenses.id))
    .leftJoin(placeLivenessStates, eq(placeLivenessStates.placeId, places.id))
    .where(and(...conditions));
  const total = Number(countRow?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const workItemIds = await db.select({ id: placeReviewWorkItems.id })
    .from(placeReviewWorkItems)
    .leftJoin(businessLicenses, eq(businessLicenses.id, placeReviewWorkItems.businessLicenseId))
    .leftJoin(places, eq(places.id, placeReviewWorkItems.placeId))
    .leftJoin(naverLocalCategoryVerifications, eq(naverLocalCategoryVerifications.businessLicenseId, businessLicenses.id))
    .leftJoin(placeLivenessStates, eq(placeLivenessStates.placeId, places.id))
    .where(and(...conditions))
    .orderBy(
      sql`case when (${businessLicenses.latitude} is not null and ${businessLicenses.longitude} is not null) or (${places.latitude} is not null and ${places.longitude} is not null) then 0 else 1 end`,
      asc(placeReviewWorkItems.updatedAt),
      asc(placeReviewWorkItems.id),
    )
    .limit(query.pageSize)
    .offset((page - 1) * query.pageSize);

  if (workItemIds.length === 0) {
    return { rows: [], pagination: { page, pageSize: query.pageSize, total, totalPages } };
  }

  const selectedCategories = alias(categories, "place_review_selected_categories");
  const naverMappedCategories = alias(categories, "place_review_naver_mapped_categories");
  const hydrated = await db.select({
    workItem: placeReviewWorkItems,
    businessLicense: businessLicenses,
    place: places,
    candidateNaverStatus: naverLocalCategoryVerifications.status,
    candidateNaverScore: naverLocalCategoryVerifications.matchScore,
    candidateNaverMappedCategoryId: naverLocalCategoryVerifications.mappedCategoryId,
    placeNaverStatus: placeLivenessStates.naverStatus,
    placeNaverScore: placeLivenessStates.naverMatchScore,
    selectedCategoryName: selectedCategories.name,
    naverMappedCategoryName: naverMappedCategories.name,
  })
    .from(placeReviewWorkItems)
    .leftJoin(businessLicenses, eq(businessLicenses.id, placeReviewWorkItems.businessLicenseId))
    .leftJoin(places, eq(places.id, placeReviewWorkItems.placeId))
    .leftJoin(naverLocalCategoryVerifications, eq(naverLocalCategoryVerifications.businessLicenseId, businessLicenses.id))
    .leftJoin(placeLivenessStates, eq(placeLivenessStates.placeId, places.id))
    .leftJoin(selectedCategories, eq(selectedCategories.id, placeReviewWorkItems.selectedCategoryId))
    .leftJoin(naverMappedCategories, eq(naverMappedCategories.id, naverLocalCategoryVerifications.mappedCategoryId))
    .where(inArray(placeReviewWorkItems.id, workItemIds.map((row) => row.id)));

  const rowsById = new Map(hydrated.map((row) => {
    const workItem = row.workItem;
    const businessLicense = row.businessLicense;
    const place = row.place;
    const isBusinessLicense = Boolean(workItem.businessLicenseId);
    const address = businessLicense?.roadAddress ?? businessLicense?.lotAddress ?? place?.address ?? "";
    const sourceMissing = isBusinessLicense
      ? !address || businessLicense?.latitude == null || businessLicense.longitude == null
      : !place?.address || place.latitude == null || place.longitude == null;
    const naverStatus = row.candidateNaverStatus ?? row.placeNaverStatus ?? null;
    const blockCodes = [
      ...(sourceMissing ? ["SOURCE_NOT_READY"] : []),
      ...(workItem.holdCode ? [workItem.holdCode] : []),
      ...(naverNeedsConfirmation(naverStatus) && workItem.stage === "NAVER_VERIFICATION" ? ["NAVER_REVIEW_REQUIRED"] : []),
    ];

    return [workItem.id, {
      workItemId: workItem.id,
      stageVersion: workItem.stageVersion,
      subjectType: isBusinessLicense ? "BUSINESS_LICENSE" : "PLACE",
      subjectId: workItem.businessLicenseId ?? workItem.placeId!,
      sourceKind: workItem.sourceKind,
      name: businessLicense?.businessName ?? place?.name ?? "",
      address,
      region: businessLicense?.regionCode ?? regionFromAddress(place?.address ?? null),
      placeStatus: place?.status ?? null,
      naverStatus,
      naverScore: row.candidateNaverScore ?? row.placeNaverScore ?? null,
      naverMappedCategoryId: row.candidateNaverMappedCategoryId ?? null,
      naverMappedCategoryName: row.naverMappedCategoryName ?? null,
      selectedCategoryId: workItem.selectedCategoryId,
      selectedCategoryName: row.selectedCategoryName,
      blockCodes,
    } satisfies PlaceReviewQueueRow];
  }));

  return {
    rows: workItemIds.flatMap((row) => {
      const hydratedRow = rowsById.get(row.id);
      return hydratedRow ? [hydratedRow] : [];
    }),
    pagination: { page, pageSize: query.pageSize, total, totalPages },
  };
}

export async function getPlaceReviewStageCounts(db: AppDb): Promise<PlaceReviewStageCounts> {
  const counts = await db.select({ stage: placeReviewWorkItems.stage, total: sql<number>`count(*)` })
    .from(placeReviewWorkItems)
    .where(eq(placeReviewWorkItems.status, "ACTIVE"))
    .groupBy(placeReviewWorkItems.stage);
  const byStage = new Map(counts.map((row) => [row.stage, Number(row.total)]));

  return {
    1: byStage.get("SOURCE_REVIEW") ?? 0,
    2: byStage.get("NAVER_VERIFICATION") ?? 0,
    3: byStage.get("CATEGORY_CONFIRMATION") ?? 0,
    4: byStage.get("DUPLICATE_REVIEW") ?? 0,
    5: byStage.get("FINAL_APPROVAL") ?? 0,
  };
}
