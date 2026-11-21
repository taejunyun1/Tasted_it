import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const local = !process.env.BASE_URL || ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.BASE_URL).hostname);
test.skip(!local, "Metadata fixtures run only against the local E2E database.");
const rawName = '메타 </script><img src=x onerror="window.__metadataInjected=true">';
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
function sql(command: string) {
  if (!local) throw new Error("LOCAL_METADATA_FIXTURE_REQUIRED");
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", command], { stdio: "pipe" });
}
function cleanup() {
  sql("DELETE FROM temp_catalog_entries WHERE id='e2e-metadata-temp-entry'; DELETE FROM temp_catalog_batches WHERE id='e2e-metadata-batch'; DELETE FROM places WHERE id IN ('e2e-metadata-escaped','e2e-metadata-temp');");
}
test.beforeAll(() => {
  cleanup();
  const now = "2026-11-18T00:00:00.000Z";
  const payload = JSON.stringify({ sourceId: "temp100-001", name: "메타 TEMP", address: "합성 주소", region: "광주", cuisine: "일식", summary: "실제 업소가 아닌 메타데이터 합성 검증입니다.", sourceUrl: "https://tour.gwangju.go.kr/example", sourceTitle: "합성 출처", checkedAt: now, evaluation: { kind: "OFFICIAL_CURATION", provider: "합성", sourceUrl: "https://tour.gwangju.go.kr/example" }, photo: null });
  sql(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES
    ('e2e-metadata-escaped','e2e-metadata-escaped',${quote(rawName)},'PUBLISHED','합성 주소','합성동',35.15,126.9,'합성',${quote(now)},${quote(now)}),
    ('e2e-metadata-temp','e2e-metadata-temp','메타 TEMP','PUBLISHED','합성 주소','합성동',35.15,126.9,'합성',${quote(now)},${quote(now)});
    INSERT INTO place_categories(place_id,category_id,is_primary) VALUES ('e2e-metadata-escaped','cat-ramen',1),('e2e-metadata-temp','cat-ramen',1);
    INSERT INTO temp_catalog_batches(id,source_hash,manifest_hash,status,created_at,updated_at) VALUES('e2e-metadata-batch','${"a".repeat(64)}','${"b".repeat(64)}','PUBLISHED',${quote(now)},${quote(now)});
    INSERT INTO temp_catalog_entries(id,batch_id,source_id,place_id,payload_json,created_at,updated_at) VALUES('e2e-metadata-temp-entry','e2e-metadata-batch','temp100-001','e2e-metadata-temp',${quote(payload)},${quote(now)},${quote(now)});`);
});
test.afterAll(cleanup);
test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
});

test("place sharing uses visible names, queryless canonical URLs and escaped JSON-LD", async ({ page }) => {
  await page.goto("/places/e2e-metadata-escaped?utm_source=metadata-test");
  await expect(page).toHaveTitle(`${rawName} · 합성동 — Re:Taste`);
  const origin = new URL(page.url()).origin;
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${origin}/places/e2e-metadata-escaped`);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `${origin}/places/e2e-metadata-escaped`);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", `${rawName} · 합성동 — Re:Taste`);
  const raw = await page.locator('script[type="application/ld+json"]').textContent();
  expect(raw).not.toContain("</script>");
  const data = JSON.parse(raw!);
  expect(data).toMatchObject({ "@type": "Restaurant", name: rawName, address: { streetAddress: "합성 주소" } });
  expect(data).not.toHaveProperty("aggregateRating");
  expect(data).not.toHaveProperty("image");
  expect(data).not.toHaveProperty("geo");
  await expect(page.locator("img[onerror]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __metadataInjected?: boolean }).__metadataInjected)).toBeUndefined();
});

test("TEMP remains noindex and is absent from the public sitemap", async ({ page, request }) => {
  await page.goto("/places/e2e-metadata-temp");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  const response = await request.get("/sitemap.xml?section=places&page=1");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(xml).toContain("/places/e2e-metadata-escaped");
  expect(xml).not.toContain("/places/e2e-metadata-temp");
  const index = await request.get("/sitemap.xml");
  const indexXml = await index.text();
  expect(indexXml).toContain("section=places&amp;page=1");
  expect(await page.evaluate((xml) => new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror") === null, indexXml)).toBe(true);
});

test("public exploration pages retain descriptive titles and canonical paths", async ({ page }) => {
  for (const entry of [
    { path: "/?qa=1&view=browse", canonical: "/", title: "Re:Taste — 내 주변 맛 지도" },
    { path: "/places?temp=1", canonical: "/places", title: "맛집 리스트 — Re:Taste" },
    { path: "/maps/ramen-detail?q=해당없는검색어", canonical: "/maps/ramen-detail", title: "라멘 지도 — Re:Taste" },
  ]) {
    await page.goto(entry.path);
    await expect(page).toHaveTitle(entry.title);
    const canonical = `${new URL(page.url()).origin}${entry.canonical}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
    await expect(page.locator('meta[name="description"]')).not.toHaveAttribute("content", "");
    if (entry.path === "/places?temp=1") await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
  }
});
