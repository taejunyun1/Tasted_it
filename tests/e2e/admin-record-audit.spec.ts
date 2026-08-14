import { expect, test } from "@playwright/test";

test("ADMIN만 마스킹된 통합 기록 감사 화면을 볼 수 있다", async ({ page }) => {
  await page.context().addCookies([{
    name: "retaste_session",
    value: "qa-admin-session",
    domain: "127.0.0.1",
    path: "/",
  }]);

  await page.goto("/admin/audit");

  await expect(page.getByRole("heading", { name: "통합 기록 감사" })).toBeVisible();
  await expect(page.getByText("읽기 전용 기준선입니다.")).toBeVisible();
  await expect(page.getByText(/must-not-appear@example\.com/)).toHaveCount(0);
});

test("일반 회원은 통합 기록 감사 화면에 접근할 수 없다", async ({ page }) => {
  await page.context().addCookies([{
    name: "retaste_session",
    value: "qa-reviewer-member-session",
    domain: "127.0.0.1",
    path: "/",
  }]);

  const response = await page.goto("/admin/audit");
  expect(response?.status()).toBe(403);
});
