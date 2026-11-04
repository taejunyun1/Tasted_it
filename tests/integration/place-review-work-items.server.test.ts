import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, businessLicenses, naverLocalCategoryVerifications, placeLivenessStates, placeReviewWorkItems, places, users } from "../../app/db/schema";
import { advancePlaceReviewWorkItems, autoExcludeNonFoodReviewItems, excludePlaceReviewItems, holdPlaceReviewItems, newReviewWorkItemValues, sweepConfidentReviewStage, updateReviewItemAddresses } from "../../app/features/places/place-review-work-items.server";

const now = "2026-08-15T12:00:00.000Z";

async function createSourceReviewItem(input: { businessName?: string; businessSubtype?: string } = {}) {
  const db = createDb(env.DB);
  const suffix = crypto.randomUUID();
  const actorUserId = `review-actor-${suffix}`;
  const businessLicenseId = `review-license-${suffix}`;
  await db.insert(users).values({ id: actorUserId, email: `${actorUserId}@example.test`, displayName: "검수 관리자", role: "ADMIN", passwordHash: null, passwordSalt: null, emailVerifiedAt: now, createdAt: now, updatedAt: now });
  await db.insert(businessLicenses).values({
    id: businessLicenseId, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: suffix, businessName: input.businessName ?? "검수 식당", businessSubtype: input.businessSubtype ?? "한식",
    salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
    lotAddress: null, roadAddress: "광주광역시 북구 검수로 1", phone: null, sourceX: null, sourceY: null, latitude: 35.16, longitude: 126.91,
    regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}", reviewStatus: "PENDING", reviewReason: null, reviewedBy: null, reviewedAt: null,
    firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
  });
  const item = newReviewWorkItemValues({ businessLicenseId, sourceKind: "PUBLIC_DATA", now });
  await db.insert(placeReviewWorkItems).values(item);
  return { db, actorUserId, businessLicenseId, workItemId: item.id };
}

describe("place review work item transitions", () => {
  it("sweeps the ready queue slice with the same gates and no external calls", async () => {
    const { db, actorUserId, workItemId } = await createSourceReviewItem();
    const dry = await sweepConfidentReviewStage(db, { stage: "SOURCE_REVIEW", limit: 100, dryRun: true, actorUserId, now, confidentAdvanceEnabled: true });
    expect(dry.scanned).toBeGreaterThanOrEqual(1); expect(dry.advanced).toEqual([]);
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) })).resolves.toMatchObject({ stage: "SOURCE_REVIEW" });
    const live = await sweepConfidentReviewStage(db, { stage: "SOURCE_REVIEW", limit: 100, dryRun: false, actorUserId, now, confidentAdvanceEnabled: true });
    expect(live.advanced).toContain(workItemId);
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) })).resolves.toMatchObject({ stage: "NAVER_VERIFICATION" });
  });
  it("never sweeps FINAL_APPROVAL: publish stays a human action", async () => {
    const { db, actorUserId } = await createSourceReviewItem();
    await expect(sweepConfidentReviewStage(db, { stage: "FINAL_APPROVAL", limit: 100, dryRun: false, actorUserId, now, confidentAdvanceEnabled: true })).resolves.toMatchObject({ scanned: 0, advanced: [] });
  });
  it("advances one stage and rejects a stale stage version", async () => {
    const { db, actorUserId, workItemId } = await createSourceReviewItem();
    const first = await advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 }, actorUserId, now,
    });
    expect(first).toEqual({ advanced: [workItemId], skipped: [] });

    const stale = await advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "NAVER_VERIFICATION", expectedVersions: { [workItemId]: 0 }, actorUserId, now: "2026-08-15T12:05:00.000Z",
    });
    expect(stale.skipped).toEqual([{ workItemId, code: "STALE_WORK_ITEM" }]);
    await expect(db.query.adminAuditLogs.findFirst({ where: eq(adminAuditLogs.targetId, workItemId) })).resolves.toMatchObject({ action: "PLACE_REVIEW_STAGE_CHANGE" });
  });

  it("holds and excludes only active work items with an audit trail", async () => {
    const { db, actorUserId, workItemId } = await createSourceReviewItem();
    await expect(holdPlaceReviewItems(db, { workItemIds: [workItemId], actorUserId, code: "SOURCE_MISSING", note: "주소 보완 필요", now }))
      .resolves.toEqual({ changed: [workItemId], skipped: [] });
    await expect(excludePlaceReviewItems(db, { workItemIds: [workItemId], actorUserId, code: "NOT_RESTAURANT", note: "음식점 아님", now }))
      .resolves.toEqual({ changed: [], skipped: [{ workItemId, code: "NOT_ACTIVE" }] });
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) }))
      .resolves.toMatchObject({ status: "ON_HOLD", holdCode: "SOURCE_MISSING" });
  });

  it("automatically excludes only definite non-food source-review items with an audit trail", async () => {
    const nonFood = await createSourceReviewItem({ businessName: "GS25 동명점", businessSubtype: "휴게음식점" });
    const restaurant = await createSourceReviewItem({ businessName: "동명 김밥", businessSubtype: "일반음식점" });

    const result = await autoExcludeNonFoodReviewItems(nonFood.db, {
      workItemIds: [nonFood.workItemId, restaurant.workItemId], actorUserId: nonFood.actorUserId, now,
    });

    expect(result.changed).toEqual([nonFood.workItemId]);
    expect(result.skipped).toContainEqual({ workItemId: restaurant.workItemId, code: "NOT_NON_FOOD" });
    await expect(nonFood.db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, nonFood.workItemId) }))
      .resolves.toMatchObject({ status: "EXCLUDED", holdCode: "AUTO_LOCAL_DINING_EXCLUSION", holdNote: expect.stringContaining("NAME_CONVENIENCE_GS25") });
    await expect(nonFood.db.query.adminAuditLogs.findFirst({ where: eq(adminAuditLogs.targetId, nonFood.workItemId) }))
      .resolves.toMatchObject({ action: "PLACE_REVIEW_AUTO_EXCLUDE_LOCAL_DINING" });
  });

  it("keeps NO_MATCH on NAVER verification until 20-character manual evidence is recorded", async () => {
    const { db, actorUserId, businessLicenseId, workItemId } = await createSourceReviewItem();
    await advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 }, actorUserId, now,
    });
    await db.insert(naverLocalCategoryVerifications).values({
      businessLicenseId, status: "NO_MATCH", mappedCategoryId: null, matchScore: 0, specificityScore: 0, confidenceScore: 0,
      evidenceCodesJson: "[]", ruleVersion: "naver-category-v1", inputFingerprint: "nomatch", queriedAt: now, expiresAt: null, failureCode: null, createdAt: now, updatedAt: now,
    });

    await expect(advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "NAVER_VERIFICATION", expectedVersions: { [workItemId]: 1 }, actorUserId, now,
    })).resolves.toEqual({ advanced: [], skipped: [{ workItemId, code: "NAVER_REVIEW_REQUIRED" }] });

    await expect(advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "NAVER_VERIFICATION", expectedVersions: { [workItemId]: 1 }, actorUserId, now,
      manualEvidenceReason: "공공데이터 원천과 현장 상호가 같아 수동으로 넘긴다",
    })).resolves.toEqual({ advanced: [workItemId], skipped: [] });
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) }))
      .resolves.toMatchObject({ stage: "CATEGORY_CONFIRMATION", manualEvidenceReason: "공공데이터 원천과 현장 상호가 같아 수동으로 넘긴다" });
  });

  it("lets 20-character manual evidence override a FAILED NAVER status", async () => {
    const { db, actorUserId, businessLicenseId, workItemId } = await createSourceReviewItem();
    await advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 }, actorUserId, now,
    });
    await db.insert(naverLocalCategoryVerifications).values({
      businessLicenseId, status: "FAILED", mappedCategoryId: null, matchScore: 0, specificityScore: 0, confidenceScore: 0,
      evidenceCodesJson: "[]", ruleVersion: "naver-category-v1", inputFingerprint: "failed", queriedAt: now, expiresAt: null, failureCode: "NAVER_LOCAL_SEARCH_UNAVAILABLE", createdAt: now, updatedAt: now,
    });

    await expect(advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "NAVER_VERIFICATION", expectedVersions: { [workItemId]: 1 }, actorUserId, now,
    })).resolves.toEqual({ advanced: [], skipped: [{ workItemId, code: "NAVER_RETRY_REQUIRED" }] });

    await expect(advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "NAVER_VERIFICATION", expectedVersions: { [workItemId]: 1 }, actorUserId, now,
      manualEvidenceReason: "공공데이터 원천과 현장 상호가 같아 수동으로 넘긴다",
    })).resolves.toEqual({ advanced: [workItemId], skipped: [] });
  });

  it("updates a NAVER-stage address inside the region pack and clears cached NAVER evidence", async () => {
    const { db, actorUserId, businessLicenseId, workItemId } = await createSourceReviewItem();
    await advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 }, actorUserId, now,
    });
    await db.insert(naverLocalCategoryVerifications).values({
      businessLicenseId, status: "NO_MATCH", mappedCategoryId: null, matchScore: 0, specificityScore: 0, confidenceScore: 0,
      evidenceCodesJson: "[]", ruleVersion: "naver-category-v1", inputFingerprint: "nomatch", queriedAt: now, expiresAt: null, failureCode: null, createdAt: now, updatedAt: now,
    });

    await expect(updateReviewItemAddresses(db, {
      workItemIds: [workItemId],
      addressByWorkItem: { [workItemId]: "서울특별시 중구 세종대로 110" },
      actorUserId,
      now,
    })).resolves.toEqual({ changed: [], skipped: [{ workItemId, code: "REVIEW_ADDRESS_REGION_INVALID" }] });

    await expect(updateReviewItemAddresses(db, {
      workItemIds: [workItemId],
      addressByWorkItem: { [workItemId]: "광주광역시 북구 검수로 12" },
      actorUserId,
      now,
    })).resolves.toEqual({ changed: [workItemId], skipped: [] });
    await expect(db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, businessLicenseId) }))
      .resolves.toMatchObject({ roadAddress: "광주광역시 북구 검수로 12", regionCode: "GWANGJU", latitude: null, longitude: null });
    await expect(db.query.naverLocalCategoryVerifications.findFirst({ where: eq(naverLocalCategoryVerifications.businessLicenseId, businessLicenseId) }))
      .resolves.toBeUndefined();
  });

  it("clears place NAVER liveness when the place address changes", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const actorUserId = `review-actor-${suffix}`;
    const placeId = `review-place-${suffix}`;
    await db.insert(users).values({
      id: actorUserId, email: `${actorUserId}@example.test`, displayName: "검수 관리자", role: "ADMIN",
      passwordHash: null, passwordSalt: null, emailVerifiedAt: now, createdAt: now, updatedAt: now,
    });
    await db.insert(places).values({
      id: placeId, slug: placeId, name: "검수 장소", status: "DRAFT", address: "광주광역시 동구 서석로 1",
      neighborhood: "서석동", latitude: 35.146, longitude: 126.923, searchText: "검수 장소", createdAt: now, updatedAt: now,
    });
    await db.insert(placeLivenessStates).values({
      placeId, status: "MONITORING", kakaoStatus: "SKIPPED", naverStatus: "MATCHED",
      naverEvidenceCodesJson: "[]", evidenceJson: "{}", updatedAt: now,
    });
    const item = newReviewWorkItemValues({ placeId, sourceKind: "PLACE_SUGGESTION", now });
    await db.insert(placeReviewWorkItems).values({ ...item, stage: "NAVER_VERIFICATION", stageVersion: 1 });

    await expect(updateReviewItemAddresses(db, {
      workItemIds: [item.id],
      addressByWorkItem: { [item.id]: "광주광역시 북구 검수로 12" },
      actorUserId,
      now,
    })).resolves.toEqual({ changed: [item.id], skipped: [] });
    await expect(db.query.places.findFirst({ where: eq(places.id, placeId) }))
      .resolves.toMatchObject({ address: "광주광역시 북구 검수로 12" });
    await expect(db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) }))
      .resolves.toBeUndefined();
  });
});
