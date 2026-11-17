import { expect, test } from "@playwright/test";

test("email control shows disabled deployment safely on desktop and mobile", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 500) errors.push(`HTTP ${response.status()}`); });
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  const response = await page.goto("/admin/operations/email-domain");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading", { name: "메일 도메인", exact: true })).toBeVisible();
  await expect(page.getByText("배포 설정이 없어 작업이 잠겨 있습니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "상태 새로 조회" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "요청 확정" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("email-domain.png"), fullPage: true });
  if (testInfo.project.name === "chromium") {
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("email-domain-320.png"), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("email control denies member access", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  const response = await page.goto("/admin/operations/email-domain");
  expect(response?.status()).toBe(403);
});
