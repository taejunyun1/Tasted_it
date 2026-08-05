import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL ?? "http://127.0.0.1:5173");
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL }]);
});

test("admin reviews automatic, manual, and blocked candidates in one list", async ({ page }) => {
  await page.goto("/admin/candidates");

  await expect(page.getByRole("heading", { name: "장소 검수 목록" })).toBeVisible();
  await expect(page.getByRole("link", { name: "전체" })).toBeVisible();
  await expect(page.getByRole("link", { name: "자동 승인" })).toBeVisible();
  await expect(page.getByRole("link", { name: "수동 확인" })).toBeVisible();
  await expect(page.getByRole("link", { name: "승인 불가" })).toBeVisible();
  await expect(page.getByLabel("후보 네이버 지도")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "동네" })).toHaveCount(0);

  await expect(page.getByRole("checkbox", { name: /QA 양평해장국/ })).toBeEnabled();
  await expect(page.getByLabel("QA 스시하루 대표 카테고리")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /QA 카페봄/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Re:Taste 샘플 라멘 동명/ })).toBeDisabled();
  await expect(page.getByText("기존 공개 장소와 중복")).toBeVisible();
  await expect(page.getByText("QA 폐업국밥")).toHaveCount(0);
});

test("legacy bulk URL redirects to the unified review list", async ({ page }) => {
  await page.goto("/admin/candidates/bulk");
  await expect(page).toHaveURL(/\/admin\/candidates$/);
  await expect(page.getByRole("heading", { name: "장소 검수 목록" })).toBeVisible();
});
