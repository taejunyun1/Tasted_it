import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { businessLicenses, placeReviewWorkItems } from "../../app/db/schema";
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
});
