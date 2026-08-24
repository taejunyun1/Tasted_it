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
import { advancePlaceReviewWorkItems, newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";

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
  await db.insert(businessLicenses).values({
    id: businessLicenseId, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: suffix, businessName: "체인 검수 식당", businessSubtype: "한식",
    salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
    lotAddress: null, roadAddress: "광주광역시 북구 검수로 1", phone: null, sourceX: null, sourceY: null, latitude: 35.16, longitude: 126.91,
    regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}", reviewStatus: "PENDING", reviewReason: null, reviewedBy: null, reviewedAt: null,
    firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
  });
  if (input.duplicatePlace) {
    await db.insert(places).values({
      id: `chain-dup-${suffix}`, slug: `chain-dup-${suffix}`, name: "체인 검수 식당", status: "PUBLISHED",
      address: "광주광역시 북구 검수로 1", neighborhood: "검수", latitude: 35.16, longitude: 126.91,
      searchText: "체인 검수 식당", createdAt: now, updatedAt: now,
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
  return { db, actorUserId, workItemId: item.id, otherWorkItemId: null as string | null };
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
