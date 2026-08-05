import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { categories, currentVotes, placeCategories, places, savedPlaces, users, voteEvents } from "../../app/db/schema";
import { listMemberTaste } from "../../app/features/members/member.server";

describe("member taste", () => {
  it("returns only the member's published saved and rated places", async () => {
    const db = createDb(env.DB); const id = crypto.randomUUID(); const other = crypto.randomUUID(); const now = "2026-08-05T12:00:00Z"; const category = `member-category-${id}`; const place = `member-place-${id}`; const hidden = `member-hidden-${id}`;
    await db.insert(users).values([{ id, email: `${id}@example.com`, displayName: "나", role: "USER", createdAt: now, updatedAt: now }, { id: other, email: `${other}@example.com`, displayName: "남", role: "USER", createdAt: now, updatedAt: now }]);
    await db.insert(categories).values({ id: category, slug: category, name: "테스트", emoji: "🍚", sortOrder: 1, isActive: true, createdAt: now, updatedAt: now });
    await db.insert(places).values([{ id: place, slug: place, name: "공개 장소", status: "PUBLISHED", address: "광주 동명동", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "공개", createdAt: now, updatedAt: now }, { id: hidden, slug: hidden, name: "숨김 장소", status: "HIDDEN", address: "광주 동명동", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "숨김", createdAt: now, updatedAt: now }]);
    await db.insert(placeCategories).values([{ placeId: place, categoryId: category, isPrimary: true }, { placeId: hidden, categoryId: category, isPrimary: true }]);
    await db.insert(savedPlaces).values([{ userId: id, placeId: place, createdAt: now }, { userId: id, placeId: hidden, createdAt: now }, { userId: other, placeId: place, createdAt: now }]);
    const eventId = crypto.randomUUID(); await db.insert(voteEvents).values({ id: eventId, placeId: place, userId: id, value: 1, eventType: "CREATE", createdAt: now }); await db.insert(currentVotes).values({ placeId: place, userId: id, eventId, value: 1, updatedAt: now });
    const result = await listMemberTaste(db, id);
    expect(result.saved.map((row) => row.name)).toEqual(["공개 장소"]);
    expect(result.rated).toEqual([expect.objectContaining({ name: "공개 장소", value: 1 })]);
  });
});
