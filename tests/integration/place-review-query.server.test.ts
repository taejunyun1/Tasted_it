import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { businessLicenses, categories, naverLocalCategoryVerifications, placeReviewWorkItems } from "../../app/db/schema";
import { listPlaceReviewWorkItems } from "../../app/features/places/place-review-query.server";

const now = "2026-08-15T12:00:00.000Z";

describe("place review work item query", () => {
  it("uses database pagination and applies its filters to rows and counts", async () => {
    const db = createDb(env.DB);
    const prefix = `review-page-${crypto.randomUUID()}`;
    const licenses = Array.from({ length: 60 }, (_, index) => ({
      id: `${prefix}-license-${String(index).padStart(2, "0")}`,
      sourceType: "GENERAL_RESTAURANT" as const,
      sourceManagementNo: `${prefix}-source-${index}`,
      businessName: index === 31 ? "검수 국밥" : `검수 식당 ${String(index).padStart(2, "0")}`,
      businessSubtype: "한식",
      salesStatusCode: "01",
      salesStatusName: "영업/정상",
      detailStatusCode: "01",
      detailStatusName: "영업",
      normalizedStatus: "OPEN" as const,
      lotAddress: null,
      roadAddress: `${index < 30 ? "광주광역시" : "전라남도"} 검수시 검수로 ${index}`,
      phone: null,
      sourceX: null,
      sourceY: null,
      latitude: 35 + index / 1000,
      longitude: 126 + index / 1000,
      regionCode: index < 30 ? "GWANGJU" as const : "JEONNAM" as const,
      sourceUpdatedAt: now,
      rawPayload: "{}",
      reviewStatus: "PENDING" as const,
      reviewReason: null,
      reviewedBy: null,
      reviewedAt: null,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    }));
    const workItems = licenses.map((license, index) => ({
      id: `${prefix}-work-${String(index).padStart(2, "0")}`,
      businessLicenseId: license.id,
      placeId: null,
      sourceKind: "PUBLIC_DATA" as const,
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
      createdAt: now,
      updatedAt: now,
    }));

    for (const [index, license] of licenses.entries()) {
      await db.insert(businessLicenses).values(license);
      await db.insert(placeReviewWorkItems).values(workItems[index]!);
    }

    await expect(listPlaceReviewWorkItems(db, {
      step: 1,
      page: 2,
      pageSize: 25,
      status: "pending",
      region: null,
      query: "",
    })).resolves.toMatchObject({
      rows: expect.arrayContaining([expect.objectContaining({ workItemId: `${prefix}-work-25` })]),
      pagination: { page: 2, pageSize: 25, total: 60, totalPages: 3 },
    });

    await expect(listPlaceReviewWorkItems(db, {
      step: 1,
      page: 1,
      pageSize: 25,
      status: "pending",
      region: "JEONNAM",
      query: "국밥",
    })).resolves.toMatchObject({
      rows: [expect.objectContaining({ name: "검수 국밥", region: "JEONNAM" })],
      pagination: { total: 1, totalPages: 1 },
    });
  });

  it("exposes the NAVER mapped category for category confirmation", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const category = await db.query.categories.findFirst({ where: (row, { eq }) => eq(row.slug, "gukbap-detail") });
    expect(category).toBeTruthy();
    const licenseId = `review-naver-license-${suffix}`;
    const workItemId = `review-naver-work-${suffix}`;
    await db.insert(businessLicenses).values({
      id: licenseId, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: suffix, businessName: "NAVER 근거 국밥", businessSubtype: "국밥",
      salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
      lotAddress: null, roadAddress: "광주광역시 북구 검수로 1", phone: null, sourceX: null, sourceY: null, latitude: 35.16, longitude: 126.91,
      regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}", reviewStatus: "PENDING", reviewReason: null, reviewedBy: null, reviewedAt: null,
      firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
    });
    await db.insert(placeReviewWorkItems).values({
      id: workItemId, businessLicenseId: licenseId, placeId: null, sourceKind: "PUBLIC_DATA", stage: "CATEGORY_CONFIRMATION", status: "ACTIVE",
      selectedCategoryId: null, categoryOverrideReason: null, manualEvidenceReason: null, stageVersion: 2, claimToken: null, claimedBy: null, claimedAt: null,
      lastTransitionBy: null, lastTransitionAt: null, holdCode: null, holdNote: null, completedAt: null, createdAt: now, updatedAt: now,
    });
    await db.insert(naverLocalCategoryVerifications).values({
      businessLicenseId: licenseId, status: "VERIFIED", mappedCategoryId: category!.id, matchScore: 60, specificityScore: 20, confidenceScore: 80,
      evidenceCodesJson: "[]", ruleVersion: "naver-category-v1", inputFingerprint: suffix, queriedAt: now, expiresAt: "2099-08-15T12:00:00.000Z", failureCode: null, createdAt: now, updatedAt: now,
    });

    await expect(listPlaceReviewWorkItems(db, {
      step: 3, page: 1, pageSize: 25, status: "pending", region: null, query: "NAVER 근거 국밥",
    })).resolves.toMatchObject({
      rows: [expect.objectContaining({ workItemId, naverMappedCategoryId: category!.id, naverMappedCategoryName: category!.name })],
    });
  });

  it("lists coordinate-ready items first and can filter to only those", async () => {
    const db = createDb(env.DB);
    const token = `readyq${crypto.randomUUID().replaceAll("-", "")}`;
    const rows = [
      { suffix: "blockeda", latitude: null as number | null, longitude: null as number | null, updatedAt: "2026-08-15T11:00:00.000Z" },
      { suffix: "blockedb", latitude: null, longitude: null, updatedAt: "2026-08-15T11:01:00.000Z" },
      { suffix: "ready", latitude: 35.16, longitude: 126.91, updatedAt: "2026-08-15T12:00:00.000Z" },
    ];
    for (const row of rows) {
      await db.insert(businessLicenses).values({
        id: `${token}-${row.suffix}`, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: `${token}-${row.suffix}`,
        businessName: `${token} ${row.suffix}`, businessSubtype: "한식",
        salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
        lotAddress: null, roadAddress: "광주광역시 북구 검수로 1", phone: null, sourceX: null, sourceY: null,
        latitude: row.latitude, longitude: row.longitude, regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}",
        reviewStatus: "PENDING", reviewReason: null, reviewedBy: null, reviewedAt: null,
        firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: row.updatedAt,
      });
      await db.insert(placeReviewWorkItems).values({
        id: `${token}-work-${row.suffix}`, businessLicenseId: `${token}-${row.suffix}`, placeId: null, sourceKind: "PUBLIC_DATA",
        stage: "SOURCE_REVIEW", status: "ACTIVE", selectedCategoryId: null, categoryOverrideReason: null, manualEvidenceReason: null,
        stageVersion: 0, claimToken: null, claimedBy: null, claimedAt: null, lastTransitionBy: null, lastTransitionAt: null,
        holdCode: null, holdNote: null, completedAt: null, createdAt: now, updatedAt: row.updatedAt,
      });
    }

    const pending = await listPlaceReviewWorkItems(db, {
      step: 1, page: 1, pageSize: 25, status: "pending", region: null, query: token,
    });
    expect(pending.rows.map((row) => row.workItemId)).toEqual([
      `${token}-work-ready`,
      `${token}-work-blockeda`,
      `${token}-work-blockedb`,
    ]);
    expect(pending.rows[0]?.blockCodes).toEqual([]);
    expect(pending.rows[1]?.blockCodes).toContain("SOURCE_NOT_READY");

    await expect(listPlaceReviewWorkItems(db, {
      step: 1, page: 1, pageSize: 25, status: "ready", region: null, query: token,
    })).resolves.toMatchObject({
      rows: [expect.objectContaining({ workItemId: `${token}-work-ready`, blockCodes: [] })],
      pagination: { total: 1, totalPages: 1 },
    });
  });
});
