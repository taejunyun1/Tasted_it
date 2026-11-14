import { expect, test } from "@playwright/test";

test("reviewer preview separates evidence and asks for reauthentication before changing a batch", async ({ page, context, baseURL }, testInfo) => {
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  const response = await page.goto("/admin/reviewers?status=APPLIED");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading", { name: "리뷰어 관리", exact: true })).toBeVisible();
  await page.waitForFunction(() => (window as unknown as { __reactRouterDataRouter?: { state: { initialized: boolean; navigation: { state: string } } } }).__reactRouterDataRouter?.state.navigation.state === "idle");
  await page.getByRole("checkbox", { name: "QA 심사 대기자 신청 선택" }).check();
  await page.getByRole("button", { name: "선택 신청 미리보기" }).click();
  await expect(page.getByRole("heading", { name: "변경 미리보기" })).toBeVisible();
  await expect(page.getByText("신청 당시 0 / 미리보기 당시 현재 0", { exact: false })).toBeVisible();
  await expect(page.getByText(/철회·반려된 방문 기록이나 사진/)).toBeVisible();
  await page.getByRole("heading", { name: "변경 미리보기" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("reviewer-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "선택한 변경 확정" }).click();
  await expect(page.getByRole("heading", { name: "관리자 재인증" })).toBeVisible();
});
