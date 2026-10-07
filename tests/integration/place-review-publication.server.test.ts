import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, businessLicenses, categories, placeCategories, placeReviewWorkItems, places, users } from "../../app/db/schema";
import { confirmLocalDiningReview } from "../../app/features/places/local-dining-review.server";
import { publishReviewedPlaces } from "../../app/features/places/place-review-publication.server";
import { newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";

const now = "2026-10-07T09:00:00.000Z";
const reason = "현장에서 좌석과 식사 제공을 확인했으며 독립적으로 운영하는 지역 식당입니다.";
const db = createDb(env.DB);

async function category(parentId: string | null = null, isActive = true) {
  const id = crypto.randomUUID();
  await db.insert(categories).values({ id, slug: id, name: "한식", emoji: "🍚", parentId, isActive, sortOrder: 0, createdAt: now, updatedAt: now });
  return id;
}

async function fixture(kind: "PLACE" | "LICENSE", selectedCategoryId: string | null, status: "HIDDEN" | "DRAFT" = "HIDDEN") {
  const id = crypto.randomUUID();
  const actorUserId = crypto.randomUUID();
  const name = `동네식당 ${id.slice(0, 8)}`;
  const address = "광주광역시 동구 동명로 10 (동명동)";
  await db.insert(users).values({ id: actorUserId, email: `${actorUserId}@example.test`, displayName: "검수 관리자", role: "ADMIN", createdAt: now, updatedAt: now });
  if (kind === "PLACE") {
    await db.insert(places).values({ id, slug: id, name, status, address, neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: name, createdAt: now, updatedAt: now });
  } else {
    await db.insert(businessLicenses).values({
      id, sourceType: "GENERAL_RESTAURANT", sourceManagementNo: id, businessName: name, businessSubtype: "한식",
      salesStatusCode: "01", salesStatusName: "영업/정상", detailStatusCode: "01", detailStatusName: "영업", normalizedStatus: "OPEN",
      roadAddress: address, latitude: 35.15, longitude: 126.92, regionCode: "GWANGJU", sourceUpdatedAt: now,
      rawPayload: "{}", reviewStatus: "PENDING", firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
    });
  }
  const item = newReviewWorkItemValues(kind === "PLACE" ? { placeId: id, sourceKind: "PLACE_SUGGESTION", now } : { businessLicenseId: id, sourceKind: "PUBLIC_DATA", now });
  await db.insert(placeReviewWorkItems).values({ ...item, stage: "CATEGORY_CONFIRMATION", selectedCategoryId });
  await confirmLocalDiningReview(db, { workItemIds: [item.id], expectedVersions: { [item.id]: 0 }, actorUserId, reason, confirmed: true, now });
  await db.update(placeReviewWorkItems).set({ stage: "FINAL_APPROVAL" }).where(eq(placeReviewWorkItems.id, item.id));
  return { id, actorUserId, workItemId: item.id, version: 1 };
}

async function publish(f: Awaited<ReturnType<typeof fixture>>, version = f.version) {
  return publishReviewedPlaces(db, { workItemIds: [f.workItemId], expectedVersions: { [f.workItemId]: version }, actorUserId: f.actorUserId, now });
}

async function expectUntouched(f: Awaited<ReturnType<typeof fixture>>, originalStatus?: "HIDDEN" | "DRAFT", originalCategoryId?: string) {
  await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, f.workItemId) })).resolves.toMatchObject({
    stage: "FINAL_APPROVAL", status: "ACTIVE", stageVersion: 1, claimToken: null, claimedBy: null, claimedAt: null, completedAt: null,
  });
  expect(await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, f.workItemId), eq(adminAuditLogs.action, "PLACE_REVIEW_PUBLISH")))).toHaveLength(0);
  if (originalStatus) {
    await expect(db.query.places.findFirst({ where: eq(places.id, f.id) })).resolves.toMatchObject({ status: originalStatus });
    expect(await db.select().from(placeCategories).where(eq(placeCategories.placeId, f.id))).toEqual(originalCategoryId
      ? [expect.objectContaining({ categoryId: originalCategoryId, isPrimary: true })] : []);
  } else {
    await expect(db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, f.id) })).resolves.toMatchObject({ reviewStatus: "PENDING" });
    expect(await db.select().from(places).where(eq(places.name, `동네식당 ${f.id.slice(0, 8)}`))).toHaveLength(0);
  }
}

describe("final review publication rechecks the selected active leaf", () => {
  it("blocks an existing hidden place when its selected category was deactivated", async () => {
    const chosen = await category();
    const f = await fixture("PLACE", chosen);
    const originalCategoryId = await category();
    await db.insert(placeCategories).values({ placeId: f.id, categoryId: originalCategoryId, isPrimary: true });
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, chosen));
    expect(await publish(f)).toEqual({ published: [], skipped: [{ workItemId: f.workItemId, code: "CATEGORY_REQUIRED" }] });
    await expectUntouched(f, "HIDDEN", originalCategoryId);
  });

  it("blocks a category that gained an active child after final approval", async () => {
    const chosen = await category();
    const f = await fixture("PLACE", chosen);
    await category(chosen);
    expect(await publish(f)).toEqual({ published: [], skipped: [{ workItemId: f.workItemId, code: "CATEGORY_REQUIRED" }] });
    await expectUntouched(f, "HIDDEN");
  });

  it("publishes a valid active leaf and records its primary association and audit", async () => {
    const chosen = await category();
    const f = await fixture("PLACE", chosen);
    expect(await publish(f)).toEqual({ published: [f.workItemId], skipped: [] });
    await expect(db.query.places.findFirst({ where: eq(places.id, f.id) })).resolves.toMatchObject({ status: "PUBLISHED" });
    await expect(db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, f.workItemId) })).resolves.toMatchObject({ status: "COMPLETED", completedAt: now });
    expect(await db.select().from(placeCategories).where(eq(placeCategories.placeId, f.id))).toEqual([expect.objectContaining({ categoryId: chosen, isPrimary: true })]);
    expect(await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, f.workItemId), eq(adminAuditLogs.action, "PLACE_REVIEW_PUBLISH")))).toHaveLength(1);
  });

  it("accepts an active parent whose only child is inactive", async () => {
    const chosen = await category();
    await category(chosen, false);
    const f = await fixture("PLACE", chosen);
    expect(await publish(f)).toEqual({ published: [f.workItemId], skipped: [] });
  });

  it("blocks an invalid license category before candidate approval creates a place", async () => {
    const chosen = await category();
    const f = await fixture("LICENSE", chosen);
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, chosen));
    expect(await publish(f)).toEqual({ published: [], skipped: [{ workItemId: f.workItemId, code: "CATEGORY_REQUIRED" }] });
    await expectUntouched(f);
  });

  it("publishes only the valid item in a mixed batch", async () => {
    const validCategory = await category();
    const invalidCategory = await category();
    const valid = await fixture("PLACE", validCategory);
    const invalid = await fixture("PLACE", invalidCategory);
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, invalidCategory));
    const result = await publishReviewedPlaces(db, { workItemIds: [valid.workItemId, invalid.workItemId], expectedVersions: { [valid.workItemId]: 1, [invalid.workItemId]: 1 }, actorUserId: valid.actorUserId, now });
    expect(result.published).toEqual([valid.workItemId]);
    expect(result.skipped).toEqual([{ workItemId: invalid.workItemId, code: "CATEGORY_REQUIRED" }]);
    await expectUntouched(invalid, "HIDDEN");
  });

  it("requires a selected category before touching an existing place", async () => {
    const f = await fixture("PLACE", null);
    expect(await publish(f)).toEqual({ published: [], skipped: [{ workItemId: f.workItemId, code: "CATEGORY_REQUIRED" }] });
    await expectUntouched(f, "HIDDEN");
  });

  it("preserves stale-version priority even for a valid leaf", async () => {
    const chosen = await category();
    const f = await fixture("PLACE", chosen);
    expect(await publish(f, 0)).toEqual({ published: [], skipped: [{ workItemId: f.workItemId, code: "STALE_WORK_ITEM" }] });
    await expectUntouched(f, "HIDDEN");
  });
});
