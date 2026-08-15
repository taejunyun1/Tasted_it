import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, placeReviewWorkItems, places } from "../../app/db/schema";
import { recallPublishedPlaces, restoreRecalledPlaces } from "../../app/features/places/place-publication-recall.server";

const NOW = "2026-08-15T06:30:00.000Z";
const RESTORE_NOW = "2026-08-15T06:35:00.000Z";

describe("place publication recall", () => {
  it("hides only published places and restores only the audited recall run", async () => {
    const db = createDb(env.DB);
    const prefix = crypto.randomUUID();
    const publishedIds = [`${prefix}-published-a`, `${prefix}-published-b`];
    const hiddenId = `${prefix}-hidden`;
    await db.insert(places).values([
      ...publishedIds.map((id) => ({ id, slug: id, name: "공개 장소", status: "PUBLISHED" as const, address: "광주 동구", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: "공개", createdAt: NOW, updatedAt: NOW })),
      { id: hiddenId, slug: hiddenId, name: "기존 숨김", status: "HIDDEN" as const, address: "광주 동구", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: "숨김", createdAt: NOW, updatedAt: NOW },
    ]);

    const recalled = await recallPublishedPlaces(db, { actorUserId: null, now: NOW, reason: "카테고리 근거 재검증" });

    expect(recalled).toEqual({ recalled: 2, auditRunAt: NOW });
    expect(await db.select({ id: places.id, status: places.status }).from(places).where(inArray(places.id, [...publishedIds, hiddenId]))).toEqual(expect.arrayContaining([
      { id: publishedIds[0], status: "HIDDEN" }, { id: publishedIds[1], status: "HIDDEN" }, { id: hiddenId, status: "HIDDEN" },
    ]));
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.action, "RECALL_PUBLISHED_PLACES_FOR_CATEGORY_AUDIT"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: publishedIds[0], createdAt: NOW }), expect.objectContaining({ targetId: publishedIds[1], createdAt: NOW }),
    ]));
    expect(await db.select().from(placeReviewWorkItems).where(inArray(placeReviewWorkItems.placeId, publishedIds))).toEqual(expect.arrayContaining([
      expect.objectContaining({ placeId: publishedIds[0], sourceKind: "CATEGORY_RECALL", stage: "SOURCE_REVIEW" }),
      expect.objectContaining({ placeId: publishedIds[1], sourceKind: "CATEGORY_RECALL", stage: "SOURCE_REVIEW" }),
    ]));

    const restored = await restoreRecalledPlaces(db, { actorUserId: null, auditRunAt: NOW, now: RESTORE_NOW, reason: "검증 롤백" });
    expect(restored).toEqual({ restored: 2 });
    expect(await db.select({ id: places.id, status: places.status }).from(places).where(inArray(places.id, [...publishedIds, hiddenId]))).toEqual(expect.arrayContaining([
      { id: publishedIds[0], status: "PUBLISHED" }, { id: publishedIds[1], status: "PUBLISHED" }, { id: hiddenId, status: "HIDDEN" },
    ]));
  });
});
