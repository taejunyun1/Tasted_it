import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, businessLicenses, placeReviewWorkItems, users } from "../../app/db/schema";
import { advancePlaceReviewWorkItems, excludePlaceReviewItems, holdPlaceReviewItems, newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";

const now = "2026-08-15T12:00:00.000Z";

async function createSourceReviewItem() {
  const db = createDb(env.DB);
  const suffix = crypto.randomUUID();
  const actorUserId = `review-actor-${suffix}`;
  const businessLicenseId = `review-license-${suffix}`;
  await db.insert(users).values({ id: actorUserId, email: `${actorUserId}@example.test`, displayName: "검수 관리자", role: "ADMIN", passwordHash: null, passwordSalt: null, emailVerifiedAt: now, createdAt: now, updatedAt: now });
  await db.insert(businessLicenses).values({
    id: businessLicenseId, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: suffix, businessName: "검수 식당", businessSubtype: "한식",
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
});
