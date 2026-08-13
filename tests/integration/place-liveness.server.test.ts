import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { AppDb } from "../../app/db/client.server";
import { createDb } from "../../app/db/client.server";
import {
  adminAuditLogs,
  businessLicenses,
  categories,
  currentVotes,
  placeLivenessStates,
  placeRevalidationCases,
  placeRevisions,
  places,
  placeSourceLinks,
  reviewerVisitReviews,
  savedPlaces,
  users,
  voteEvents,
} from "../../app/db/schema";
import {
  applyPlaceLivenessDecision,
  claimDuePlaceLivenessTargets,
  loadPlaceLivenessEvidence,
  type LivenessTarget,
} from "../../app/features/places/place-liveness.server";
import type { LivenessDecision } from "../../app/features/places/place-liveness";

const NOW = "2026-08-13T12:00:00.000Z";
const OLD = "2026-07-01T12:00:00.000Z";

function decision(overrides: Partial<LivenessDecision> = {}): LivenessDecision {
  return {
    status: "MONITORING",
    kakaoStatus: "NOT_FOUND",
    matchedKakaoPlaceId: null,
    consecutiveNotFound: 1,
    recommendationExcluded: false,
    shouldHide: false,
    shouldOpenCase: false,
    nextCheckAt: "2026-08-20T12:00:00.000Z",
    evidence: {
      score: { name: 0, address: 0, distance: 0, phone: 0, total: 0 },
      recentReviewerActivity: { active: false, at: null },
      recentMemberActivity: { active: false, at: null },
      recentOpenSource: { active: false, at: null },
    },
    ...overrides,
  };
}

async function seedPlace(db: AppDb, prefix: string, options: { kakaoPlaceId?: string | null; lastVerifiedAt?: string | null } = {}) {
  const placeId = `${prefix}-place`;
  await db.insert(places).values({
    id: placeId,
    slug: placeId,
    name: "영업 검증 식당",
    status: "PUBLISHED",
    address: "광주광역시 동구 동명로 1",
    neighborhood: "동명동",
    latitude: 35.15,
    longitude: 126.92,
    phone: "062-123-4567",
    kakaoPlaceId: options.kakaoPlaceId === undefined ? "kakao-place" : options.kakaoPlaceId,
    searchText: "영업 검증 식당",
    lastVerifiedAt: options.lastVerifiedAt ?? OLD,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return placeId;
}

async function claimOne(db: AppDb, placeId: string, leaseToken = "lease-a", now = NOW): Promise<LivenessTarget> {
  const targets = await claimDuePlaceLivenessTargets(db, { now, limit: 10, leaseToken });
  const target = targets.find((item) => item.placeId === placeId);
  if (!target) throw new Error("LIVENESS_TARGET_NOT_CLAIMED");
  return target;
}

describe("place liveness server", () => {
  it("claims an old published place with no state only once and keeps duplicate concurrent claims disjoint", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-claim-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);

    const [first, second] = await Promise.all([
      claimDuePlaceLivenessTargets(db, { now: NOW, limit: 10, leaseToken: `${prefix}-one` }),
      claimDuePlaceLivenessTargets(db, { now: NOW, limit: 10, leaseToken: `${prefix}-two` }),
    ]);

    expect([...first, ...second].filter((target) => target.placeId === placeId)).toHaveLength(1);
    expect((await claimDuePlaceLivenessTargets(db, { now: NOW, limit: 10, leaseToken: `${prefix}-three` }))
      .some((target) => target.placeId === placeId)).toBe(false);
  });

  it("does not claim a no-state place until its seven-day normal verification boundary", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-seven-day-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix, { lastVerifiedAt: "2026-08-06T12:00:00.001Z" });

    await expect(claimDuePlaceLivenessTargets(db, { now: NOW, limit: 10, leaseToken: `${prefix}-early` }))
      .resolves.not.toContainEqual(expect.objectContaining({ placeId }));
    await db.update(places).set({ lastVerifiedAt: "2026-08-06T12:00:00.000Z", updatedAt: "2026-08-06T12:00:00.000Z" })
      .where(eq(places.id, placeId));
    await expect(claimDuePlaceLivenessTargets(db, { now: NOW, limit: 10, leaseToken: `${prefix}-due` }))
      .resolves.toContainEqual(expect.objectContaining({ placeId, leaseToken: `${prefix}-due` }));
  });

  it("blocks an unexpired lease and allows the same due target after lease expiry", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-lease-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    await db.insert(placeLivenessStates).values({
      placeId,
      nextCheckAt: OLD,
      leaseToken: `${prefix}-active`,
      leaseExpiresAt: "2026-08-13T12:04:59.999Z",
      updatedAt: NOW,
    });

    await expect(claimDuePlaceLivenessTargets(db, { now: NOW, limit: 10, leaseToken: `${prefix}-blocked` }))
      .resolves.toEqual([]);
    const reclaimed = (await claimDuePlaceLivenessTargets(db, {
      now: "2026-08-13T12:05:00.000Z",
      limit: 10,
      leaseToken: `${prefix}-reclaimed`,
    })).find((target) => target.placeId === placeId);
    expect(reclaimed).toMatchObject({ placeId, leaseToken: `${prefix}-reclaimed` });
  });

  it("does not claim an overdue state during a manual protection period", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-protection-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    const protectedUntil = "2026-11-11T12:00:00.000Z";
    await db.insert(placeLivenessStates).values({
      placeId,
      status: "VERIFIED",
      nextCheckAt: OLD,
      protectedUntil,
      updatedAt: NOW,
    });

    await expect(claimDuePlaceLivenessTargets(db, { now: NOW, limit: 10, leaseToken: `${prefix}-protected` }))
      .resolves.not.toContainEqual(expect.objectContaining({ placeId }));
    await expect(claimDuePlaceLivenessTargets(db, { now: protectedUntil, limit: 10, leaseToken: `${prefix}-due` }))
      .resolves.toContainEqual(expect.objectContaining({ placeId, leaseToken: `${prefix}-due` }));
  });

  it("claims official status conflicts before open cases and oldest normal checks under a small limit", async () => {
    const db = createDb(env.DB);
    const prefix = `0000-liveness-priority-${crypto.randomUUID()}`;
    const conflictPlaceId = await seedPlace(db, `${prefix}-01-conflict`, { lastVerifiedAt: null });
    const casePlaceId = await seedPlace(db, `${prefix}-02-case`, { lastVerifiedAt: null });
    const neverCheckedPlaceId = await seedPlace(db, `${prefix}-03-never`, { lastVerifiedAt: null });
    await seedPlace(db, `${prefix}-04-newer`, { lastVerifiedAt: OLD });
    const licenseId = `${prefix}-closed-license`;
    await db.insert(businessLicenses).values({
      id: licenseId,
      sourceType: "GENERAL_RESTAURANT",
      sourceManagementNo: licenseId,
      businessName: "폐업 출처 장소",
      normalizedStatus: "CLOSED",
      regionCode: "GWANGJU",
      rawPayload: "{}",
      reviewStatus: "APPROVED",
      firstSeenAt: OLD,
      lastSeenAt: OLD,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(placeSourceLinks).values({ id: `${prefix}-source-link`, placeId: conflictPlaceId, businessLicenseId: licenseId, createdAt: NOW });
    await db.insert(placeRevalidationCases).values({
      id: `${prefix}-case`,
      placeId: casePlaceId,
      reasonType: "UNKNOWN",
      status: "REVIEWING",
      evidenceJson: "{}",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const targets = await claimDuePlaceLivenessTargets(db, { now: NOW, limit: 3, leaseToken: `${prefix}-lease` });

    expect(targets.map((target) => target.placeId)).toEqual([conflictPlaceId, casePlaceId, neverCheckedPlaceId]);
  });

  it("reuses a previously matched Kakao id when the place row has no Kakao id", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-reuse-match-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix, { kakaoPlaceId: null });
    await db.insert(placeLivenessStates).values({
      placeId,
      matchedKakaoPlaceId: `${prefix}-kakao`,
      nextCheckAt: OLD,
      updatedAt: NOW,
    });

    await expect(claimDuePlaceLivenessTargets(db, { now: NOW, limit: 10, leaseToken: `${prefix}-lease` }))
      .resolves.toContainEqual(expect.objectContaining({
        placeId,
        place: expect.objectContaining({ kakaoPlaceId: `${prefix}-kakao` }),
      }));
  });

  it("aggregates only recent non-identifying reviewer, member, and open-source evidence", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-evidence-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    const categoryId = `${prefix}-category`;
    const reviewerId = `${prefix}-reviewer`;
    const memberId = `${prefix}-member`;
    await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "한식", emoji: "K", createdAt: NOW, updatedAt: NOW });
    await db.insert(users).values([
      { id: reviewerId, email: `${reviewerId}@example.com`, displayName: "리뷰어", role: "REVIEWER", createdAt: NOW, updatedAt: NOW },
      { id: memberId, email: `${memberId}@example.com`, displayName: "회원", role: "USER", createdAt: NOW, updatedAt: NOW },
    ]);
    await db.insert(reviewerVisitReviews).values([
      { id: `${prefix}-review-recent-photo`, placeId, reviewerUserId: reviewerId, categoryId, evaluation: "RECOMMEND", badgesJson: "[]", photoCount: 2, publishedAt: "2026-08-12T12:00:00.000Z", createdAt: NOW, updatedAt: NOW },
      { id: `${prefix}-review-recent-no-photo`, placeId, reviewerUserId: reviewerId, categoryId, evaluation: "RECOMMEND", badgesJson: "[]", photoCount: 0, publishedAt: "2026-08-13T11:00:00.000Z", createdAt: NOW, updatedAt: NOW },
      { id: `${prefix}-review-old-photo`, placeId, reviewerUserId: reviewerId, categoryId, evaluation: "RECOMMEND", badgesJson: "[]", photoCount: 1, publishedAt: "2026-05-01T12:00:00.000Z", createdAt: NOW, updatedAt: NOW },
    ]);
    await db.insert(voteEvents).values({ id: `${prefix}-vote-event`, placeId, userId: memberId, value: 1, eventType: "CREATE", createdAt: NOW });
    await db.insert(currentVotes).values({ placeId, userId: memberId, eventId: `${prefix}-vote-event`, value: 1, updatedAt: "2026-08-11T12:00:00.000Z" });
    await db.insert(savedPlaces).values({ placeId, userId: memberId, createdAt: "2026-08-10T12:00:00.000Z" });
    const licenseId = `${prefix}-license`;
    await db.insert(businessLicenses).values({
      id: licenseId,
      sourceType: "GENERAL_RESTAURANT",
      sourceManagementNo: licenseId,
      businessName: "영업 검증 식당",
      normalizedStatus: "OPEN",
      regionCode: "GWANGJU",
      rawPayload: "{}",
      reviewStatus: "APPROVED",
      firstSeenAt: OLD,
      lastSeenAt: "2026-08-09T12:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(placeSourceLinks).values({ id: `${prefix}-link`, placeId, businessLicenseId: licenseId, createdAt: NOW });

    const evidence = await loadPlaceLivenessEvidence(db, { placeId, now: NOW });

    expect(evidence).toEqual({
      reviewerVisitReviewCount: 1,
      reviewerPhotoCount: 2,
      recentReviewerActivityAt: "2026-08-12T12:00:00.000Z",
      currentVoteCount: 1,
      savedPlaceCount: 1,
      recentMemberActivityAt: "2026-08-11T12:00:00.000Z",
      openBusinessLicenseCount: 1,
      recentOpenSourceAt: "2026-08-09T12:00:00.000Z",
    });
    expect(JSON.stringify(evidence)).not.toContain(memberId);
    expect(JSON.stringify(evidence)).not.toContain(reviewerId);
  });

  it("applies only its current lease, reuses the open not-found case, and makes one batch", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-apply-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    const first = await claimOne(db, placeId, `${prefix}-first`);
    let batchCalls = 0;
    const observedDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "batch") return async (...input: Parameters<AppDb["batch"]>) => {
          batchCalls += 1;
          return target.batch(...input);
        };
        return Reflect.get(target, property, receiver);
      },
    }) as AppDb;

    await expect(applyPlaceLivenessDecision(observedDb, {
      target: first,
      decision: decision({ consecutiveNotFound: 2, status: "SUSPECTED", recommendationExcluded: true, shouldOpenCase: true }),
      leaseToken: `${prefix}-first`,
      now: NOW,
    })).resolves.toBe("APPLIED");
    expect(batchCalls).toBe(1);
    expect((await db.select().from(placeRevalidationCases).where(eq(placeRevalidationCases.placeId, placeId))).filter((item) => item.status === "OPEN")).toHaveLength(1);

    await db.update(placeLivenessStates).set({ nextCheckAt: NOW, updatedAt: NOW }).where(eq(placeLivenessStates.placeId, placeId));
    const second = await claimOne(db, placeId, `${prefix}-second`, "2026-08-20T12:00:00.000Z");
    await expect(applyPlaceLivenessDecision(db, {
      target: second,
      decision: decision({ consecutiveNotFound: 3, status: "SUSPECTED", recommendationExcluded: true, shouldOpenCase: true }),
      leaseToken: `${prefix}-second`,
      now: "2026-08-20T12:00:00.000Z",
    })).resolves.toBe("APPLIED");
    const openCases = await db.select().from(placeRevalidationCases)
      .where(and(eq(placeRevalidationCases.placeId, placeId), eq(placeRevalidationCases.status, "OPEN")));
    expect(openCases).toHaveLength(1);
  });

  it("stores a matched Kakao id on MATCHED and preserves it on later provider errors", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-store-match-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix, { kakaoPlaceId: null });
    const target = await claimOne(db, placeId, `${prefix}-matched`);

    await expect(applyPlaceLivenessDecision(db, {
      target,
      decision: decision({
        status: "VERIFIED",
        kakaoStatus: "MATCHED",
        matchedKakaoPlaceId: `${prefix}-kakao`,
        consecutiveNotFound: 0,
      }),
      leaseToken: `${prefix}-matched`,
      now: NOW,
    })).resolves.toBe("APPLIED");
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) }))
      .toMatchObject({ matchedKakaoPlaceId: `${prefix}-kakao`, kakaoStatus: "MATCHED" });

    await db.update(placeLivenessStates).set({ nextCheckAt: NOW, updatedAt: NOW }).where(eq(placeLivenessStates.placeId, placeId));
    const errorTarget = await claimOne(db, placeId, `${prefix}-error`, "2026-08-20T12:00:00.000Z");
    await expect(applyPlaceLivenessDecision(db, {
      target: errorTarget,
      decision: decision({
        status: "VERIFIED",
        kakaoStatus: "ERROR",
        matchedKakaoPlaceId: null,
        consecutiveNotFound: 0,
      }),
      leaseToken: `${prefix}-error`,
      now: "2026-08-20T12:00:00.000Z",
    })).resolves.toBe("APPLIED");
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) }))
      .toMatchObject({ matchedKakaoPlaceId: `${prefix}-kakao`, kakaoStatus: "ERROR" });
  });

  it("records an automatic hide with its state, case, revision, and audit log in one batch", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-hide-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    const target = await claimOne(db, placeId, `${prefix}-lease`);
    let batchCalls = 0;
    const observedDb = new Proxy(db, {
      get(targetDb, property, receiver) {
        if (property === "batch") return async (...input: Parameters<AppDb["batch"]>) => {
          batchCalls += 1;
          return targetDb.batch(...input);
        };
        return Reflect.get(targetDb, property, receiver);
      },
    }) as AppDb;

    await expect(applyPlaceLivenessDecision(observedDb, {
      target,
      decision: decision({ status: "HIDDEN", consecutiveNotFound: 3, recommendationExcluded: true, shouldHide: true, shouldOpenCase: true }),
      leaseToken: `${prefix}-lease`,
      now: NOW,
    })).resolves.toBe("APPLIED");

    expect(batchCalls).toBe(1);
    expect(await db.query.places.findFirst({ where: eq(places.id, placeId) })).toMatchObject({ status: "HIDDEN", closedAt: NOW });
    expect((await db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId))).find((item) => item.action === "STATUS_CHANGE"))
      .toMatchObject({ actorUserId: null, reason: "AUTOMATED_PLACE_LIVENESS_HIDE", sourceType: "PLACE_LIVENESS_VERIFICATION" });
    expect((await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, placeId))).find((item) => item.action === "HIDE_PLACE_FOR_LIVENESS"))
      .toMatchObject({ actorUserId: null });
    expect((await db.select().from(placeRevalidationCases).where(eq(placeRevalidationCases.placeId, placeId))).find((item) => item.status === "OPEN"))
      .toMatchObject({ reasonType: "UNKNOWN" });

    const revision = (await db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId)))
      .find((item) => item.action === "STATUS_CHANGE");
    const audit = (await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, placeId)))
      .find((item) => item.action === "HIDE_PLACE_FOR_LIVENESS");
    expect(revision?.beforeJson).not.toContain("영업 검증 식당");
    expect(revision?.beforeJson).not.toContain("062-123-4567");
    expect(audit?.afterState).not.toContain("광주광역시 동구 동명로 1");
  });

  it("recovers a liveness-hidden place and resolves its unknown case in one batch", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-recovery-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    const hideTarget = await claimOne(db, placeId, `${prefix}-hide`);
    await expect(applyPlaceLivenessDecision(db, {
      target: hideTarget,
      decision: decision({ status: "HIDDEN", consecutiveNotFound: 3, recommendationExcluded: true, shouldHide: true, shouldOpenCase: true }),
      leaseToken: `${prefix}-hide`,
      now: NOW,
    })).resolves.toBe("APPLIED");

    await db.update(placeLivenessStates).set({ nextCheckAt: NOW, updatedAt: NOW }).where(eq(placeLivenessStates.placeId, placeId));
    const recoveryTarget = await claimOne(db, placeId, `${prefix}-recovery`);
    let batchCalls = 0;
    const observedDb = new Proxy(db, {
      get(targetDb, property, receiver) {
        if (property === "batch") return async (...input: Parameters<AppDb["batch"]>) => {
          batchCalls += 1;
          return targetDb.batch(...input);
        };
        return Reflect.get(targetDb, property, receiver);
      },
    }) as AppDb;

    await expect(applyPlaceLivenessDecision(observedDb, {
      target: recoveryTarget,
      decision: decision({ status: "VERIFIED", kakaoStatus: "MATCHED", consecutiveNotFound: 0, nextCheckAt: "2026-08-27T12:00:00.000Z" }),
      leaseToken: `${prefix}-recovery`,
      now: "2026-08-20T12:00:00.000Z",
    })).resolves.toBe("APPLIED");

    expect(batchCalls).toBe(1);
    expect(await db.query.places.findFirst({ where: eq(places.id, placeId) }))
      .toMatchObject({ status: "PUBLISHED", closedAt: null, lastVerifiedAt: "2026-08-20T12:00:00.000Z" });
    expect(await db.select().from(placeRevalidationCases).where(eq(placeRevalidationCases.placeId, placeId)))
      .toContainEqual(expect.objectContaining({ status: "RESOLVED", resolution: "AUTOMATED_PLACE_LIVENESS_MATCHED", reviewedBy: null }));
    expect(await db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId)))
      .toContainEqual(expect.objectContaining({ reason: "AUTOMATED_PLACE_LIVENESS_RECOVERY", actorUserId: null, sourceType: "PLACE_LIVENESS_VERIFICATION" }));
    expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, placeId)))
      .toContainEqual(expect.objectContaining({ action: "RESTORE_PLACE_FOR_LIVENESS", actorUserId: null }));
  });

  it("does not claim or recover a manually hidden liveness place automatically", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-manual-recovery-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    await db.update(places).set({ status: "HIDDEN", closedAt: NOW, updatedAt: NOW }).where(eq(places.id, placeId));
    await db.insert(placeLivenessStates).values({
      placeId,
      status: "HIDDEN",
      kakaoStatus: "NOT_FOUND",
      recommendationExcluded: true,
      nextCheckAt: OLD,
      updatedAt: NOW,
    });
    await db.insert(placeRevisions).values({
      id: `${prefix}-manual-revision`,
      placeId,
      actorUserId: null,
      action: "STATUS_CHANGE",
      reason: "수동 폐업 확인",
      beforeJson: "{}",
      afterJson: "{}",
      sourceType: "PLACE_LIVENESS_MANUAL",
      sourceId: `${prefix}-case`,
      createdAt: OLD,
    });

    await expect(claimDuePlaceLivenessTargets(db, { now: NOW, limit: 10, leaseToken: `${prefix}-claim` }))
      .resolves.not.toContainEqual(expect.objectContaining({ placeId }));

    await db.update(placeLivenessStates).set({ leaseToken: `${prefix}-forced`, leaseExpiresAt: null, updatedAt: NOW })
      .where(eq(placeLivenessStates.placeId, placeId));
    const forcedTarget: LivenessTarget = {
      placeId,
      place: {
        name: "영업 검증 식당",
        address: "광주광역시 동구 동명로 1",
        latitude: 35.15,
        longitude: 126.92,
        phone: "062-123-4567",
        kakaoPlaceId: "kakao-place",
      },
      status: "HIDDEN",
      recommendationExcluded: true,
      consecutiveNotFound: 3,
      firstNotFoundAt: OLD,
      lastCheckedAt: OLD,
      protectedUntil: null,
      placeUpdatedAt: NOW,
      leaseToken: `${prefix}-forced`,
    };
    await expect(applyPlaceLivenessDecision(db, {
      target: forcedTarget,
      decision: decision({
        status: "VERIFIED",
        kakaoStatus: "MATCHED",
        matchedKakaoPlaceId: `${prefix}-kakao`,
        consecutiveNotFound: 0,
      }),
      leaseToken: `${prefix}-forced`,
      now: "2026-08-20T12:00:00.000Z",
    })).resolves.toBe("STALE_LEASE");

    expect(await db.query.places.findFirst({ where: eq(places.id, placeId) }))
      .toMatchObject({ status: "HIDDEN", closedAt: NOW });
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) }))
      .toMatchObject({
        status: "HIDDEN",
        kakaoStatus: "NOT_FOUND",
        matchedKakaoPlaceId: null,
        recommendationExcluded: true,
      });
    expect(await db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId)))
      .not.toContainEqual(expect.objectContaining({ reason: "AUTOMATED_PLACE_LIVENESS_RECOVERY" }));
  });

  it("does not resolve unknown cases for a matched place without liveness recovery", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-non-recovery-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    const target = await claimOne(db, placeId, `${prefix}-lease`);
    await db.insert(placeRevalidationCases).values([
      {
        id: `${prefix}-open`,
        placeId,
        reasonType: "UNKNOWN",
        status: "OPEN",
        evidenceJson: "{}",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: `${prefix}-reviewing`,
        placeId,
        reasonType: "UNKNOWN",
        status: "REVIEWING",
        evidenceJson: "{}",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    await expect(applyPlaceLivenessDecision(db, {
      target,
      decision: decision({ status: "VERIFIED", kakaoStatus: "MATCHED", consecutiveNotFound: 0 }),
      leaseToken: `${prefix}-lease`,
      now: NOW,
    })).resolves.toBe("APPLIED");

    expect(await db.select().from(placeRevalidationCases).where(eq(placeRevalidationCases.placeId, placeId)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: `${prefix}-open`, status: "OPEN", resolution: null }),
        expect.objectContaining({ id: `${prefix}-reviewing`, status: "REVIEWING", resolution: null }),
      ]));
    await expect(db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId))).resolves.toEqual([]);
    await expect(db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, placeId))).resolves.toEqual([]);
  });

  it("rolls back every write when an automatic-hide batch statement fails", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-rollback-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    const target = await claimOne(db, placeId, `${prefix}-lease`);
    const triggerName = `liveness_rollback_${crypto.randomUUID().replaceAll("-", "")}`;
    await env.DB.prepare(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON place_revisions
      WHEN NEW.reason = 'AUTOMATED_PLACE_LIVENESS_HIDE'
      BEGIN
        SELECT RAISE(ABORT, 'liveness revision rejected');
      END;
    `).run();

    try {
      await expect(applyPlaceLivenessDecision(db, {
        target,
        decision: decision({ status: "HIDDEN", consecutiveNotFound: 3, recommendationExcluded: true, shouldHide: true, shouldOpenCase: true }),
        leaseToken: `${prefix}-lease`,
        now: NOW,
      })).rejects.toThrow("liveness revision rejected");
    } finally {
      await env.DB.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }

    expect(await db.query.places.findFirst({ where: eq(places.id, placeId) })).toMatchObject({ status: "PUBLISHED", closedAt: null });
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) }))
      .toMatchObject({ leaseToken: `${prefix}-lease` });
    await expect(db.select().from(placeRevalidationCases).where(eq(placeRevalidationCases.placeId, placeId))).resolves.toEqual([]);
    await expect(db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId))).resolves.toEqual([]);
    await expect(db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, placeId))).resolves.toEqual([]);
  });

  it("returns STALE_LEASE without side effects when another claimant wins before the batch", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-stale-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    const target = await claimOne(db, placeId, `${prefix}-current`);
    const before = await Promise.all([
      db.query.places.findFirst({ where: eq(places.id, placeId) }),
      db.select().from(placeRevalidationCases).where(eq(placeRevalidationCases.placeId, placeId)),
      db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId)),
      db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, placeId)),
    ]);
    let raced = false;
    const racedDb = new Proxy(db, {
      get(targetDb, property, receiver) {
        if (property === "batch") return async (...input: Parameters<AppDb["batch"]>) => {
          if (!raced) {
            raced = true;
            await targetDb.update(placeLivenessStates).set({ leaseToken: `${prefix}-replacement`, updatedAt: NOW })
              .where(eq(placeLivenessStates.placeId, placeId));
          }
          return targetDb.batch(...input);
        };
        return Reflect.get(targetDb, property, receiver);
      },
    }) as AppDb;

    await expect(applyPlaceLivenessDecision(racedDb, {
      target,
      decision: decision({ status: "HIDDEN", consecutiveNotFound: 3, recommendationExcluded: true, shouldHide: true, shouldOpenCase: true }),
      leaseToken: `${prefix}-current`,
      now: NOW,
    })).resolves.toBe("STALE_LEASE");
    const after = await Promise.all([
      db.query.places.findFirst({ where: eq(places.id, placeId) }),
      db.select().from(placeRevalidationCases).where(eq(placeRevalidationCases.placeId, placeId)),
      db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId)),
      db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, placeId)),
    ]);
    expect(after).toEqual(before);
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) }))
      .toMatchObject({ leaseToken: `${prefix}-replacement` });
  });

  it("fails closed when the claimed place changes before the liveness batch", async () => {
    const db = createDb(env.DB);
    const prefix = `liveness-place-version-${crypto.randomUUID()}`;
    const placeId = await seedPlace(db, prefix);
    const target = await claimOne(db, placeId, `${prefix}-lease`);
    const changedAt = "2026-08-13T12:00:01.000Z";
    let raced = false;
    const racedDb = new Proxy(db, {
      get(targetDb, property, receiver) {
        if (property === "batch") return async (...input: Parameters<AppDb["batch"]>) => {
          if (!raced) {
            raced = true;
            await targetDb.update(places).set({ closedAt: changedAt, updatedAt: changedAt }).where(eq(places.id, placeId));
          }
          return targetDb.batch(...input);
        };
        return Reflect.get(targetDb, property, receiver);
      },
    }) as AppDb;

    await expect(applyPlaceLivenessDecision(racedDb, {
      target,
      decision: decision({ status: "HIDDEN", consecutiveNotFound: 3, recommendationExcluded: true, shouldHide: true, shouldOpenCase: true }),
      leaseToken: `${prefix}-lease`,
      now: NOW,
    })).resolves.toBe("STALE_LEASE");

    expect(await db.query.places.findFirst({ where: eq(places.id, placeId) }))
      .toMatchObject({ status: "PUBLISHED", closedAt: changedAt, updatedAt: changedAt });
    expect(await db.query.placeLivenessStates.findFirst({ where: eq(placeLivenessStates.placeId, placeId) }))
      .toMatchObject({ leaseToken: `${prefix}-lease` });
    await expect(db.select().from(placeRevalidationCases).where(eq(placeRevalidationCases.placeId, placeId))).resolves.toEqual([]);
    await expect(db.select().from(placeRevisions).where(eq(placeRevisions.placeId, placeId))).resolves.toEqual([]);
    await expect(db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, placeId))).resolves.toEqual([]);
  });
});
