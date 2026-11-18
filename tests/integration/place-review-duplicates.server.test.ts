import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, placeReviewDuplicateResolutions, placeReviewWorkItems, places, users } from "../../app/db/schema";
import { listReviewDuplicateCandidates, openReviewDuplicateCount, resolveReviewDuplicates } from "../../app/features/places/place-review-duplicates.server";

const now = "2026-08-15T08:00:00.000Z";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM place_review_duplicate_resolutions"),
    env.DB.prepare("DELETE FROM place_review_work_items"),
    env.DB.prepare("DELETE FROM places WHERE id LIKE 'review-duplicate-%'"),
    env.DB.prepare("DELETE FROM business_licenses WHERE id LIKE 'review-duplicate-%'"),
  ]);
});

describe("place review duplicate candidates", () => {
  it("only presents independent same-name places at the same location", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES ('review-duplicate-existing','review-duplicate-existing','동명식당','HIDDEN','광주광역시 동구 예술길 1','동명동',35.15,126.92,'동명식당',?,?)").bind(now, now),
      env.DB.prepare("INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES ('review-duplicate-chain','review-duplicate-chain','파리바게뜨 동명점','HIDDEN','광주광역시 동구 예술길 1','동명동',35.15,126.92,'파리바게뜨',?,?)").bind(now, now),
      env.DB.prepare("INSERT INTO business_licenses (id,source_type,source_management_no,business_name,business_subtype,sales_status_code,sales_status_name,detail_status_code,detail_status_name,normalized_status,road_address,latitude,longitude,region_code,source_updated_at,raw_payload,review_status,first_seen_at,last_seen_at,created_at,updated_at) VALUES ('review-duplicate-license','GENERAL_RESTAURANT','review-duplicate-license','동명식당','한식','01','영업','01','영업','OPEN','광주광역시 동구 예술길 1',35.15,126.92,'GWANGJU',?,'{}','PENDING',?,?,?,?)").bind(now, now, now, now, now),
      env.DB.prepare("INSERT INTO place_review_work_items (id,business_license_id,source_kind,stage,status,stage_version,created_at,updated_at) VALUES ('review-duplicate-item','review-duplicate-license','PUBLIC_DATA','DUPLICATE_REVIEW','ACTIVE',0,?,?)").bind(now, now),
    ]);
    const db = createDb(env.DB);
    await expect(listReviewDuplicateCandidates(db, ["review-duplicate-item"])).resolves.toEqual([
      expect.objectContaining({ workItemId: "review-duplicate-item", candidatePlaceId: "review-duplicate-existing", reason: "SAME_ADDRESS", decision: null }),
    ]);
  });

  it.each(["DISTINCT", "LINK_EXISTING", "MERGE"] as const)("records %s and its audit without silently merging or publishing a place", async (decision) => {
    const db = createDb(env.DB);
    const { workItemId, candidatePlaceId, actorUserId } = await seedDecisionPair(db, decision);
    const beforePlaces = await db.select().from(places);
    const beforeItem = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) });
    const reason = `합성 중복 후보를 대조하여 ${decision} 판정을 기록합니다.`;

    expect(await openReviewDuplicateCount(db, beforeItem!)).toBe(1);
    expect(await resolveReviewDuplicates(db, { resolutions: [{ workItemId, candidatePlaceId, decision, reason }], actorUserId, now }))
      .toEqual({ accepted: [`${workItemId}|${candidatePlaceId}`], skipped: [] });

    const resolutions = await db.select().from(placeReviewDuplicateResolutions).where(eq(placeReviewDuplicateResolutions.workItemId, workItemId));
    expect(resolutions).toEqual([expect.objectContaining({ candidatePlaceId, decision, reason, reviewedBy: actorUserId, reviewedAt: now })]);
    const audits = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, workItemId));
    expect(audits).toEqual([expect.objectContaining({ actorUserId, action: "PLACE_REVIEW_DUPLICATE_DECISION", targetType: "PLACE_REVIEW_WORK_ITEM", createdAt: now })]);
    expect(JSON.parse(audits[0]!.afterState!)).toEqual({ candidatePlaceId, decision, reason });
    expect(await openReviewDuplicateCount(db, beforeItem!)).toBe(0);
    expect(await listReviewDuplicateCandidates(db, [workItemId])).toEqual([expect.objectContaining({ candidatePlaceId, decision })]);
    // This step records a review decision. Actual public changes use B09's
    // separately authenticated preview/confirmation operation.
    expect(await db.select().from(places)).toEqual(beforePlaces);
    expect(await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, workItemId) })).toEqual(beforeItem);
  });

  it("rejects a no-longer-matching duplicate without recording a decision or audit", async () => {
    const db = createDb(env.DB);
    const { workItemId, candidatePlaceId, actorUserId } = await seedDecisionPair(db, "stale");
    expect(await listReviewDuplicateCandidates(db, [workItemId])).toHaveLength(1);
    await db.update(places).set({ name: "별개의 현재 상호", updatedAt: "2026-08-15T09:00:00.000Z" }).where(eq(places.id, candidatePlaceId));
    const beforePlaces = await db.select().from(places);

    expect(await resolveReviewDuplicates(db, {
      resolutions: [{ workItemId, candidatePlaceId, decision: "MERGE", reason: "이전 목록에서 선택한 후보는 현재 대조 결과와 다릅니다." }], actorUserId, now,
    })).toEqual({ accepted: [], skipped: [{ candidatePlaceId, code: "DUPLICATE_CANDIDATE_STALE" }] });
    expect(await db.select().from(placeReviewDuplicateResolutions).where(eq(placeReviewDuplicateResolutions.workItemId, workItemId))).toEqual([]);
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, workItemId))).toEqual([]);
    expect(await db.select().from(places)).toEqual(beforePlaces);
  });
});

async function seedDecisionPair(db: ReturnType<typeof createDb>, label: string) {
  const prefix = `review-duplicate-${label}-${crypto.randomUUID()}`;
  const actorUserId = `${prefix}-admin`, candidatePlaceId = `${prefix}-candidate`, subjectId = `${prefix}-subject`, workItemId = `${prefix}-review`;
  await db.insert(users).values({ id: actorUserId, email: `${prefix}@example.test`, displayName: "합성 검수자", role: "ADMIN", createdAt: now, updatedAt: now });
  await db.insert(places).values([candidatePlaceId, subjectId].map(id => ({ id, slug: id, name: `합성 ${label} 식당`, status: "HIDDEN" as const, address: "광주광역시 동구 합성로 1", neighborhood: "합성동", latitude: 35.15, longitude: 126.92, searchText: prefix, createdAt: now, updatedAt: now })));
  await db.insert(placeReviewWorkItems).values({ id: workItemId, placeId: subjectId, sourceKind: "PLACE_SUGGESTION", stage: "DUPLICATE_REVIEW", status: "ACTIVE", createdAt: now, updatedAt: now });
  return { workItemId, candidatePlaceId, actorUserId };
}
