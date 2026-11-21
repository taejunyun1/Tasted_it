import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { getPublicSitemapCounts, listPublicSitemapPage } from "../../app/features/places/public-metadata.server";
import { loader as sitemap } from "../../app/routes/sitemap";
import { loader as robots } from "../../app/routes/robots";
import { RSI_LIVE_ORIGIN } from "../../app/features/operations/rsi-self-check";

const now = "2026-11-18T00:00:00.000Z";

it("paginates all current public places while excluding hidden, ineligible and active TEMP rows", async () => {
  const db = createDb(env.DB), key = crypto.randomUUID(), parent = `parent-${key}`, child = `child-${key}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO categories(id,slug,name,emoji,is_active,sort_order,created_at,updated_at) VALUES(?,?,?,'🍚',1,1,?,?)").bind(parent, parent, "합성", now, now),
    env.DB.prepare("INSERT INTO categories(id,slug,name,emoji,parent_id,is_active,sort_order,created_at,updated_at) VALUES(?,?,?,'🍚',?,1,1,?,?)").bind(child, child, "합성", parent, now, now),
  ]);
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < 125; index += 1) {
    const id = `public-${key}-${index}`;
    statements.push(env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED','합성 주소','합성',35.15,126.9,'합성',?,?)").bind(id, id, `합성 식당 ${index}`, now, now));
    statements.push(env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,?,1)").bind(id, child));
  }
  for (const [prefix, status, name] of [["hidden", "HIDDEN", "합성 비공개"], ["excluded", "PUBLISHED", "합성 카바레"], ["temp", "PUBLISHED", "합성 임시"]]) {
    const id = `${prefix}-${key}`;
    statements.push(env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,?,'합성 주소','합성',35.15,126.9,'합성',?,?)").bind(id, id, name, status, now, now));
    statements.push(env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,?,1)").bind(id, child));
  }
  await env.DB.batch(statements);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,?)").bind(key, "a".repeat(64), "b".repeat(64), now, now),
    env.DB.prepare("INSERT INTO temp_catalog_entries(id,batch_id,source_id,place_id,payload_json,created_at,updated_at) VALUES(?,?,?,?,'{}',?,?)").bind(`entry-${key}`, key, "temp100-001", `temp-${key}`, now, now),
  ]);
  expect(await getPublicSitemapCounts(db)).toEqual({ places: 125, categories: 1 });
  const first = await listPublicSitemapPage(db, "places", 1), second = await listPublicSitemapPage(db, "places", 2);
  expect(first).toHaveLength(100);
  expect(second).toHaveLength(25);
  expect(new Set([...first, ...second]).size).toBe(125);
  expect([...first, ...second].every((path) => path.startsWith(`/places/public-${key}`))).toBe(true);
  expect(await listPublicSitemapPage(db, "categories", 1)).toEqual([`/maps/${child}`]);
  const response = await sitemap({ request: new Request(`${RSI_LIVE_ORIGIN}/sitemap.xml`, { headers: { Host: "poison.example", "X-Forwarded-Host": "poison.example" } }) } as never);
  const xml = await response.text();
  expect(xml).toContain("<sitemapindex");
  expect(xml).toContain("section=places&amp;page=2");
  expect(xml).not.toContain("poison.example");
});

it("preserves static public entries and rejects invalid pages and untrusted origins", async () => {
  const staticResponse = await sitemap({ request: new Request("http://localhost/sitemap.xml?section=static") } as never);
  const xml = await staticResponse.text();
  expect(staticResponse.status).toBe(200);
  expect(xml.match(/<url>/g)).toHaveLength(7);
  expect(xml).toContain("http://localhost/places");
  for (const suffix of ["?section=places&page=0", "?section=places&page=50001", "?section=static&page=1", "?section=private"]) {
    expect((await sitemap({ request: new Request(`http://localhost/sitemap.xml${suffix}`) } as never)).status).toBe(400);
  }
  expect((await sitemap({ request: new Request("https://poison.example/sitemap.xml") } as never)).status).toBe(503);
  const rules = await robots({ request: new Request("http://localhost/robots.txt", { headers: { "X-Forwarded-Host": "poison.example" } }) } as never);
  expect(await rules.text()).toContain("Sitemap: http://localhost/sitemap.xml");
});
