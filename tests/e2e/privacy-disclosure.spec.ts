import { expect, test } from "@playwright/test";

test("guest data disclosure stays publicly readable and clearly marked as a review draft", async ({ page }, testInfo) => {
  await page.goto("/privacy");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Re:Taste 개인정보 처리방침", exact: true })).toBeVisible();
  await expect(main.locator(".legal-notice")).toContainText("출시 전 검토본");
  await expect(main.locator(".legal-notice")).toContainText("실제 운영자 연락처");
  await expect(main.getByRole("heading", { name: "2. 보유기간", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "/me", exact: true })).toHaveAttribute("href", "/me");
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  await page.screenshot({ path: `docs/evidence/privacy-guest-facts-20261113/${testInfo.project.name}.png`, fullPage: true });
});
