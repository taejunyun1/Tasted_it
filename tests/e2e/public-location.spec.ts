import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses a synthetic local D1 location fixture");

const query = "QA 위치범위";
const gunsan = { latitude: 35.9677, longitude: 126.7369, accuracy: 20 };
const seoul = { latitude: 37.5665, longitude: 126.978, accuracy: 20 };
const gunsanBounds = "126.71190,35.94970,126.76190,35.98570";
const defaultBounds = "126.72000,35.03000,127.02000,35.25000";
const outsideNotice = "현재 위치는 광주·전남·전북 탐색 범위 밖에 있습니다.";
const gunsanName = "QA 위치범위 군산 라멘";
const gwangjuName = "QA 위치범위 광주 라멘";

function executeLocalSql(sql: string) {
  execFileSync(process.execPath, [
    "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB",
    "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state",
    "--command", sql,
  ], { stdio: "pipe" });
}

test("Gunsan GPS narrows public home and category results, and outside locations fall back to Gwangju", async ({ page, context, baseURL }, testInfo) => {
  if (!isControlledLocalBaseUrl(baseURL) || !/^[a-z0-9-]+$/.test(testInfo.project.name)) throw new Error("Local location fixture only");
  const origin = new URL(baseURL!).origin;
  const fixture = `qa-public-gps-${testInfo.project.name}`;
  const ids = `'${fixture}-gunsan','${fixture}-gwangju','${fixture}-hidden'`;
  const cleanup = `
    DELETE FROM place_categories WHERE place_id IN (${ids});
    DELETE FROM places WHERE id IN (${ids});
  `;

  try {
    executeLocalSql(`${cleanup}
      INSERT INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at)
      VALUES
        ('${fixture}-gunsan','${fixture}-gunsan','${gunsanName}','PUBLISHED','전북특별자치도 군산시 합성로 1','군산시',35.9677,126.7369,'${query}','2026-11-22T00:00:00Z','2026-11-22T00:00:00Z'),
        ('${fixture}-gwangju','${fixture}-gwangju','${gwangjuName}','PUBLISHED','광주광역시 동구 합성로 1','동구',35.15,126.92,'${query}','2026-11-22T00:00:00Z','2026-11-22T00:00:00Z'),
        ('${fixture}-hidden','${fixture}-hidden','QA 위치범위 비공개 라멘','HIDDEN','전북특별자치도 군산시 합성로 2','군산시',35.9678,126.737,'${query}','2026-11-22T00:00:00Z','2026-11-22T00:00:00Z');
      INSERT INTO place_categories (place_id, category_id, is_primary)
      SELECT id, 'cat-ramen', 1 FROM places WHERE id IN (${ids});
    `);

    await context.route(url => url.origin !== origin && url.protocol.startsWith("http"), route => route.abort());
    await context.grantPermissions(["geolocation"], { origin });
    await context.setGeolocation(gunsan);
    const homeSearch = new URLSearchParams({ view: "browse", category: "ramen-detail", q: query, bbox: defaultBounds });
    await page.goto(`/?${homeSearch}`);
    await expect(page.locator(".map-canvas")).toHaveAttribute("data-map-unavailable", "true");
    if (testInfo.project.name === "mobile-chromium") await page.getByRole("button", { name: "목록", exact: true }).click();
    const homeResults = page.getByRole("complementary", { name: "장소 탐색" });
    const homeRows = homeResults.getByRole("button", { name: / 선택$/ });
    await expect(homeRows).toHaveCount(1);
    await expect(homeRows.first()).toHaveAccessibleName(`${gwangjuName} 선택`);
    const locateHome = homeResults.getByRole("button", { name: /내 주변/ });
    await locateHome.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("bbox")).toBe(gunsanBounds);
    await expect(homeResults.getByRole("textbox", { name: "장소 검색" })).toHaveValue(query);
    await expect(homeRows).toHaveCount(1);
    await expect(homeRows.first()).toHaveAccessibleName(`${gunsanName} 선택`);
    const currentHome = new URL(page.url()).searchParams;
    expect(currentHome.get("view")).toBe("browse");
    expect(currentHome.get("category")).toBe("ramen-detail");
    expect(currentHome.get("q")).toBe(query);
    expect(currentHome.get("locationSource")).toBe("gps");
    await page.screenshot({ path: testInfo.outputPath("gunsan-home.png"), fullPage: true });

    await context.setGeolocation(seoul);
    await locateHome.click();
    const mapNotice = page.locator(".map-canvas").getByRole("status");
    await expect(mapNotice.getByText(outsideNotice, { exact: true })).toBeVisible();
    await expect(mapNotice.getByText(/지도를 불러오지 못했습니다/)).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("bbox")).toBe(defaultBounds);
    await expect(homeRows).toHaveCount(1);
    await expect(homeRows.first()).toHaveAccessibleName(`${gwangjuName} 선택`);
    await expect(homeResults.getByRole("textbox", { name: "장소 검색" })).toHaveValue(query);
    await page.screenshot({ path: testInfo.outputPath("outside-home.png"), fullPage: true });

    await context.setGeolocation(gunsan);
    const categorySearch = new URLSearchParams({ view: "list", q: query, bbox: defaultBounds });
    await page.goto(`/maps/ramen-detail?${categorySearch}`);
    await expect(page.locator(".map-canvas")).toHaveAttribute("data-map-unavailable", "true");
    const categoryRows = page.getByRole("region", { name: "장소 목록" }).locator(".place-card");
    await expect(categoryRows).toHaveCount(1);
    await expect(categoryRows.first()).toHaveAttribute("id", `place-${fixture}-gwangju`);
    const locate = page.getByRole("button", { name: "내 주변", exact: true });
    await locate.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("bbox")).toBe(gunsanBounds);
    await expect(categoryRows).toHaveCount(1);
    await expect(categoryRows.first()).toHaveAttribute("id", `place-${fixture}-gunsan`);
    await expect(page.getByRole("textbox", { name: "동네 또는 가게" })).toHaveValue(query);
    await expect(page.locator(".explore-split")).toHaveAttribute("data-view", "list");
    expect(new URL(page.url()).pathname).toBe("/maps/ramen-detail");
    await page.screenshot({ path: testInfo.outputPath("gunsan-category.png"), fullPage: true });

    await context.setGeolocation(seoul);
    await locate.click();
    await expect(page.getByRole("status").filter({ hasText: outsideNotice })).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("bbox")).toBe(defaultBounds);
    await expect(categoryRows).toHaveCount(1);
    await expect(categoryRows.first()).toHaveAttribute("id", `place-${fixture}-gwangju`);
    await expect(page.getByRole("textbox", { name: "동네 또는 가게" })).toHaveValue(query);
    await page.screenshot({ path: testInfo.outputPath("outside-category.png"), fullPage: true });
  } finally {
    executeLocalSql(cleanup);
  }
});
