import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { getPublicPlacePage } from "../../app/features/places/place.server";

const now = "2026-11-18T02:00:00.000Z";
const bbox = [126.8, 35.1, 127, 35.2] as [number, number, number, number];

async function fixture() {
  const key = `page-${crypto.randomUUID()}`, category = `${key}-category`;
  await env.DB.prepare("INSERT INTO categories(id,slug,name,emoji,sort_order,is_active,created_at,updated_at) VALUES(?,?,'합성 식당','🍚',1,1,?,?)").bind(category, category, now, now).run();
  const ids = Array.from({ length: 125 }, (_, index) => `${key}-${String(index).padStart(3, "0")}`);
  const statements = ids.flatMap((id) => [
    env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,'동명이점','PUBLISHED','합성 주소','합성',35.15,126.9,?,?,?)").bind(id, id, key, now, now),
    env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,?,1)").bind(id, category),
  ]);
  await env.DB.batch(statements);
  return { db: createDb(env.DB), key, category, ids };
}

it("reaches all 125 same-name places exactly once in bounded stable pages", async () => {
  const { db, key, category, ids } = await fixture();
  const filters = { query: key, categorySlug: category, bbox };
  const first = await getPublicPlacePage(db, filters, 1);
  const second = await getPublicPlacePage(db, filters, 2);
  expect(first).toMatchObject({ total: 125, page: 1, pageSize: 100, totalPages: 2, start: 1, end: 100 });
  expect(second).toMatchObject({ total: 125, page: 2, pageSize: 100, totalPages: 2, start: 101, end: 125 });
  expect(first.places).toHaveLength(100);
  expect(second.places).toHaveLength(25);
  expect([...first.places, ...second.places].map((place) => place.id)).toEqual(ids);
  expect((await getPublicPlacePage(db, filters, 1)).places.map((place) => place.id)).toEqual(first.places.map((place) => place.id));
  expect(await getPublicPlacePage(db, filters, Number.MAX_SAFE_INTEGER)).toMatchObject({ total: 125, places: [], outOfRange: true });
  await expect(getPublicPlacePage(db, filters, 0)).rejects.toThrow("PUBLIC_PLACE_PAGE_INVALID");
  await env.DB.prepare("UPDATE places SET name='ALPHA_100% 국밥' WHERE id=?").bind(ids[0]).run();
  for (const query of ["alpha", "ALPHA", "%", "_", "국밥"]) {
    expect((await getPublicPlacePage(db, { ...filters, query }, 1)).places.map((place) => place.id)).toEqual([ids[0]]);
  }
  expect((await getPublicPlacePage(db, { ...filters, query: "주소" }, 1)).total).toBe(125);
  expect(await getPublicPlacePage(db, { ...filters, query: "x".repeat(60) }, 1)).toMatchObject({ total: 0, places: [] });
  await env.DB.prepare("UPDATE places SET status='HIDDEN' WHERE id=?").bind(ids[0]).run();
  const afterHide = await getPublicPlacePage(db, filters, 1);
  expect(afterHide.total).toBe(124);
  expect(afterHide.places.some((place) => place.id === ids[0])).toBe(false);
  expect(await getPublicPlacePage(db, { ...filters, query: `${key}-missing` }, 1)).toMatchObject({ total: 0, places: [], start: 0, end: 0, outOfRange: false });
});

it("uses the same published TEMP membership and geographic filters in totals and rows", async () => {
  const { db, key, category, ids } = await fixture();
  const payload = { sourceId: "temp100-001", name: "합성 식당", address: "광주 합성 주소", region: "광주", cuisine: "한식", summary: "실제 업소가 아닌 테스트용 합성 정보입니다.", sourceUrl: "https://tour.gwangju.go.kr/example", sourceTitle: "합성 출처", checkedAt: now, evaluation: { kind: "OFFICIAL_CURATION", provider: "합성", sourceUrl: "https://tour.gwangju.go.kr/example" }, photo: null };
  await env.DB.prepare("INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,?)").bind(key, "a".repeat(64), "b".repeat(64), now, now).run();
  await env.DB.prepare("INSERT INTO temp_catalog_entries(id,batch_id,source_id,place_id,payload_json,created_at,updated_at) VALUES(?,?,'temp100-001',?,?,?,?)").bind(`entry-${key}`, key, ids[0], JSON.stringify(payload), now, now).run();
  const filters = { query: key, categorySlug: category, bbox, tempOnly: true };
  const result = await getPublicPlacePage(db, filters, 1);
  expect(result.total).toBe(1);
  expect(result.places.map((place) => place.id)).toEqual([ids[0]]);
  expect(await getPublicPlacePage(db, { ...filters, bbox: [127.1, 35.1, 127.2, 35.2] }, 1)).toMatchObject({ total: 0, places: [] });
  await env.DB.prepare("UPDATE temp_catalog_batches SET status='WITHDRAWN' WHERE id=?").bind(key).run();
  expect(await getPublicPlacePage(db, filters, 1)).toMatchObject({ total: 0, places: [] });
});
