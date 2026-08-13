import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, placeLivenessStates, placeRevalidationCases, placeRevisions, places, users } from "../../app/db/schema";
import { clearRecommendationExclusions, enqueueStalePlaceRevalidations, resolvePlaceLivenessCase, resolvePlaceRevalidation } from "../../app/features/places/place-revalidation.server";

describe("place revalidation", () => {
  it("queues places not verified for 90 days and restores only by admin resolution", async () => {
    const db = createDb(env.DB); const prefix = `revalidate-${crypto.randomUUID()}`; const now = "2026-08-06T12:00:00.000Z";
    await db.insert(users).values({ id: `${prefix}-admin`, email: `${prefix}@example.com`, displayName: "관리자", role: "ADMIN", createdAt: now, updatedAt: now });
    await db.insert(places).values({ id: `${prefix}-place`, slug: `${prefix}-place`, name: "오래된 장소", status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "오래된 장소", lastVerifiedAt: "2026-01-01T00:00:00.000Z", createdAt: now, updatedAt: now });
    expect((await enqueueStalePlaceRevalidations(db, { now })).created).toBeGreaterThanOrEqual(1);
    const item = (await db.select().from(placeRevalidationCases)).find((row) => row.placeId === `${prefix}-place` && row.reasonType === "STALE_90D"); if (!item) throw new Error("case missing");
    await resolvePlaceRevalidation(db, { caseId: item.id, actorUserId: `${prefix}-admin`, resolution: "KEEP_PUBLISHED", reason: "영업 확인", now });
    expect((await db.select().from(places)).find((row) => row.id === `${prefix}-place`)).toMatchObject({ status: "PUBLISHED", lastVerifiedAt: now });
  });

  it("protects a manually confirmed open place for 90 days and records the manual decision", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-open-${crypto.randomUUID()}`;
    const now = "2026-08-13T12:00:00.000Z";
    const { adminId, caseId, placeId } = await seedLivenessCase(db, prefix, now);
    await db.insert(placeLivenessStates).values({
      placeId,
      status: "SUSPECTED",
      kakaoStatus: "NOT_FOUND",
      consecutiveNotFound: 3,
      recommendationExcluded: true,
      evidenceJson: JSON.stringify({ score: { name: 40, address: 30, distance: 20, phone: 0, total: 90 } }),
      updatedAt: now,
    });

    await resolvePlaceLivenessCase(db, { caseId, actorUserId: adminId, resolution: "OPEN", reason: "현장 확인", now });

    expect(await db.query.places.findFirst({ where: eq(places.id, placeId) })).toMatchObject({ status: "PUBLISHED", closedAt: null, lastVerifiedAt: now });
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) })).toMatchObject({
      status: "VERIFIED",
      recommendationExcluded: false,
      consecutiveNotFound: 0,
      protectedUntil: "2026-11-11T12:00:00.000Z",
      nextCheckAt: "2026-11-11T12:00:00.000Z",
    });
    expect(await db.query.placeRevalidationCases.findFirst({ where: eq(placeRevalidationCases.id, caseId) })).toMatchObject({ status: "RESOLVED", resolution: "OPEN", reviewedBy: adminId });
    expect(await db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId))).toContainEqual(expect.objectContaining({
      actorUserId: adminId,
      action: "STATUS_CHANGE",
      sourceType: "PLACE_LIVENESS_MANUAL",
      sourceId: caseId,
    }));
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, placeId))).toContainEqual(expect.objectContaining({
      actorUserId: adminId,
      action: "RESOLVE_PLACE_LIVENESS_CASE",
    }));
  });

  it.each(["TEMPORARILY_CLOSED", "CLOSED", "MOVED"] as const)("requires a reason for %s", async (resolution) => {
    const db = createDb(env.DB);
    const prefix = `liveness-reason-${resolution}-${crypto.randomUUID()}`;
    const now = "2026-08-13T12:00:00.000Z";
    const { adminId, caseId } = await seedLivenessCase(db, prefix, now);

    await expect(resolvePlaceLivenessCase(db, { caseId, actorUserId: adminId, resolution, reason: "  ", now }))
      .rejects.toThrow("REVIEW_REASON_REQUIRED");
  });

  it("hides manually closed places and records revisions and audits for each decision", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-closed-${crypto.randomUUID()}`;
    const now = "2026-08-13T12:00:00.000Z";
    const { adminId, caseId, placeId } = await seedLivenessCase(db, prefix, now);

    await resolvePlaceLivenessCase(db, { caseId, actorUserId: adminId, resolution: "CLOSED", reason: "폐업 현장 확인", now });

    expect(await db.query.places.findFirst({ where: eq(places.id, placeId) })).toMatchObject({ status: "HIDDEN", closedAt: now });
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) })).toMatchObject({ status: "HIDDEN", recommendationExcluded: true, protectedUntil: null });
    expect(await db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId))).toContainEqual(expect.objectContaining({ reason: "폐업 현장 확인" }));
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, placeId))).toContainEqual(expect.objectContaining({ action: "RESOLVE_PLACE_LIVENESS_CASE" }));
  });

  it("clears only derived recommendation exclusions without deleting place data", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-clear-${crypto.randomUUID()}`;
    const now = "2026-08-13T12:00:00.000Z";
    const { adminId, placeId } = await seedLivenessCase(db, prefix, now);
    await db.insert(placeLivenessStates).values({
      placeId,
      status: "SUSPECTED",
      kakaoStatus: "NOT_FOUND",
      consecutiveNotFound: 2,
      recommendationExcluded: true,
      protectedUntil: "2026-09-01T00:00:00.000Z",
      evidenceJson: "{}",
      updatedAt: now,
    });

    const result = await clearRecommendationExclusions(db, { actorUserId: adminId, reason: "재검토 후 복구", now });
    expect(result.updated).toBeGreaterThan(0);

    expect(await db.query.places.findFirst({ where: eq(places.id, placeId) })).toMatchObject({ id: placeId, status: "PUBLISHED" });
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) })).toMatchObject({
      status: "SUSPECTED",
      recommendationExcluded: false,
      consecutiveNotFound: 2,
      protectedUntil: "2026-09-01T00:00:00.000Z",
    });
    expect(await db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId))).toEqual([]);
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.action, "CLEAR_PLACE_RECOMMENDATION_EXCLUSIONS"))).toContainEqual(expect.objectContaining({ actorUserId: adminId }));
  });

  it("does not clear a manual hidden liveness outcome", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-manual-hidden-${crypto.randomUUID()}`;
    const now = "2026-08-13T12:00:00.000Z";
    const { adminId, placeId } = await seedLivenessCase(db, prefix, now);
    const { placeId: automaticPlaceId } = await seedLivenessCase(db, `${prefix}-automatic`, now);
    const { placeId: historicalManualPlaceId } = await seedLivenessCase(db, `${prefix}-historical-manual`, now);
    await db.insert(placeLivenessStates).values({
      placeId,
      status: "HIDDEN",
      kakaoStatus: "NOT_FOUND",
      recommendationExcluded: true,
      evidenceJson: "{}",
      updatedAt: now,
    });
    await db.insert(placeRevisions).values({
      id: `${prefix}-manual-revision`,
      placeId,
      actorUserId: adminId,
      action: "STATUS_CHANGE",
      reason: "수동 폐업 확인",
      beforeJson: "{}",
      afterJson: "{}",
      sourceType: "PLACE_LIVENESS_MANUAL",
      createdAt: now,
    });
    await db.insert(placeLivenessStates).values({
      placeId: automaticPlaceId,
      status: "SUSPECTED",
      kakaoStatus: "NOT_FOUND",
      recommendationExcluded: true,
      evidenceJson: "{}",
      updatedAt: now,
    });
    await db.insert(placeRevisions).values({
      id: `${prefix}-historical-manual-revision`,
      placeId: historicalManualPlaceId,
      actorUserId: adminId,
      action: "STATUS_CHANGE",
      reason: "이전 수동 검수",
      beforeJson: "{}",
      afterJson: "{}",
      sourceType: "REVALIDATION_CASE",
      createdAt: "2026-08-01T12:00:00.000Z",
    });
    await db.insert(placeLivenessStates).values({
      placeId: historicalManualPlaceId,
      status: "SUSPECTED",
      kakaoStatus: "NOT_FOUND",
      recommendationExcluded: true,
      evidenceJson: "{}",
      updatedAt: now,
    });

    const result = await clearRecommendationExclusions(db, { actorUserId: adminId, reason: "자동 제외만 해제", now });
    expect(result.updated).toBeGreaterThan(0);
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) }))
      .toMatchObject({ status: "HIDDEN", recommendationExcluded: true });
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, automaticPlaceId) }))
      .toMatchObject({ status: "SUSPECTED", recommendationExcluded: false });
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, historicalManualPlaceId) }))
      .toMatchObject({ status: "SUSPECTED", recommendationExcluded: false });
  });
});

async function seedLivenessCase(db: ReturnType<typeof createDb>, prefix: string, now: string) {
  const adminId = `${prefix}-admin`;
  const placeId = `${prefix}-place`;
  const caseId = `${prefix}-case`;
  await db.insert(users).values({ id: adminId, email: `${prefix}@example.com`, displayName: "관리자", role: "ADMIN", createdAt: now, updatedAt: now });
  await db.insert(places).values({ id: placeId, slug: placeId, name: "영업 검증 장소", status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "영업 검증 장소", createdAt: now, updatedAt: now });
  await db.insert(placeRevalidationCases).values({ id: caseId, placeId, reasonType: "UNKNOWN", status: "OPEN", evidenceJson: "{}", createdAt: now, updatedAt: now });
  return { adminId, caseId, placeId };
}
