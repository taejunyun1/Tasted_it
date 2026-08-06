import { expect, test } from "@playwright/test";

test("category journey exposes the same place in list and map", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("장소 지도")).toBeVisible();
  await page.getByRole("button", { name: /일식/ }).click();
  await page.getByRole("button", { name: /라멘/ }).first().click();
  await expect(page).toHaveURL(/category=ramen-detail/);
  await page.getByRole("link", { name: "맛집 리스트", exact: true }).last().click();
  await expect(page).toHaveURL(/\/places$/);
  await expect(page.getByRole("link", { name: /Re:Taste 샘플 라멘 동명/ }).first()).toBeVisible();
});

test("header keeps two primary links and places secondary actions in a hamburger menu", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "맛집 리스트", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "내 상태", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "메뉴" }).click();

  await expect(page.getByRole("link", { name: "로그인", exact: true })).toBeVisible();
});

test("place detail has directions and an honest sample state", async ({ page }) => {
  await page.goto("/places/sample-dongmyeong-ramen");
  await expect(page.getByRole("heading", { name: "Re:Taste 샘플 라멘 동명" })).toBeVisible();
  await expect(page.locator(".score strong")).toHaveText(/표본 수집 중 · \d+\/8|\d+%/);
  await expect(page.getByRole("link", { name: "네이버 지도에서 길찾기" })).toBeVisible();
});
