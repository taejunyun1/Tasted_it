import { expect, test } from "@playwright/test";

test("category journey exposes the same place in list and map", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /오늘의 한 끼/ })).toBeVisible();
  await page.getByRole("link", { name: /라멘/ }).first().click();

  await expect(page).toHaveURL(/\/maps\/ramen/);
  await expect(page.getByLabel("Re:Taste 샘플 라멘 동명 지도 핀")).toBeAttached();
  await page.getByRole("link", { name: "목록" }).click();
  await expect(page.getByRole("link", { name: /Re:Taste 샘플 라멘 동명/ })).toBeVisible();
});

test("place detail has directions and an honest sample state", async ({ page }) => {
  await page.goto("/places/sample-dongmyeong-ramen");
  await expect(page.getByRole("heading", { name: "Re:Taste 샘플 라멘 동명" })).toBeVisible();
  await expect(page.getByText("평가 수 부족")).toBeVisible();
  await expect(page.getByRole("link", { name: "카카오맵 길찾기" })).toBeVisible();
});
