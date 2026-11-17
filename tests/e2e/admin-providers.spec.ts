import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const localD1 = (sql: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { encoding: "utf8" });

test("provider usage separates estimates, reservations and unmeasured costs", async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "Requires isolated local D1 fixtures");
  const now = new Date().toISOString(), today = now.slice(0, 10), yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const prefix = `qa-provider-${testInfo.project.name}`;
  localD1(`DELETE FROM provider_call_attempts; DELETE FROM provider_daily_quotas;
    INSERT INTO provider_daily_quotas(provider,utc_day,baseline_at,baseline_source,cutover_state,is_cutover_anchor,cutover_verified_at,ready_after_utc_day,cutover_receipt_ref,created_at,updated_at)
    VALUES('NAVER_LOCAL_SEARCH','${yesterday}','${now}','EMPTY_NEW_DAY','READY',1,'${now}','${today}','synthetic-e2e','${now}','${now}');
    INSERT INTO provider_daily_quotas(provider,utc_day,legacy_total,legacy_gwangju,legacy_jeonnam,reserved_total,reserved_gwangju,reserved_jeonnam,baseline_at,baseline_source,cutover_state,created_at,updated_at)
    VALUES('NAVER_LOCAL_SEARCH','${today}',4,3,2,3,2,1,'${now}','LEGACY_RUN_ESTIMATE','READY','${now}','${now}');
    INSERT INTO provider_call_attempts(id,provider,utc_day,region_code,source,reserved_at,dispatch_started_at,finished_at,outcome)
    VALUES('${prefix}-ok','NAVER_LOCAL_SEARCH','${today}','GWANGJU','PENDING_VERIFICATION','${now}','${now}','${now}','SUCCEEDED'),
    ('${prefix}-unknown','NAVER_LOCAL_SEARCH','${today}','JEONNAM','PLACE_LIVENESS','${now}','${now}','${now}','UNKNOWN'),
    ('${prefix}-pending','NAVER_LOCAL_SEARCH','${today}','GWANGJU','TEMP_GEOCODE','${now}',NULL,NULL,'PENDING');`);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 500) errors.push(`HTTP ${response.status()}`); });
  try {
    await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
    const response = await page.goto("/admin/providers");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading", { name: "공급자 사용량", exact: true })).toBeVisible();
    await expect(page.getByText(`집계일 ${today} (UTC)`, { exact: false })).toBeVisible();
    const global = page.getByRole("article", { name: "전역 사용량", exact: true });
    await expect(global.getByText("4회", { exact: true })).toBeVisible();
    await expect(global.getByText("3회", { exact: true })).toBeVisible();
    await expect(global.getByText("7회", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "NAVER 지역검색" })).toContainText("결과 불명");
    await expect(page.getByText("실제 HTTP 호출 수 미측정", { exact: false })).toHaveCount(2);
    await expect(page.getByText("일반 서비스의 공급자 실행 경로 없음", { exact: false })).toBeVisible();
    await expect(page.locator("main form[method='post']")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("link", { name: "새로 조회", exact: true }).focus();
    await expect(page.getByRole("link", { name: "새로 조회", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(global.getByText("7회", { exact: true })).toBeVisible();
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.screenshot({ path: testInfo.outputPath("provider-usage.png"), fullPage: true });
    if (testInfo.project.name === "chromium") {
      await page.setViewportSize({ width: 320, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("provider-usage-320.png"), fullPage: true });
    }
    const denied = await page.request.post("/admin/providers", { headers: { Origin: new URL(page.url()).origin }, form: { intent: "change-budget", limit: "999999" } });
    expect(denied.status()).toBe(405);
    expect(errors).toEqual([]);
  } finally {
    localD1("DELETE FROM provider_call_attempts; DELETE FROM provider_daily_quotas;");
  }
});

test("member cannot read provider usage", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  const response = await page.goto("/admin/providers");
  expect(response?.status()).toBe(403);
  expect(response?.headers()["cache-control"]).toContain("no-store");
});
