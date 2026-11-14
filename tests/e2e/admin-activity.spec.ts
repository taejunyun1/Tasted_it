import { expect, test } from "@playwright/test";

test("administrator follows the activity link and reads a pending receipt without executing it", async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  await page.goto("/admin/ratings");
  await page.getByRole("button", { name: "선택 장소 재계산", exact: true }).click();
  await expect(page.getByRole("heading", { name: "재계산 실행 확인" })).toBeVisible();
  const operationId = await page.locator('input[name="operationId"]').first().inputValue();
  await page.goto("/admin?area=privacy");
  await page.waitForFunction(() => {
    const router = (window as unknown as { __reactRouterDataRouter?: { state: { initialized: boolean; navigation: { state: string } } } }).__reactRouterDataRouter;
    return router?.state.initialized && router.state.navigation.state === "idle";
  });
  await page.getByRole("link", { name: "관리자 감사 열기" }).click();
  await expect(page.getByRole("heading", { name: "관리자 작업 이력", level: 1 })).toBeVisible();
  const response = await page.goto(`/admin/activity?view=operations&kind=RATING_RECOMPUTE&operation=${operationId}`);
  expect(response?.headers()["cache-control"].split(",").map((value) => value.trim())).toEqual(expect.arrayContaining(["private", "no-store"]));
  const detail = page.getByRole("region", { name: "선택한 작업 영수증" });
  await expect(detail.getByText("미확정", { exact: true })).toBeVisible();
  await expect(detail.getByText(operationId, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /확정|재계산/ })).toHaveCount(0);
  expect(await page.content()).not.toContain("qa-admin-session");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-activity.png"), fullPage: true });
  await page.getByRole("link", { name: "원장 정합성 검사" }).click();
  await expect(page.getByRole("heading", { name: "통합 기록 감사" })).toBeVisible();
  expect(errors).toEqual([]);
});
