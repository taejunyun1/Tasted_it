import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, businessLicenses, categories, naverLocalCategoryVerifications, placeReviewWorkItems, users } from "../../app/db/schema";
import { applyCategoryFallback, suggestFallbackCategory } from "../../app/features/places/place-category-fallback.server";
import { newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";

const now = "2026-08-15T12:00:00.000Z";

async function loadCategoryRows() {
  const db = createDb(env.DB);
  return db.select().from(categories);
}

describe("suggestFallbackCategory", () => {
  it("resolves a non-leaf matched path to the general leaf of its family", async () => {
    const rows = await loadCategoryRows();
    expect(suggestFallbackCategory({ businessName: "검수 식당", businessSubtype: "기타", matchedCategoryPath: "음식점>한식" }, rows))
      .toEqual({ categoryId: "cat-korean-general", basis: "path" });
    expect(suggestFallbackCategory({ businessName: "검수 카페", businessSubtype: "기타", matchedCategoryPath: "카페,디저트>카페" }, rows))
      .toEqual({ categoryId: "cat-cafe-shop", basis: "path" });
  });

  it("maps licensed subtypes to their leaf categories", async () => {
    const rows = await loadCategoryRows();
    expect(suggestFallbackCategory({ businessName: "검수 식당", businessSubtype: "한식", matchedCategoryPath: null }, rows))
      .toEqual({ categoryId: "cat-korean-general", basis: "subtype" });
    expect(suggestFallbackCategory({ businessName: "검수 고깃집", businessSubtype: "식육(숯불구이)", matchedCategoryPath: null }, rows))
      .toEqual({ categoryId: "cat-grill", basis: "subtype" });
    expect(suggestFallbackCategory({ businessName: "검수 호프", businessSubtype: "호프/통닭", matchedCategoryPath: null }, rows))
      .toEqual({ categoryId: "cat-pub", basis: "subtype" });
    expect(suggestFallbackCategory({ businessName: "검수 커피", businessSubtype: "커피숍", matchedCategoryPath: null }, rows))
      .toEqual({ categoryId: "cat-cafe-shop", basis: "subtype" });
  });

  it("uses name keywords when path and subtype produce no leaf", async () => {
    const rows = await loadCategoryRows();
    expect(suggestFallbackCategory({ businessName: "김밥천국 광주점", businessSubtype: "기타", matchedCategoryPath: null }, rows))
      .toEqual({ categoryId: "cat-gimbap", basis: "name" });
    expect(suggestFallbackCategory({ businessName: "맛있는피자", businessSubtype: "일반음식점", matchedCategoryPath: null }, rows))
      .toEqual({ categoryId: "cat-pizza", basis: "name" });
    expect(suggestFallbackCategory({ businessName: "김밥천국 뷔페", businessSubtype: "뷔페식", matchedCategoryPath: null }, rows))
      .toEqual({ categoryId: "cat-gimbap", basis: "name" });
    expect(suggestFallbackCategory({ businessName: "김밥천국", businessSubtype: "한식", matchedCategoryPath: null }, rows))
      .toEqual({ categoryId: "cat-korean-general", basis: "subtype" });
  });

  it("falls back to the 기타 leaf only when some evidence exists", async () => {
    const rows = await loadCategoryRows();
    expect(suggestFallbackCategory({ businessName: "알 수 없는 가게", businessSubtype: "기타", matchedCategoryPath: null }, rows))
      .toEqual({ categoryId: "cat-other", basis: "fallback" });
    expect(suggestFallbackCategory({ businessName: "알 수 없는 가게", businessSubtype: "이동판매", matchedCategoryPath: null }, rows))
      .toEqual({ categoryId: "cat-other", basis: "fallback" });
    expect(suggestFallbackCategory({ businessName: null, businessSubtype: null, matchedCategoryPath: null }, rows))
      .toBeNull();
  });
});

describe("applyCategoryFallback", () => {
  it("assigns a leaf category with audit trail to selectedCategoryId-less items", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const actorUserId = `fallback-actor-${suffix}`;
    const businessLicenseId = `fallback-license-${suffix}`;
    await db.insert(users).values({ id: actorUserId, email: `${actorUserId}@example.test`, displayName: "검수 관리자", role: "ADMIN", passwordHash: null, passwordSalt: null, emailVerifiedAt: now, createdAt: now, updatedAt: now });
    await db.insert(businessLicenses).values({
      id: businessLicenseId, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: suffix, businessName: "검수 중국집", businessSubtype: "중국식",
      salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
      lotAddress: null, roadAddress: "광주광역시 북구 검수로 1", phone: null, sourceX: null, sourceY: null, latitude: 35.16, longitude: 126.91,
      regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}", reviewStatus: "PENDING", reviewReason: null, reviewedBy: null, reviewedAt: null,
      firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
    });
    const item = newReviewWorkItemValues({ businessLicenseId, sourceKind: "PUBLIC_DATA", now });
    await db.insert(placeReviewWorkItems).values({ ...item, stage: "CATEGORY_CONFIRMATION" });
    await db.insert(naverLocalCategoryVerifications).values({
      businessLicenseId, status: "VERIFIED", mappedCategoryId: null,
      matchScore: 90, specificityScore: 10, confidenceScore: 90,
      evidenceCodesJson: JSON.stringify(["NAVER_EXACT_NAME", "NAVER_EXACT_ADDRESS"]),
      matchedCategoryPath: null, ruleVersion: "test", inputFingerprint: suffix,
      queriedAt: now, expiresAt: null, failureCode: null, createdAt: now, updatedAt: now,
    });

    const result = await applyCategoryFallback(db, { limit: 200, actorUserId, now });
    expect(result.changed).toContain(item.id);
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, item.id) }))
      .resolves.toMatchObject({ selectedCategoryId: "cat-chinese-general", categoryOverrideReason: "fallback:subtype" });
    const audits = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, item.id));
    expect(audits.some((row) => row.action === "PLACE_REVIEW_CATEGORY_FALLBACK")).toBe(true);
  });

  it("does not overwrite an already-selected category", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const actorUserId = `fallback-actor-${suffix}`;
    const businessLicenseId = `fallback-license-${suffix}`;
    await db.insert(users).values({ id: actorUserId, email: `${actorUserId}@example.test`, displayName: "검수 관리자", role: "ADMIN", passwordHash: null, passwordSalt: null, emailVerifiedAt: now, createdAt: now, updatedAt: now });
    await db.insert(businessLicenses).values({
      id: businessLicenseId, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: suffix, businessName: "검수 식당", businessSubtype: "한식",
      salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
      lotAddress: null, roadAddress: "광주광역시 북구 검수로 1", phone: null, sourceX: null, sourceY: null, latitude: 35.16, longitude: 126.91,
      regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}", reviewStatus: "PENDING", reviewReason: null, reviewedBy: null, reviewedAt: null,
      firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
    });
    const item = newReviewWorkItemValues({ businessLicenseId, sourceKind: "PUBLIC_DATA", now });
    await db.insert(placeReviewWorkItems).values({ ...item, stage: "CATEGORY_CONFIRMATION", selectedCategoryId: "cat-sushi" });

    const result = await applyCategoryFallback(db, { limit: 200, actorUserId, now });
    expect(result.changed).not.toContain(item.id);
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, item.id) }))
      .resolves.toMatchObject({ selectedCategoryId: "cat-sushi" });
  });
});
