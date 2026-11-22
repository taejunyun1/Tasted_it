import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

let key = "";
const bbox = "126.8,35.1,127,35.2";
function localSql(sql: string) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { stdio: "pipe" });
}
function search() {
  const params = new URLSearchParams({ q: key, category: "ramen-detail", bbox });
  params.append("badge", "food-ramen");
  params.append("badge", "style-market");
  return params.toString();
}

test.beforeAll(() => {
  key = `page-ui-${crypto.randomUUID().slice(0, 8)}`;
  const now = "2026-11-18T02:00:00.000Z";
  const ids = Array.from({ length: 125 }, (_, index) => `${key}-${String(index).padStart(3, "0")}`);
  const values = ids.map((id, index) => `('${id}','${id}','페이지 검증 ${String(index).padStart(3, "0")}','PUBLISHED','광주광역시 합성 주소','합성',35.15,126.9,'${key}','${now}','${now}')`).join(",");
  localSql(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES ${values}; INSERT INTO place_categories(place_id,category_id,is_primary) VALUES ${ids.map((id) => `('${id}','cat-ramen',1)`).join(",")};`);
});
test.afterAll(() => { if (key) localSql(`DELETE FROM places WHERE substr(id,1,${key.length})='${key}';`); });

test("all 125 results are reachable and a new search returns to page one", async ({ page }, testInfo) => {
  await page.goto(`/places?${search()}`);
  await expect(page.locator("#place-search-status")).toContainText("전체 125곳 · 1–100번째 표시");
  await expect(page.locator(".discovery-grid > article")).toHaveCount(100);
  await expect(page.getByRole("link", { name: "이전 페이지", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "다음 페이지", exact: true }).click();
  await expect(page.locator("#place-search-status")).toContainText("전체 125곳 · 101–125번째 표시");
  await expect(page.locator("#all-places")).toBeFocused();
  await expect(page.locator(".discovery-grid > article")).toHaveCount(25);
  await expect(page).toHaveTitle("맛집 리스트 · 2페이지 — Re:Taste");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${new URL(page.url()).origin}/places?page=2`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
  await expect(page.getByRole("link", { name: "다음 페이지", exact: true })).toHaveCount(0);
  await page.locator("#all-places").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `output/playwright/public-place-page-two-${testInfo.project.name}.png` });
  const params = new URL(page.url()).searchParams;
  expect(params.get("page")).toBe("2");
  expect(params.get("q")).toBe(key);
  expect(params.get("category")).toBe("ramen-detail");
  expect(params.get("bbox")).toBe(bbox);
  expect(params.getAll("badge")).toEqual(["food-ramen", "style-market"]);
  await page.getByLabel("장소 검색", { exact: true }).fill(`${key}-missing`);
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await expect(page.locator("#place-search-status")).toContainText("전체 0곳");
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
});

test("invalid and no-longer-available pages retain filters and offer a working first-page recovery", async ({ page }, testInfo) => {
  const invalid = await page.goto(`/places?${search()}&page=0`);
  expect(invalid?.status()).toBe(400);
  await expect(page.getByRole("heading", { name: "검색 페이지를 확인해 주세요", exact: true })).toBeVisible();
  await expect(page.getByLabel("장소 검색", { exact: true })).toHaveValue(key);
  await page.getByRole("button", { name: "다시 검색", exact: true }).click();
  await expect(page.locator("#place-search-status")).toContainText("전체 125곳 · 1–100번째 표시");
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  const duplicate = await page.goto(`/places?${search()}&page=1&page=2`);
  expect(duplicate?.status()).toBe(400);
  await page.goto(`/places?${search()}&page=3`);
  await expect(page.getByText("이 페이지에 표시할 장소가 없습니다.", { exact: false })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${new URL(page.url()).origin}/places`);
  await page.locator("#all-places").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `output/playwright/public-place-page-recovery-${testInfo.project.name}.png` });
  await page.getByRole("link", { name: "같은 조건의 첫 페이지로 돌아가기", exact: true }).click();
  await expect(page.locator("#place-search-status")).toContainText("전체 125곳 · 1–100번째 표시");
  expect(new URL(page.url()).searchParams.getAll("badge")).toEqual(["food-ramen", "style-market"]);
});

test("the selected second-page results stay together in the list and browse map", async ({ page }, info) => {
  await page.route(/https:\/\/[^/]*(?:naver\.com|naver\.net|pstatic\.net)\//, route => route.abort());
  const searchParams = new URLSearchParams(search());
  const selected = `${key}-100`;
  searchParams.set("page", "2");
  searchParams.set("selected", selected);
  const hasSameConditions = (url: URL) => [...new Set(searchParams.keys())].every(name =>
    JSON.stringify(url.searchParams.getAll(name)) === JSON.stringify(searchParams.getAll(name)));
  await page.goto(`/places?${searchParams}`);
  const list = page.locator(".discovery-grid > .place-card");
  await expect(list).toHaveCount(25);
  await expect(page.locator(`#place-${selected}`)).toHaveAttribute("data-selected", "true");
  const names = await list.locator("h3").allTextContents();
  await page.getByRole("link", { name: "지도에서 보기", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === "/" && url.searchParams.get("view") === "browse" && hasSameConditions(url));
  await expect(page.getByRole("dialog", { name: `${names[0]} 빠른 정보` })).toBeVisible();
  const panel = page.getByRole("complementary", { name: "장소 탐색", exact: true });
  const found = panel.locator(".map-place-summary strong");
  await expect(found).toHaveCount(25);
  expect((await found.allTextContents()).sort()).toEqual(names.slice().sort());
  await expect(panel.locator(".map-result-head strong")).toHaveText("125");
  if (info.project.name === "mobile-chromium") {
    await panel.getByRole("button", { name: "목록", exact: true }).click();
  }
  await panel.getByRole("link", { name: "목록에서 보기", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === "/places" && hasSameConditions(url));
  await expect(page.locator(`#place-${selected}`)).toHaveAttribute("data-selected", "true");
  await expect(list).toHaveCount(25);
  await page.reload();
  await expect(page.locator(`#place-${selected}`)).toHaveAttribute("data-selected", "true");
});
