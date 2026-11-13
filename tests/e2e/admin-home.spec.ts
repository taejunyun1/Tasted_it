import { expect, test } from "@playwright/test";

test("admin home shows bounded summaries and filters real management links", async ({ page }, testInfo) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  await expect(page.getByRole("heading", { name: "운영 홈", level: 1, exact: true })).toBeVisible();
  await expect(page.getByText("집계 조회 완료", { exact: true })).toBeVisible();
  await expect(page.locator(".admin-control")).toHaveCount(34);
  await expect(page.getByText("관리 화면 없음", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const screenshotPath = testInfo.outputPath("admin-home.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach("admin-home", { path: screenshotPath, contentType: "image/png" });
  await page.getByLabel("분야", { exact: true }).selectOption("review");
  await page.getByRole("button", { name: "보기", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?area=review$/);
  await expect(page.locator(".admin-control")).toHaveCount(4);
  await page.getByRole("link", { name: "평가 설정 열기" }).click();
  await expect(page.getByRole("heading", { name: "평가 운영", exact: true })).toBeVisible();
});

test("member cannot read admin home", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(403);
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  await expect(page.getByRole("heading", { name: "운영 홈", exact: true })).toHaveCount(0);
});
