import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("ADMIN sees current rating config with future metadata and a clear unavailable state otherwise", async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "Requires isolated local D1 fixture");
  const localD1 = (sql: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { encoding: "utf8" });
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  const futureId = `qa-future-config-${testInfo.project.name}`;
  localD1(`INSERT INTO rating_configs(id,algorithm_version,minimum_visible_samples,alpha_prior,beta_prior,reviewer_max_share,settings_json,active_from,created_at,updated_at) VALUES('${futureId}','${futureId}',8,2,2,0.3,'{}','2099-01-01T00:00:00.000Z','2026-11-18T00:00:00.000Z','2026-11-18T00:00:00.000Z');`);
  try {
    expect((await page.goto("/admin/ratings"))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "평가 운영", exact: true })).toBeVisible();
    await expect(page.getByText("rating-v2.0", { exact: true })).toBeVisible();
    await expect(page.getByText(futureId, { exact: true })).toHaveCount(0);
    localD1("UPDATE rating_configs SET active_from='2099-01-01T00:00:00.000Z' WHERE id='rating-config-v2';");
    const response = await page.goto("/admin/ratings");
    expect(response?.status()).toBe(503);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading", { name: "현재 사용할 평가 설정이 없습니다.", exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("미래 설정으로 대체하거나 재계산을 실행하지 않았습니다.");
    if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("main").screenshot({ path: testInfo.outputPath("rating-config-unavailable.png") });
  } finally {
    localD1(`UPDATE rating_configs SET active_from='2026-08-06T00:00:00.000Z' WHERE id='rating-config-v2'; DELETE FROM rating_configs WHERE id='${futureId}';`);
  }
});
