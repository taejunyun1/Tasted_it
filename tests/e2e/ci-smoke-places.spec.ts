import { expect, test } from "@playwright/test";

test("home five-slot and a published place load", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "지금 갈 만한 5곳" })).toBeVisible();
  await page.goto("/places/sample-dongmyeong-ramen");
  await expect(page.getByRole("heading", { name: "Re:Taste 샘플 라멘 동명" })).toBeVisible();
});
