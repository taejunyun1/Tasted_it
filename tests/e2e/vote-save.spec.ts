import { expect, test } from "@playwright/test";

test("anonymous place actions preserve the detail return path", async ({ page }) => {
  await page.goto("/places/sample-dongmyeong-ramen");
  await page.getByRole("link", { name: "로그인하고 취향 남기기" }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fplaces%2Fsample-dongmyeong-ramen$/);
});
