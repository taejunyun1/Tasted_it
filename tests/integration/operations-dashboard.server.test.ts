import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, businessLicenses, operationalAlerts, placeReviewWorkItems, places } from "../../app/db/schema";
import { recordOperationalAlert } from "../../app/features/operations/alerts.server";
import { getOperationalDashboard } from "../../app/features/operations/dashboard.server";
import { newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";

describe("operations dashboard", () => {
  it("deduplicates repeated alerts and exposes bounded time windows", async () => {
    const db = createDb(env.DB); const now = "2026-08-06T12:00:00.000Z";
    await recordOperationalAlert(db, { alertType: "PUBLIC_DATA_SYNC", sourceId: "test-run", message: "HTTP 500", details: {}, now });
    await recordOperationalAlert(db, { alertType: "PUBLIC_DATA_SYNC", sourceId: "test-run", message: "HTTP 500", details: {}, now });
    const row = (await db.select().from(operationalAlerts)).find((item) => item.sourceId === "test-run");
    expect(row?.occurrenceCount).toBe(2);
    const dashboard = await getOperationalDashboard(db, { now });
    expect(dashboard.windows.map((window) => window.label)).toEqual(["24시간", "7일", "30일"]);
    expect(dashboard.windows.every((window) =>
      typeof window.reviewPublished === "number"
      && typeof window.reviewHeld === "number"
      && typeof window.reviewExcluded === "number"
    )).toBe(true);
    expect(dashboard.alerts.some((item) => item.sourceId === "test-run")).toBe(true);
    expect(dashboard.reviewQueue.activeTotal).toBe(0);
    expect(dashboard.publishedPerDay7d).toBe(0);
    expect(dashboard.catalog).toEqual({ published: 0, hidden: 0, draft: 0 });
  });

  it("exposes 7-day publish rate, active queue depth, and catalog counts", async () => {
    const db = createDb(env.DB);
    const now = "2026-08-18T12:00:00.000Z";
    const suffix = crypto.randomUUID();
    async function insertLicense(label: string) {
      const id = `throughput-license-${label}-${suffix}`;
      await db.insert(businessLicenses).values({
        id, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: `${label}-${suffix}`, businessName: `처리량 ${label}`, businessSubtype: "한식",
        salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
        lotAddress: null, roadAddress: "광주광역시 북구 검수로 1", phone: null, sourceX: null, sourceY: null, latitude: 35.16, longitude: 126.91,
        regionCode: "GWANGJU", sourceUpdatedAt: now, rawPayload: "{}", reviewStatus: "PENDING", reviewReason: null, reviewedBy: null, reviewedAt: null,
        firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
      });
      return id;
    }
    const sourceLicenseId = await insertLicense("source");
    const naverLicenseId = await insertLicense("naver");
    const holdLicenseId = await insertLicense("hold");
    await db.insert(placeReviewWorkItems).values([
      newReviewWorkItemValues({ businessLicenseId: sourceLicenseId, sourceKind: "PUBLIC_DATA", now }),
      { ...newReviewWorkItemValues({ businessLicenseId: naverLicenseId, sourceKind: "PUBLIC_DATA", now: "2026-08-18T12:01:00.000Z" }), stage: "NAVER_VERIFICATION" },
      { ...newReviewWorkItemValues({ businessLicenseId: holdLicenseId, sourceKind: "PUBLIC_DATA", now: "2026-08-18T12:02:00.000Z" }), status: "ON_HOLD" },
    ]);
    await db.insert(adminAuditLogs).values([
      { id: `throughput-publish-1-${suffix}`, actorUserId: null, action: "PLACE_REVIEW_PUBLISH", targetType: "PLACE", targetId: `throughput-place-1-${suffix}`, beforeState: null, afterState: null, createdAt: "2026-08-16T10:00:00.000Z" },
      { id: `throughput-publish-2-${suffix}`, actorUserId: null, action: "PLACE_REVIEW_PUBLISH", targetType: "PLACE", targetId: `throughput-place-2-${suffix}`, beforeState: null, afterState: null, createdAt: "2026-08-16T11:00:00.000Z" },
    ]);
    await db.insert(places).values([
      { id: `throughput-published-${suffix}`, slug: `throughput-published-${suffix}`, name: "공개", status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "공개", createdAt: now, updatedAt: now },
      { id: `throughput-hidden-${suffix}`, slug: `throughput-hidden-${suffix}`, name: "숨김", status: "HIDDEN", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "숨김", createdAt: now, updatedAt: now },
      { id: `throughput-draft-${suffix}`, slug: `throughput-draft-${suffix}`, name: "초안", status: "DRAFT", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "초안", createdAt: now, updatedAt: now },
    ]);
    const dashboard = await getOperationalDashboard(db, { now });
    const week = dashboard.windows.find((window) => window.label === "7일");
    expect(week?.reviewPublished).toBe(2);
    expect(dashboard.publishedPerDay7d).toBe(0.29);
    expect(dashboard.reviewQueue).toMatchObject({
      SOURCE_REVIEW: 1,
      NAVER_VERIFICATION: 1,
      CATEGORY_CONFIRMATION: 0,
      DUPLICATE_REVIEW: 0,
      FINAL_APPROVAL: 0,
      activeTotal: 2,
      onHoldTotal: 1,
    });
    expect(dashboard.catalog).toEqual({ published: 1, hidden: 1, draft: 1 });
  });
});
