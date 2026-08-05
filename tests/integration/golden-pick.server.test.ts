import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { places, reviewerProfiles, users } from "../../app/db/schema";
import { expireGoldenPicks, grantGoldenPick, listActiveGoldenPicks, withdrawGoldenPick } from "../../app/features/ratings/golden-pick.server";

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
});
