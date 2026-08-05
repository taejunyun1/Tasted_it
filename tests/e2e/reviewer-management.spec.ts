import { expect, test } from "@playwright/test";

function baseURL(testInfo: Parameters<Parameters<typeof test.beforeEach>[0]>[1]) {
  return String(testInfo.project.use.baseURL ?? "http://127.0.0.1:5173");
}

test("member sees reviewer requirements and application fields", async ({ context, page }, testInfo) => {
  await context.addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", url: baseURL(testInfo) }]);
  await page.goto("/reviewer/apply");
  await expect(page.getByRole("heading", { name: "리뷰어 신청" })).toBeVisible();
  await expect(page.getByText("0 / 10곳")).toBeVisible();
  await expect(page.getByLabel("맛집 선정 기준 의견서")).toBeVisible();
  await expect(page.getByText("전문 카테고리")).toBeVisible();
});

test("admin sees applications and reviewer state actions", async ({ context, page }, testInfo) => {
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL(testInfo) }]);
  await page.goto("/admin/reviewers");
  await expect(page.getByRole("heading", { name: "리뷰어 관리" })).toBeVisible();
  await expect(page.getByText("QA 심사 대기자")).toBeVisible();
  await expect(page.getByRole("button", { name: "예외 승인" })).toBeVisible();
  await expect(page.getByRole("button", { name: "휴면 대상 반영" })).toBeVisible();
});

test("public reviewer profile is visible unless suspended", async ({ page }) => {
  await page.goto("/reviewers/qa-gukmul-reviewer");
  await expect(page.getByRole("heading", { name: "QA 국물 기록자" })).toBeVisible();
  await expect(page.getByText("국물 요리와 노포를 오래 관찰합니다.")).toBeVisible();
  await page.goto("/reviewers/qa-suspended");
  await expect(page.getByText("이 페이지는 지도 밖에 있어요.")).toBeVisible();
});
