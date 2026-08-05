import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { categories, currentVotes, placeCategories, places, reviewerProfiles, users, voteEvents } from "../../app/db/schema";
import { getMemberTasteGraph, getPlaceFlavorPrint, saveFlavorTemplate, submitFlavorRating } from "../../app/features/ratings/flavor-print.server";

const now = "2026-08-06T00:00:00.000Z";
const dimensions = ["국물 농도", "향신료", "감칠맛", "식감", "양"];

async function seedFlavor(prefix: string, placeCount = 1) {
  const db = createDb(env.DB);
  const categoryId = `${prefix}-category`;
  await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "국밥", emoji: "🍲", sortOrder: 1, isActive: true, createdAt: now, updatedAt: now });
  const placeIds = Array.from({ length: placeCount }, (_, index) => `${prefix}-place-${index}`);
  await db.insert(places).values(placeIds.map((id) => ({ id, slug: id, name: id, status: "PUBLISHED" as const, address: "광주 동구", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: id, createdAt: now, updatedAt: now })));
  await db.insert(placeCategories).values(placeIds.map((placeId) => ({ placeId, categoryId, isPrimary: true })));
  const template = await saveFlavorTemplate(db, { id: `${prefix}-template`, categoryId, version: "v1", dimensions, actorUserId: null, now, activate: true });
  return { db, categoryId, placeIds, template };
}

async function seedReviewer(db: ReturnType<typeof createDb>, id: string) {
  await db.insert(users).values({ id, email: `${id}@example.com`, displayName: id, role: "REVIEWER", createdAt: now, updatedAt: now });
  await db.insert(reviewerProfiles).values({ userId: id, slug: id, status: "ACTIVE", occupation: "테스터", tasteDirection: "균형", regionCode: "GWANGJU", specialtySlugs: "[]", lastActivityAt: now, approvedAt: now, createdAt: now, updatedAt: now });
}

describe("Flavor Print", () => {
  it("validates five to seven unique dimensions and publishes after three reviewer ratings", async () => {
    const prefix = `flavor-place-${crypto.randomUUID()}`;
    const { db, placeIds, template } = await seedFlavor(prefix);
    await expect(saveFlavorTemplate(db, { id: `${prefix}-bad`, categoryId: `${prefix}-category`, version: "bad", dimensions: ["하나"], actorUserId: null, now, activate: false })).rejects.toThrow("FLAVOR_DIMENSION_COUNT");
    for (let index = 0; index < 3; index += 1) {
      const reviewerId = `${prefix}-reviewer-${index}`;
      await seedReviewer(db, reviewerId);
      await submitFlavorRating(db, { id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId: placeIds[0], templateId: template.id, values: Object.fromEntries(dimensions.map((dimension, dimensionIndex) => [dimension, 2 + ((dimensionIndex + index) % 3)])), confidence: "HIGH", now });
    }
    const print = await getPlaceFlavorPrint(db, placeIds[0]);
    expect(print).toMatchObject({ status: "VISIBLE", ratingCount: 3, templateVersion: "v1" });
    expect(print.dimensions[0]).toEqual({ key: "국물 농도", median: 3, q1: 2, q3: 4 });
  });

  it("keeps member taste learning until five recommended places have visible prints", async () => {
    const prefix = `flavor-member-${crypto.randomUUID()}`;
    const { db, placeIds, template } = await seedFlavor(prefix, 5);
    for (let index = 0; index < 3; index += 1) {
      const reviewerId = `${prefix}-reviewer-${index}`;
      await seedReviewer(db, reviewerId);
      for (const placeId of placeIds) {
        await submitFlavorRating(db, { id: crypto.randomUUID(), reviewerUserId: reviewerId, placeId, templateId: template.id, values: Object.fromEntries(dimensions.map((dimension) => [dimension, 4])), confidence: "MEDIUM", now });
      }
    }
    const memberId = `${prefix}-member`;
    await db.insert(users).values({ id: memberId, email: `${memberId}@example.com`, displayName: memberId, role: "USER", createdAt: now, updatedAt: now });
    for (const [index, placeId] of placeIds.entries()) {
      const eventId = `${prefix}-vote-${index}`;
      await db.insert(voteEvents).values({ id: eventId, placeId, userId: memberId, value: 1, eventType: "CREATE", createdAt: now });
      await db.insert(currentVotes).values({ placeId, userId: memberId, eventId, value: 1, updatedAt: now });
    }
    expect(await getMemberTasteGraph(db, memberId)).toMatchObject({ status: "VISIBLE", placeCount: 5 });
  });
});
