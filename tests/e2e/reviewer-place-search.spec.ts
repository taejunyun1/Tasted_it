import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const errors = new WeakMap<Page, Error[]>();

const remote = process.env.BASE_URL;
test.skip(Boolean(remote && !["127.0.0.1", "localhost"].includes(new URL(remote).hostname)), "합성 장소 생성은 로컬 D1에서만 실행합니다.");

test.beforeAll(() => {
  const sql = Array.from({ length: 43 }, (_, index) => {
    const number = String(index).padStart(2, "0"), id = `qa-picker-${number}`;
    return `INSERT OR IGNORE INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES('${id}','${id}','끝까지선택검증 ${number}','PUBLISHED','합성 주소 ${number}','합성동',35.15,126.92,'끝까지선택검증','2026-11-18T00:00:00Z','2026-11-18T00:00:00Z'); INSERT OR IGNORE INTO place_categories(place_id,category_id,is_primary) VALUES('${id}','cat-ramen',1);`;
  }).join("\n");
  execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { stdio: "pipe" });
});

test.afterAll(() => {
  const ids = Array.from({ length: 43 }, (_, index) => `'qa-picker-${String(index).padStart(2, "0")}'`).join(",");
  execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", `DELETE FROM place_categories WHERE place_id IN (${ids}); DELETE FROM places WHERE id IN (${ids});`], { stdio: "pipe" });
});

test.beforeEach(async ({ context, page }, testInfo) => {
  const seen: Error[] = []; errors.set(page, seen); page.on("pageerror", (error) => seen.push(error));
  await context.addCookies([{ name: "retaste_session", value: "qa-active-reviewer-session", url: String(testInfo.project.use.baseURL) }]);
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

test("pages through all places and retains an off-page selection and draft across searches and reload", async ({ page }, testInfo) => {
  await page.goto("/reviewer/ratings");
  const search = page.getByPlaceholder("다녀온 장소 검색");
  await search.fill("끝까지선택검증");
  await expect(page.getByText(/“끝까지선택검증” 검색 결과/)).toBeVisible();
  const results = page.getByLabel("장소 검색 결과", { exact: true });
  await expect(results.getByRole("button")).toHaveCount(20);
  await expect(results).toContainText("끝까지선택검증 00");
  await page.getByRole("button", { name: "다음 장소", exact: true }).click();
  await expect(results).toContainText("끝까지선택검증 20");
  await page.getByRole("button", { name: "다음 장소", exact: true }).click();
  await expect(results.getByRole("button")).toHaveCount(3);
  await results.getByRole("button", { name: /끝까지선택검증 42/ }).click();
  await page.getByRole("button", { name: "다음: 평가", exact: true }).click();
  await page.getByRole("button", { name: "보류", exact: true }).click();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await search.fill("끝까지선택검증 00");
  await expect(results.getByRole("button")).toHaveCount(1);
  await expect(page.locator('input[name="placeId"]')).toHaveValue("qa-picker-42");
  await expect(page.locator('input[name="evaluation"]')).toHaveValue("HOLD");
  await page.reload();
  await expect(page.getByText("작성 중이던 리뷰를 이어서 열었어요.")).toBeVisible();
  await expect(page.locator('input[name="placeId"]')).toHaveValue("qa-picker-42");
  await expect(page.locator('input[name="evaluation"]')).toHaveValue("HOLD");
  await expect(page.locator(".reviewer-live-summary")).toContainText("끝까지선택검증 42");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `docs/evidence/2026-11-18-reviewer-place-search-${testInfo.project.name}.png`, fullPage: true });
});

test("keeps the current results when search fails and allows an explicit retry", async ({ page }) => {
  await page.goto("/reviewer/ratings");
  await page.getByPlaceholder("다녀온 장소 검색").fill("끝까지선택검증 00");
  await page.getByPlaceholder("다녀온 장소 검색").press("Enter");
  const results = page.getByLabel("장소 검색 결과", { exact: true });
  await expect(page.getByText(/“끝까지선택검증 00” 검색 결과/)).toBeVisible();
  await expect(results.getByRole("button")).toHaveCount(1);
  await expect(results).toContainText("끝까지선택검증 00");
  await page.route("**/resources/reviewer-places.data*", (route) => route.abort());
  await page.getByPlaceholder("다녀온 장소 검색").fill("끝까지선택검증 42");
  await expect(page.getByRole("alert")).toContainText("장소를 불러오지 못했어요");
  await expect(results).toContainText("끝까지선택검증 00");
  await page.unroute("**/resources/reviewer-places.data*");
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(results).toContainText("끝까지선택검증 42");
});
