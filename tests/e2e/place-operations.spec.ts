import { expect, test } from "@playwright/test";

test("verified member can open the place suggestion and status pages", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/suggestions/new");
  await expect(page.getByRole("heading", { name: "새 장소 제안" })).toBeVisible();
  await expect(page.getByLabel("상호명")).toBeVisible();
  await page.goto("/me/suggestions");
  await expect(page.getByRole("heading", { name: "내 장소 제안" })).toBeVisible();
});

test("admin can inspect every place operations queue", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/admin/place-operations");
  await expect(page.getByRole("heading", { name: "장소 운영" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "회원 장소 제안" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "정보 정정·이의 제기" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "영업 상태 재검증" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "중복 장소 병합" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "최근 변경·복원" })).toBeVisible();
});

test("public correction form is accessible before authentication", async ({ page }) => {
  await page.goto("/corrections/new");
  await expect(page.getByRole("heading", { name: "장소 정보 정정·이의 제기" })).toBeVisible();
  await expect(page.getByLabel("확인 이메일")).toBeVisible();
});
