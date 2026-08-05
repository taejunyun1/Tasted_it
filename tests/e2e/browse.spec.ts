import { expect, test } from "@playwright/test";

test("category journey exposes the same place in list and map", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("장소 지도")).toBeVisible();
  await page.getByRole("button", { name: /일식/ }).click();
  await page.getByRole("button", { name: /라멘/ }).first().click();
  await expect(page).toHaveURL(/category=ramen-detail/);
  await page.getByRole("link", { name: "장소 목록", exact: true }).last().click();
  await expect(page).toHaveURL(/\/places\?.*category=ramen-detail/);
  await expect(page.getByRole("link", { name: /Re:Taste 샘플 라멘 동명/ })).toBeVisible();
});

test("place detail has directions and an honest sample state", async ({ page }) => {
  await page.goto("/places/sample-dongmyeong-ramen");
  await expect(page.getByRole("heading", { name: "Re:Taste 샘플 라멘 동명" })).toBeVisible();
  await expect(page.locator(".score strong")).toHaveText(/평가 수 부족|\d+%/);
  await expect(page.getByRole("link", { name: "네이버 지도에서 길찾기" })).toBeVisible();
});
