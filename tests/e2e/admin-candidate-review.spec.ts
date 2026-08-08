import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL ?? "http://127.0.0.1:5173");
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL }]);
});

test("admin reviews automatic, manual, and blocked candidates in one list", async ({ page }) => {
  await page.goto("/admin/candidates");

  await expect(page.getByRole("heading", { name: "장소 검수 목록" })).toBeVisible();
  await expect(page.getByRole("link", { name: "리뷰어 관리" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다음 10곳 AI 분류" })).toHaveCount(0);
  await expect(page.getByLabel("AI 일일 사용량")).toContainText("앱 집계 기준");
  await expect(page.getByRole("link", { name: "운영 현황" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "전체" })).toBeVisible();
  await expect(page.getByRole("link", { name: "분류 완료" })).toBeVisible();
  await expect(page.getByRole("link", { name: "수동 확인" })).toBeVisible();
  await expect(page.getByRole("link", { name: "승인 불가" })).toBeVisible();
  await expect(page.getByRole("link", { name: "체인점 제외" })).toBeVisible();
  await expect(page.getByLabel("후보 네이버 지도")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "동네" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "상단 페이지 이동" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "하단 페이지 이동" })).toBeVisible();

  await expect(page.getByRole("checkbox", { name: /QA 양평해장국/ })).toBeEnabled();
  await page.getByRole("button", { name: "현재 페이지 선택" }).click();
  await expect(page.locator("p").filter({ hasText: "선택 · 차단 후보 제외" })).toBeVisible();
  await page.getByRole("button", { name: "현재 페이지 선택 해제" }).click();
  await page.getByRole("checkbox", { name: /QA 양평해장국/ }).check();
  await expect(page.getByRole("button", { name: "선택 장소 다시 분류" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "선택 장소 승인·공개" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "선택 반려" })).toHaveCount(0);
  await expect(page.getByLabel("QA 스시하루 대표 카테고리")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /QA 카페봄/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Re:Taste 샘플 라멘 동명/ })).toBeDisabled();
  await expect(page.getByText("기존 공개 장소와 중복")).toBeVisible();
  await expect(page.getByText("QA 폐업국밥")).toHaveCount(0);
});

test("admin inspects chain exclusions without review controls", async ({ page }) => {
  await page.goto("/admin/candidates?state=EXCLUDED");

  await expect(page.getByRole("link", { name: "체인점 제외" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "파리바게뜨 QA점" })).toBeVisible();
  await expect(page.getByText("체인점 자동 제외")).toBeVisible();
  await expect(page.getByText("파리바게뜨", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "검수 대기로 복원" })).toBeVisible();
  await expect(page.getByRole("button", { name: "선택 장소 다시 분류" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "선택 장소 승인·공개" })).toHaveCount(0);
});

test("admin inspects operational metrics and alerts", async ({ page }) => {
  await page.goto("/admin/operations");
  await expect(page.getByRole("heading", { name: "운영 현황" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "24시간" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "7일" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "30일" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "열린 운영 알림" })).toBeVisible();
});

test("legacy bulk URL redirects to the unified review list", async ({ page }) => {
  await page.goto("/admin/candidates/bulk");
  await expect(page).toHaveURL(/\/admin\/candidates$/);
  await expect(page.getByRole("heading", { name: "장소 검수 목록" })).toBeVisible();
});
