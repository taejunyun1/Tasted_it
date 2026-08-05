import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { categories, placeCategories, places } from "../../app/db/schema";
import { listPublicCategoryGroups } from "../../app/features/places/place.server";
describe("public category groups", () => {
  it("counts only published primary places in active leaf categories", async () => {
    const db = createDb(env.DB); const key = crypto.randomUUID(); const now = "2026-08-05T12:00:00Z"; const parent = `parent-${key}`; const child = `child-${key}`;
    await db.insert(categories).values([{ id: parent, slug: parent, name: "대분류", emoji: "🍚", isActive: true, sortOrder: 1, createdAt: now, updatedAt: now }, { id: child, slug: child, name: "소분류", emoji: "🥣", parentId: parent, isActive: true, sortOrder: 2, createdAt: now, updatedAt: now }]);
    await db.insert(places).values([{ id: `pub-${key}`, slug: `pub-${key}`, name: "공개", status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "공개", createdAt: now, updatedAt: now }, { id: `hidden-${key}`, slug: `hidden-${key}`, name: "숨김", status: "HIDDEN", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "숨김", createdAt: now, updatedAt: now }]);
    await db.insert(placeCategories).values([{ placeId: `pub-${key}`, categoryId: child, isPrimary: true }, { placeId: `hidden-${key}`, categoryId: child, isPrimary: true }]);
    const groups = await listPublicCategoryGroups(db);
    expect(groups.find((group) => group.id === parent)?.children).toEqual([expect.objectContaining({ id: child, count: 1 })]);
  });
});
