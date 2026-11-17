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


test("admin reviews a bounded job action and resumes it after recent authentication", async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "Requires isolated local D1 fixtures");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) browserErrors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
  });
  const suffix = testInfo.project.name === "chromium" ? "desktop" : "mobile";
  const pendingId = `qa-rating-cancel-${suffix}`;
  const staleId = `qa-rating-legacy-${suffix}`;
  const exhaustedId = `qa-rating-exhausted-${suffix}`;
  const localD1 = (sql: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { encoding: "utf8" });
  const ids = `'${pendingId}','${staleId}','${exhaustedId}'`;
  localD1(`DELETE FROM rating_recompute_jobs WHERE id IN (${ids}); DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';
    INSERT INTO rating_recompute_jobs (id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at) VALUES
    ('${pendingId}','sample-place-6','rating-config-v2','PLACE','PENDING','UI_CANCEL_FIXTURE',0,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z'),
    ('${staleId}','sample-place-5','rating-config-v2','PLACE','RUNNING','UI_LEGACY_FIXTURE',1,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z'),
    ('${exhaustedId}','sample-place-4','rating-config-v2','PLACE','FAILED','UI_LIMIT_FIXTURE',3,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z');`);
  try {
    await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
    await page.goto("/admin/ratings");
    const pending = page.getByRole("article", { name: `재계산 작업 ${pendingId}`, exact: true });
    const legacy = page.getByRole("article", { name: `재계산 작업 ${staleId}`, exact: true });
    const exhausted = page.getByRole("article", { name: `재계산 작업 ${exhaustedId}`, exact: true });
    await expect(legacy).toContainText("실행 상태 미확인 (RUNNING)");
    await expect(legacy).not.toContainText("실행 중");
    await expect(legacy).toContainText("이전 실행의 소유권을 확인할 수 없어 자동 재실행할 수 없습니다.");
    await expect(legacy.getByRole("button")).toHaveCount(0);
    await legacy.getByRole("link", { name: staleId, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`jobId=${staleId}$`));
    const selectedLegacy = page.getByRole("status");
    await expect(selectedLegacy).toContainText("실행 상태 미확인");
    await expect(selectedLegacy).toContainText("저장 상태 RUNNING");
    await expect(selectedLegacy).not.toContainText("처리 중입니다");
    await expect(exhausted).toContainText("3회");
    await expect(exhausted.getByRole("button")).toHaveCount(0);
    await pending.getByRole("textbox", { name: "작업 변경 사유" }).fill("합성 대기 작업 취소 검증");
    await pending.getByRole("button", { name: "대기 작업 취소 검토", exact: true }).click();
    const preview = page.getByRole("region", { name: "작업 변경 미리보기", exact: true });
    await expect(preview).toContainText(pendingId);
    await expect(preview).toContainText("합성 대기 작업 취소 검증");
    await expect(preview).toContainText("아직 작업을 변경하지 않았습니다.");
    await preview.screenshot({ path: testInfo.outputPath("rating-job-preview.png") });
    await preview.getByRole("button", { name: "작업 변경 확정", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/reauth\?returnTo=/);
    const returnTo = new URL(page.url()).searchParams.get("returnTo")!;
    expect(returnTo).toContain("jobOperation=");
    // The local fixture grants an assurance; production still uses the real reauthentication flow.
    const now = new Date().toISOString(), later = new Date(Date.now() + 300_000).toISOString();
    localD1(`INSERT OR REPLACE INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES('qa-admin-session','qa-admin','PASSWORD','${now}','${later}');`);
    await page.goto(returnTo);
    const resumed = page.getByRole("region", { name: "작업 변경 미리보기", exact: true });
    await expect(resumed).toContainText(pendingId);
    await expect(resumed).toContainText("합성 대기 작업 취소 검증");
    await resumed.getByRole("button", { name: "작업 변경 확정", exact: true }).click();
    await expect(page.getByRole("article", { name: `재계산 작업 ${pendingId}`, exact: true })).toContainText("CANCELLED");
    await expect(page.getByRole("article", { name: `재계산 작업 ${staleId}`, exact: true })).toContainText("RUNNING");
    await expect(page.getByRole("link", { name: "작업 변경 영수증 보기" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(browserErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("rating-job-cancelled.png"), fullPage: true });
  } finally {
    localD1(`DELETE FROM rating_recompute_jobs WHERE id IN (${ids}); DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';`);
  }
});
