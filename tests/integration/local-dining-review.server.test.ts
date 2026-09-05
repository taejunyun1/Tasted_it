import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { categories, placeReviewWorkItems, places, users } from "../../app/db/schema";
import { advancePlaceReviewWorkItems, createReviewWorkItem, newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";
import { confirmLocalDiningReview, getReviewDiningContext } from "../../app/features/places/local-dining-review.server";
import { publishReviewedPlaces } from "../../app/features/places/place-review-publication.server";
import { verifyReviewItemsWithNaver } from "../../app/features/places/place-review-naver.server";

const now = "2026-09-05T10:00:00.000Z";
const reason = "현장 방문으로 좌석과 식사 제공을 확인했고 체인이 아닌 독립 로컬 식당입니다.";
async function fixture(name = "동네 밥상") {
  const db = createDb(env.DB); const id = crypto.randomUUID();
  await db.insert(users).values({ id, email: `${id}@example.test`, displayName: "관리자", role: "ADMIN", createdAt: now, updatedAt: now });
  await db.insert(categories).values({ id, slug: id, name: "한식", emoji: "🍚", isActive: true, sortOrder: 0, createdAt: now, updatedAt: now });
  await db.insert(places).values({ id, slug: id, name, status: "DRAFT", address: "광주광역시 동구 동명로 10", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: name, createdAt: now, updatedAt: now });
  const item = newReviewWorkItemValues({ placeId: id, sourceKind: "PLACE_SUGGESTION", now });
  await db.insert(placeReviewWorkItems).values({ ...item, stage: "CATEGORY_CONFIRMATION", selectedCategoryId: id });
  return { db, id, workItemId: item.id, item: (await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, item.id) }))! };
}
describe("local dining gates across the admin pipeline", () => {
  it("blocks category advance without explicit local/dine-in evidence", async () => {
    const f = await fixture();
    const result = await advancePlaceReviewWorkItems(f.db, { workItemIds: [f.workItemId], expectedStage: "CATEGORY_CONFIRMATION", expectedVersions: { [f.workItemId]: 0 }, actorUserId: f.id, now });
    expect(result).toEqual({ advanced: [], skipped: [{ workItemId: f.workItemId, code: "LOCAL_DINING_REVIEW_REQUIRED" }] });
  });
  it("binds manual confirmation to the subject and does not publish or advance on confirmation", async () => {
    const f = await fixture();
    await confirmLocalDiningReview(f.db, { workItemIds: [f.workItemId], expectedVersions: { [f.workItemId]: 0 }, actorUserId: f.id, reason, confirmed: true, now });
    const item = (await f.db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, f.workItemId) }))!;
    expect(item).toMatchObject({ stage: "CATEGORY_CONFIRMATION", stageVersion: 1, status: "ACTIVE" });
    expect((await getReviewDiningContext(f.db, item, now)).decision.decision).toBe("ELIGIBLE");
    await f.db.update(places).set({ address: "광주광역시 동구 동명로 99" }).where(eq(places.id, f.id));
    expect((await getReviewDiningContext(f.db, item, now)).decision.decision).toBe("REVIEW");
    expect((await f.db.query.places.findFirst({ where: eq(places.id, f.id) }))?.status).toBe("DRAFT");
  });
  it("does not let a manual confirmation bypass a known chain", async () => {
    const f = await fixture("파리바게뜨 광주점");
    await expect(confirmLocalDiningReview(f.db, { workItemIds: [f.workItemId], expectedVersions: { [f.workItemId]: 0 }, actorUserId: f.id, reason, confirmed: true, now })).rejects.toThrow("ACTIVE_EXCLUSION");
    expect((await f.db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, f.workItemId) }))?.status).toBe("EXCLUDED");
  });
  it("rechecks final-stage legacy items instead of trusting a chosen category", async () => {
    const f = await fixture();
    await f.db.update(placeReviewWorkItems).set({ stage: "FINAL_APPROVAL" }).where(eq(placeReviewWorkItems.id, f.workItemId));
    const result = await publishReviewedPlaces(f.db, { workItemIds: [f.workItemId], expectedVersions: { [f.workItemId]: 0 }, actorUserId: f.id, now });
    expect(result).toEqual({ published: [], skipped: [{ workItemId: f.workItemId, code: "LOCAL_DINING_REVIEW_REQUIRED" }] });
  });
  it("uses only identity-matched NAVER category evidence, then automatically excludes a PLACE", async () => {
    const f = await fixture("바다상회");
    await f.db.update(placeReviewWorkItems).set({ stage: "NAVER_VERIFICATION" }).where(eq(placeReviewWorkItems.id, f.workItemId));
    await verifyReviewItemsWithNaver(f.db, { workItemIds: [f.workItemId], actorUserId: f.id, now, adapter: { search: async () => [{ name: "바다상회", category: "쇼핑,유통>수산물도매", address: "광주광역시 동구 동명로 10", latitude: 35.15, longitude: 126.92 }] } });
    const item = (await f.db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, f.workItemId) }))!;
    expect(item.status).toBe("EXCLUDED");
    expect(item.holdNote).toContain("유통·도매");
  });
  it("does not require a separate exclude click for newly created known chains", async () => {
    const f = await fixture("스타벅스 광주점");
    await f.db.delete(placeReviewWorkItems).where(eq(placeReviewWorkItems.id, f.workItemId));
    const item = await createReviewWorkItem(f.db, { placeId: f.id, sourceKind: "PLACE_SUGGESTION", now });
    expect((await f.db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, item.id) }))?.status).toBe("EXCLUDED");
  });
});
