import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import {
  businessLicenses,
  categories,
  naverLocalCategoryVerifications,
  placeReviewWorkItems,
  places,
} from "../../app/db/schema";
import { advanceConfidentReviewWorkItems, advancePlaceReviewWorkItems, newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";

const now = "2026-08-24T12:00:00.000Z";

async function countPublished() {
  const db = createDb(env.DB);
  const rows = await db.select({ id: places.id }).from(places).where(eq(places.status, "PUBLISHED"));
  return rows.length;
}

async function createCandidateReview(input: {
  mappedCategory: "leaf" | "broad" | "none";
  naverStatus: "VERIFIED" | "NO_MATCH";
  duplicatePlace?: boolean;
}) {
  const db = createDb(env.DB);
  const suffix = crypto.randomUUID();
  const actorUserId = `chain-actor-${suffix}`;
  const businessLicenseId = `chain-license-${suffix}`;
  const parentId = `chain-parent-${suffix}`;
  const leafId = `chain-leaf-${suffix}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES (?, ?, '체인 관리자', 'ADMIN', ?, ?)")
      .bind(actorUserId, `${actorUserId}@example.test`, now, now),
    env.DB.prepare("INSERT INTO categories (id, slug, name, emoji, is_active, sort_order, created_at, updated_at) VALUES (?, ?, '한식', '🍚', 1, 1, ?, ?)")
      .bind(parentId, parentId, now, now),
    env.DB.prepare("INSERT INTO categories (id, slug, name, emoji, parent_id, is_active, sort_order, created_at, updated_at) VALUES (?, ?, '국밥', '🥣', ?, 1, 2, ?, ?)")
      .bind(leafId, leafId, parentId, now, now),
  ]);
  const businessName = `체인 검수 식당 ${suffix.slice(0, 8)}`;
  const roadAddress = `광주광역시 북구 검수로 ${suffix.slice(0, 8)}`;
  await db.insert(businessLicenses).values({
    id: businessLicenseId, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: suffix, businessName, businessSubtype: "한식",
    salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
    lotAddress: null, roadAddress, phone: null, sourceX: null, sourceY: null, latitude: 35.16, longitude: 126.91,
    regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}", reviewStatus: "PENDING", reviewReason: null, reviewedBy: null, reviewedAt: null,
    firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
  });
  if (input.duplicatePlace) {
    await db.insert(places).values({
      id: `chain-dup-${suffix}`, slug: `chain-dup-${suffix}`, name: businessName, status: "PUBLISHED",
      address: roadAddress, neighborhood: "검수", latitude: 35.16, longitude: 126.91,
      searchText: businessName, createdAt: now, updatedAt: now,
    });
  }
  if (input.naverStatus === "VERIFIED" || input.naverStatus === "NO_MATCH") {
    const mappedCategoryId = input.mappedCategory === "leaf" ? leafId : input.mappedCategory === "broad" ? parentId : null;
    await db.insert(naverLocalCategoryVerifications).values({
      businessLicenseId,
      status: input.naverStatus,
      mappedCategoryId,
      matchScore: input.naverStatus === "VERIFIED" ? 1 : 0,
      specificityScore: input.mappedCategory === "leaf" ? 1 : 0,
      confidenceScore: input.naverStatus === "VERIFIED" ? 1 : 0,
      evidenceCodesJson: input.mappedCategory === "broad" ? '["NAVER_BROAD_CATEGORY"]' : "[]",
      ruleVersion: "naver-category-v1",
      inputFingerprint: suffix,
      queriedAt: now,
      expiresAt: null,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  const item = newReviewWorkItemValues({ businessLicenseId, sourceKind: "PUBLIC_DATA", now });
  await db.insert(placeReviewWorkItems).values(item);
  return { db, actorUserId, workItemId: item.id, businessLicenseId, otherWorkItemId: null as string | null };
}

describe("confident review advance chain", () => {
  it("chains a verified leaf item to final-approval wait without publishing", async () => {
    const publishedBefore = await countPublished();
    const { db, actorUserId, workItemId } = await createCandidateReview({ mappedCategory: "leaf", naverStatus: "VERIFIED" });
    const other = await createCandidateReview({ mappedCategory: "leaf", naverStatus: "VERIFIED" });

    const result = await advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId],
      expectedStage: "SOURCE_REVIEW",
      expectedVersions: { [workItemId]: 0 },
      actorUserId,
      now,
      confidentAdvanceEnabled: true,
    });

    expect(result.advanced).toEqual([workItemId]);
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) }))
      .resolves.toMatchObject({ stage: "FINAL_APPROVAL", status: "ACTIVE" });
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, other.workItemId) }))
      .resolves.toMatchObject({ stage: "SOURCE_REVIEW", status: "ACTIVE" });
    await expect(countPublished()).resolves.toBe(publishedBefore);
  });

  it("stops on no-match after the source stamp", async () => {
    const { db, actorUserId, workItemId } = await createCandidateReview({ mappedCategory: "none", naverStatus: "NO_MATCH" });
    await advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 }, actorUserId, now, confidentAdvanceEnabled: true,
    });
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) }))
      .resolves.toMatchObject({ stage: "NAVER_VERIFICATION" });
  });

  it("stops on a broad NAVER mapping", async () => {
    const { db, actorUserId, workItemId } = await createCandidateReview({ mappedCategory: "broad", naverStatus: "VERIFIED" });
    await advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 }, actorUserId, now, confidentAdvanceEnabled: true,
    });
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) }))
      .resolves.toMatchObject({ stage: "NAVER_VERIFICATION" });
  });

  it("stops on an open duplicate instead of publishing", async () => {
    const { db, actorUserId, workItemId } = await createCandidateReview({
      mappedCategory: "leaf", naverStatus: "VERIFIED", duplicatePlace: true,
    });
    const publishedBefore = await countPublished();
    await advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 }, actorUserId, now, confidentAdvanceEnabled: true,
    });
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) }))
      .resolves.toMatchObject({ stage: "DUPLICATE_REVIEW", status: "ACTIVE" });
    await expect(countPublished()).resolves.toBe(publishedBefore);
  });

  it("does not chain when the switch is off", async () => {
    const { db, actorUserId, workItemId } = await createCandidateReview({ mappedCategory: "leaf", naverStatus: "VERIFIED" });
    await advancePlaceReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 }, actorUserId, now,
    });
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) }))
      .resolves.toMatchObject({ stage: "NAVER_VERIFICATION" });
  });
});

describe("confident review advance button", () => {
  it("moves 0 items when the switch is off", async () => {
    const publishedBefore = await countPublished();
    const { db, actorUserId, workItemId } = await createCandidateReview({ mappedCategory: "leaf", naverStatus: "VERIFIED" });

    const result = await advanceConfidentReviewWorkItems(db, {
      workItemIds: [workItemId],
      expectedStage: "SOURCE_REVIEW",
      expectedVersions: { [workItemId]: 0 },
      actorUserId,
      now,
      confidentAdvanceEnabled: false,
    });

    expect(result.advanced).toEqual([]);
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) }))
      .resolves.toMatchObject({ stage: "SOURCE_REVIEW", status: "ACTIVE", stageVersion: 0 });
    await expect(countPublished()).resolves.toBe(publishedBefore);
  });

  it("chains selected verified leaf items to final-approval wait without publishing or calling NAVER", async () => {
    const publishedBefore = await countPublished();
    const { db, actorUserId, workItemId, businessLicenseId } = await createCandidateReview({ mappedCategory: "leaf", naverStatus: "VERIFIED" });
    const other = await createCandidateReview({ mappedCategory: "leaf", naverStatus: "VERIFIED" });
    const verificationBefore = await db.query.naverLocalCategoryVerifications.findFirst({
      where: eq(naverLocalCategoryVerifications.businessLicenseId, businessLicenseId),
    });

    const result = await advanceConfidentReviewWorkItems(db, {
      workItemIds: [workItemId],
      expectedStage: "SOURCE_REVIEW",
      expectedVersions: { [workItemId]: 0 },
      actorUserId,
      now,
      confidentAdvanceEnabled: true,
    });

    expect(result.advanced).toEqual([workItemId]);
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) }))
      .resolves.toMatchObject({ stage: "FINAL_APPROVAL", status: "ACTIVE" });
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, other.workItemId) }))
      .resolves.toMatchObject({ stage: "SOURCE_REVIEW", status: "ACTIVE" });
    await expect(countPublished()).resolves.toBe(publishedBefore);

    const verificationAfter = await db.query.naverLocalCategoryVerifications.findFirst({
      where: eq(naverLocalCategoryVerifications.businessLicenseId, businessLicenseId),
    });
    expect(verificationAfter?.queriedAt).toBe(verificationBefore?.queriedAt);
    expect(verificationAfter?.status).toBe("VERIFIED");
  });

  it("leaves no-match items at naver verification and does not publish", async () => {
    const publishedBefore = await countPublished();
    const { db, actorUserId, workItemId } = await createCandidateReview({ mappedCategory: "none", naverStatus: "NO_MATCH" });

    await advanceConfidentReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 }, actorUserId, now, confidentAdvanceEnabled: true,
    });

    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) }))
      .resolves.toMatchObject({ stage: "NAVER_VERIFICATION", status: "ACTIVE" });
    await expect(countPublished()).resolves.toBe(publishedBefore);
  });

  it("reports NAVER_REVIEW_REQUIRED instead of CATEGORY_REQUIRED when no-match is already at naver", async () => {
    const { db, actorUserId, workItemId } = await createCandidateReview({ mappedCategory: "none", naverStatus: "NO_MATCH" });
    await advanceConfidentReviewWorkItems(db, {
      workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 }, actorUserId, now, confidentAdvanceEnabled: true,
    });
    const current = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) });
    expect(current?.stage).toBe("NAVER_VERIFICATION");
    const result = await advanceConfidentReviewWorkItems(db, {
      workItemIds: [workItemId],
      expectedStage: "NAVER_VERIFICATION",
      expectedVersions: { [workItemId]: current?.stageVersion ?? 0 },
      actorUserId,
      now,
      confidentAdvanceEnabled: true,
    });
    expect(result.advanced).toEqual([]);
    expect(result.skipped).toEqual([{ workItemId, code: "NAVER_REVIEW_REQUIRED" }]);
  });
});
