import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("admin can inspect rating operations", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/admin/ratings");
  await expect(page.getByRole("heading", { name: "평가 운영" })).toBeVisible();
  await expect(page.getByText("rating-v2.0")).toBeVisible();
  await expect(page.getByRole("heading", { name: "재계산 작업" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "조작 검토" })).toBeVisible();
});

test("member cannot open rating operations", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  const response = await page.goto("/admin/ratings");
  expect(response?.status()).toBe(403);
});


test("admin confirms and observes exactly the requested rating job", async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "Requires isolated local D1 fixtures");
  const suffix = testInfo.project.name === "chromium" ? "desktop" : "mobile";
  const olderJob = `qa-rating-older-${suffix}`;
  const localD1 = (sql: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { encoding: "utf8" });
  localD1(`DELETE FROM rating_recompute_jobs WHERE id='${olderJob}'; INSERT INTO rating_recompute_jobs (id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at) VALUES ('${olderJob}','sample-place-6','rating-config-v2','PLACE','PENDING','UI_EXACT_JOB_FIXTURE',0,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z');`);
  try {
    await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
    await page.goto("/admin/ratings");
    await page.getByRole("combobox", { name: "재계산 장소" }).selectOption(suffix === "desktop" ? "sample-place-1" : "sample-place-2");
    await page.getByRole("button", { name: "선택 장소 재계산", exact: true }).click();
    await expect(page.getByRole("heading", { name: "재계산 실행 확인" })).toBeVisible();
    await expect(page.getByText("아직 재계산을 실행하지 않았습니다.", { exact: false })).toBeVisible();
    await page.getByRole("status").screenshot({ path: testInfo.outputPath("rating-preview.png") });
    await page.getByRole("button", { name: "확인 후 재계산", exact: true }).click();
    const result = page.getByRole("status");
    await expect(result).toContainText("요청한 장소의 재계산이 완료됐습니다.");
    await expect(result).toContainText("COMPLETED");
    await expect(result).toContainText(suffix === "desktop" ? "sample-place-1" : "sample-place-2");
    await expect(page.locator(".admin-rating-table article").filter({ hasText: olderJob })).toContainText("PENDING");
    await result.screenshot({ path: testInfo.outputPath("rating-completed.png") });
    await result.getByRole("link", { name: "이 작업 상태 다시 확인" }).click();
    await expect(page.getByRole("status")).toContainText("COMPLETED");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    localD1(`DELETE FROM rating_recompute_jobs WHERE id='${olderJob}';`);
  }
});
