import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { categories, placeCategories, places } from "../../app/db/schema";
import { getPublicPlaceCounts, listPlaces, listPublicCategoryGroups } from "../../app/features/places/place.server";

const now = "2026-11-18T00:00:00.000Z";
async function fixture() {
  const db = createDb(env.DB), key = crypto.randomUUID();
  const parent = `parent-${key}`, child = `child-${key}`;
  await db.insert(categories).values([
    { id: parent, slug: parent, name: "합성 대분류", emoji: "🍚", isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
    { id: child, slug: child, name: "합성 소분류", emoji: "🥣", parentId: parent, isActive: true, sortOrder: 2, createdAt: now, updatedAt: now },
  ]);
  for (const [suffix, name, latitude, status] of [
    ["inside", "검수 국밥", 35.15, "PUBLISHED"],
    ["outside", "검수 국밥", 35.3, "PUBLISHED"],
    ["different", "검수 라멘", 35.15, "PUBLISHED"],
    ["hidden", "검수 국밥", 35.15, "HIDDEN"],
    ["excluded", "검수 카바레", 35.15, "PUBLISHED"],
  ] as const) {
    const id = `${suffix}-${key}`;
    await db.insert(places).values({ id, slug: id, name, status, address: "합성 주소", neighborhood: "합성", latitude, longitude: 126.9, searchText: name, createdAt: now, updatedAt: now });
    await db.insert(placeCategories).values({ placeId: id, categoryId: child, isPrimary: true });
  }
  return { db, parent, child, key };
}

it("keeps zero-viewport categories and separates current counts from same-query overall counts", async () => {
  const { db, parent, child } = await fixture();
  const filters = { query: "국밥", bbox: [126.8, 35.1, 127, 35.2] as [number, number, number, number] };
  const groups = await listPublicCategoryGroups(db, filters);
  const category = groups.find((group) => group.id === parent)!.children[0];
  expect(category).toMatchObject({ id: child, count: 1, overallCount: 2 });
  expect((await listPlaces(db, { ...filters, categorySlug: child })).length).toBe(category.count);
  const empty = await listPublicCategoryGroups(db, { ...filters, bbox: [127.1, 35.1, 127.2, 35.2] });
  expect(empty.find((group) => group.id === parent)!.children[0]).toMatchObject({ id: child, count: 0, overallCount: 2 });
  const noQueryMatch = await listPublicCategoryGroups(db, { ...filters, query: "해당없음" });
  expect(noQueryMatch.find((group) => group.id === parent)!.children[0]).toMatchObject({ id: child, count: 0, overallCount: 0 });
  const counts = await getPublicPlaceCounts(db, { ...filters, categorySlug: child });
  expect(counts).toMatchObject({ count: 1, overallCount: 2 });
  expect(counts.overallBounds).not.toBeNull();
  expect((await getPublicPlaceCounts(db, { ...filters, categorySlug: child, bbox: counts.overallBounds! })).count).toBe(2);
});

it("counts more than the display limit without building per-place IN parameters", async () => {
  const { db, child, parent, key } = await fixture();
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < 125; index += 1) {
    const id = `count-${key}-${index}`, name = `합성${key} 식당 ${index}`;
    statements.push(env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED','합성 주소','합성',35.15,126.9,?,?,?)").bind(id, id, name, name, now, now));
    statements.push(env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,?,1)").bind(id, child));
  }
  await env.DB.batch(statements);
  const filters = { query: `합성${key}`, bbox: [126.8, 35.1, 127, 35.2] as [number, number, number, number] };
  expect(await getPublicPlaceCounts(db, { ...filters, categorySlug: child })).toMatchObject({ count: 125, overallCount: 125 });
  expect((await listPublicCategoryGroups(db, filters)).find((group) => group.id === parent)!.children[0]).toMatchObject({ count: 125, overallCount: 125 });
  expect(await listPlaces(db, { ...filters, categorySlug: child, limit: 5 })).toHaveLength(5);
});

it("uses published TEMP membership in both category and result counts", async () => {
  const { db, parent, child, key } = await fixture();
  await env.DB.prepare("INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,?)").bind(key, "a".repeat(64), "b".repeat(64), now, now).run();
  await env.DB.prepare("INSERT INTO temp_catalog_entries(id,batch_id,source_id,place_id,payload_json,created_at,updated_at) VALUES(?,?,?,?,'{}',?,?)").bind(`entry-${key}`, key, "temp100-001", `inside-${key}`, now, now).run();
  const filters = { query: "국밥", bbox: [126.8, 35.1, 127, 35.2] as [number, number, number, number], tempOnly: true };
  expect(await getPublicPlaceCounts(db, { ...filters, categorySlug: child })).toMatchObject({ count: 1, overallCount: 1 });
  expect((await listPublicCategoryGroups(db, filters)).find((group) => group.id === parent)!.children[0]).toMatchObject({ count: 1, overallCount: 1 });
  await env.DB.prepare("UPDATE temp_catalog_batches SET status='WITHDRAWN' WHERE id=?").bind(key).run();
  expect(await getPublicPlaceCounts(db, { ...filters, categorySlug: child })).toMatchObject({ count: 0, overallCount: 0, overallBounds: null });
  expect((await listPublicCategoryGroups(db, filters)).find((group) => group.id === parent)!.children[0]).toMatchObject({ count: 0, overallCount: 0 });
});
