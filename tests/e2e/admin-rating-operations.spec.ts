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
