import { expect, test } from "@playwright/test";

test("public legal documents are reachable without signing in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "개인정보 처리방침" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "Re:Taste 개인정보 처리방침" })).toBeVisible();

  await page.getByRole("link", { name: "이용약관" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { name: "Re:Taste 이용약관" })).toBeVisible();
});

test("login exposes both legal documents", async ({ page }) => {
  await page.goto("/login");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "개인정보 처리방침" })).toBeVisible();
  await expect(main.getByRole("link", { name: "이용약관" })).toBeVisible();
});
