import { expect, test } from "@playwright/test";

test("admin can filter place liveness operations without exposing raw evidence", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/admin/place-operations");

  await expect(page.getByRole("heading", { name: "영업 상태 재검증" })).toBeVisible();
  await expect(page.getByLabel("영업 상태 필터")).toBeVisible();
  await expect(page.getByRole("button", { name: "자동 추천 제외 전체 해제" })).toBeVisible();
  await expect(page.getByLabel("영업 상태 필터")).toHaveValue("");
  await expect.poll(() => page.locator(".liveness-toolbar").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.getByLabel("영업 상태 필터").selectOption("ERROR");
  await page.getByRole("button", { name: "적용" }).click();
  await expect(page).toHaveURL(/liveness=ERROR/);
  await expect(page.getByLabel("영업 상태 필터")).toHaveValue("ERROR");
  await expect(page.locator(".liveness-card code")).toHaveCount(0);
});

test("member cannot open place liveness operations", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  const response = await page.goto("/admin/place-operations");
  expect(response?.status()).toBe(403);
});
