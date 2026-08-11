import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { goldenPickEvents, places, reviewerProfiles, users } from "../../app/db/schema";
import {
  expireGoldenPicks,
  grantGoldenPick,
  listActiveGoldenPicks,
  listGoldenPickHistoryForPlaces,
  withdrawGoldenPick,
} from "../../app/features/ratings/golden-pick.server";

const now = "2026-08-06T00:00:00.000Z";

async function seedReviewerAndPlaces(prefix: string, count = 4) {
  const db = createDb(env.DB);
  const reviewerId = `${prefix}-reviewer`;
  await db.insert(users).values({ id: reviewerId, email: `${reviewerId}@example.com`, displayName: reviewerId, role: "REVIEWER", createdAt: now, updatedAt: now });
  await db.insert(reviewerProfiles).values({ userId: reviewerId, slug: reviewerId, status: "ACTIVE", occupation: "테스터", tasteDirection: "균형", regionCode: "GWANGJU", specialtySlugs: "[]", lastActivityAt: now, approvedAt: now, createdAt: now, updatedAt: now });
  const placeIds = Array.from({ length: count }, (_, index) => `${prefix}-place-${index}`);
  await db.insert(places).values(placeIds.map((id) => ({ id, slug: id, name: id, status: "PUBLISHED" as const, address: "광주 동구", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: id, createdAt: now, updatedAt: now })));
  return { db, reviewerId, placeIds };
}

describe("Golden Pick", () => {
  it("allows three grants per calendar month and rejects the fourth", async () => {
    const { db, reviewerId, placeIds } = await seedReviewerAndPlaces(`golden-limit-${crypto.randomUUID()}`);
    for (let index = 0; index < 3; index += 1) {
      await grantGoldenPick(db, { id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: placeIds[index], now });
    }
    await expect(grantGoldenPick(db, { id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: placeIds[3], now })).rejects.toThrow("GOLDEN_PICK_MONTHLY_LIMIT");
  });

  it("enforces same-place ninety days and supports withdrawal and expiration", async () => {
    const { db, reviewerId, placeIds } = await seedReviewerAndPlaces(`golden-life-${crypto.randomUUID()}`, 1);
    const grant = await grantGoldenPick(db, { id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: placeIds[0], now });
    expect(await listActiveGoldenPicks(db, "2026-08-07T00:00:00.000Z", reviewerId)).toHaveLength(1);
    await withdrawGoldenPick(db, { id: crypto.randomUUID(), grantEventId: grant.id, reviewerUserId: reviewerId, reason: "판단 변경", now: "2026-08-07T00:00:00.000Z" });
    expect(await listActiveGoldenPicks(db, "2026-08-08T00:00:00.000Z", reviewerId)).toHaveLength(0);
    await expect(grantGoldenPick(db, { id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: placeIds[0], now: "2026-09-01T00:00:00.000Z" })).rejects.toThrow("GOLDEN_PICK_PLACE_COOLDOWN");
    const later = await grantGoldenPick(db, { id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: placeIds[0], now: "2026-11-05T00:00:00.000Z" });
    expect(later.expiresAt).toBe("2027-02-03T00:00:00.000Z");
    expect(await expireGoldenPicks(db, { now: "2027-02-04T00:00:00.000Z", reviewerUserId: reviewerId })).toBe(1);
  });

  it("요청 후보 ID만 D1 바인딩 한도 안에서 청크로 Golden 이력을 조회한다", async () => {
    const { db, reviewerId, placeIds } = await seedReviewerAndPlaces(`golden-scope-${crypto.randomUUID()}`, 3);
    const [firstId, secondId, outsideId] = placeIds;
    await db.insert(goldenPickEvents).values([
      {
        id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: firstId!, eventType: "GRANT",
        previousEventId: null, reason: null, effectiveAt: "2026-07-02T00:00:00.000Z",
        expiresAt: "2026-09-30T00:00:00.000Z", createdAt: "2026-07-02T00:00:00.000Z",
      },
      {
        id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: secondId!, eventType: "GRANT",
        previousEventId: null, reason: null, effectiveAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-09-29T00:00:00.000Z", createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: outsideId!, eventType: "GRANT",
        previousEventId: null, reason: null, effectiveAt: "2026-07-03T00:00:00.000Z",
        expiresAt: "2026-10-01T00:00:00.000Z", createdAt: "2026-07-03T00:00:00.000Z",
      },
    ]);
    const requestedIds = [
      firstId!,
      secondId!,
      ...Array.from({ length: 100 }, (_, index) => `not-a-place-${index}`),
    ];

    const history = await listGoldenPickHistoryForPlaces(db, requestedIds, "2026-08-11T00:00:00.000Z");

    expect([...history.keys()]).toEqual([firstId, secondId]);
    expect(history.has(outsideId!)).toBe(false);
  });

  it("GRANT의 만료 시점과 WITHDRAW·EXPIRE 연결로 활성·과거 강도를 계산한다", async () => {
    const { db, reviewerId, placeIds } = await seedReviewerAndPlaces(`golden-history-${crypto.randomUUID()}`, 6);
    const grantIds = placeIds.map(() => crypto.randomUUID());
    await db.insert(goldenPickEvents).values([
      {
        id: grantIds[0]!, reviewerUserId: reviewerId, placeId: placeIds[0]!, eventType: "GRANT",
        previousEventId: null, reason: null, effectiveAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: grantIds[1]!, reviewerUserId: reviewerId, placeId: placeIds[1]!, eventType: "GRANT",
        previousEventId: null, reason: null, effectiveAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-08-20T00:00:00.000Z", createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: grantIds[2]!, reviewerUserId: reviewerId, placeId: placeIds[2]!, eventType: "GRANT",
        previousEventId: null, reason: null, effectiveAt: "2026-04-01T00:00:00.000Z",
        expiresAt: "2026-06-30T00:00:00.000Z", createdAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: grantIds[3]!, reviewerUserId: reviewerId, placeId: placeIds[3]!, eventType: "GRANT",
        previousEventId: null, reason: null, effectiveAt: "2026-04-02T00:00:00.000Z",
        expiresAt: "2026-07-01T00:00:00.000Z", createdAt: "2026-04-02T00:00:00.000Z",
      },
      {
        id: grantIds[4]!, reviewerUserId: reviewerId, placeId: placeIds[4]!, eventType: "GRANT",
        previousEventId: null, reason: null, effectiveAt: "2026-04-03T00:00:00.000Z",
        expiresAt: "2026-07-02T00:00:00.000Z", createdAt: "2026-04-03T00:00:00.000Z",
      },
      {
        id: grantIds[5]!, reviewerUserId: reviewerId, placeId: placeIds[5]!, eventType: "GRANT",
        previousEventId: null, reason: null, effectiveAt: "2026-07-03T00:00:00.000Z",
        expiresAt: "2026-07-03T00:00:00.000Z", createdAt: "2026-07-03T00:00:00.000Z",
      },
      {
        id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: placeIds[2]!, eventType: "EXPIRE",
        previousEventId: grantIds[2]!, reason: "90_DAY_EXPIRATION", effectiveAt: "2026-07-01T00:00:00.000Z",
        expiresAt: null, createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: placeIds[3]!, eventType: "WITHDRAW",
        previousEventId: grantIds[3]!, reason: "판단 변경", effectiveAt: "2026-07-01T00:00:00.000Z",
        expiresAt: null, createdAt: "2026-07-01T00:00:00.000Z",
      },
    ]);

    const history = await listGoldenPickHistoryForPlaces(db, placeIds, "2026-08-11T00:00:00.000Z");

    expect(history.get(placeIds[0]!)).toEqual({
      placeId: placeIds[0], active: true, activeStrength: 1, pastStrength: 0, reviewerUserId: reviewerId,
    });
    expect(history.get(placeIds[1]!)).toEqual({
      placeId: placeIds[1], active: true, activeStrength: .8, pastStrength: 0, reviewerUserId: reviewerId,
    });
    expect(history.get(placeIds[2]!)).toEqual({
      placeId: placeIds[2], active: false, activeStrength: 0, pastStrength: .4, reviewerUserId: reviewerId,
    });
    expect(history.get(placeIds[3]!)).toEqual({
      placeId: placeIds[3], active: false, activeStrength: 0, pastStrength: 0, reviewerUserId: null,
    });
    expect(history.get(placeIds[4]!)).toEqual({
      placeId: placeIds[4], active: false, activeStrength: 0, pastStrength: .4, reviewerUserId: reviewerId,
    });
    expect(history.get(placeIds[5]!)).toEqual({
      placeId: placeIds[5], active: false, activeStrength: 0, pastStrength: 0, reviewerUserId: null,
    });
  });
});
