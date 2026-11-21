import { expect, test } from "@playwright/test";

test("ADMIN compares synthetic rating policy without activating it", async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "Requires isolated local fixture only");
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/admin/rating-config");
  await expect(page.getByRole("heading", { name: "평가 설정 비교", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "실효값과 저장값 비교" })).toContainText("리뷰어 신뢰 비교");
  await page.getByRole("spinbutton", { name: "일반 긍정", exact: true }).fill("7");
  await page.getByRole("spinbutton", { name: "일반 부정", exact: true }).fill("0");
  await page.getByRole("spinbutton", { name: "리뷰어 긍정", exact: true }).fill("0");
  await page.getByRole("spinbutton", { name: "최소 공개 표본", exact: true }).fill("7");
  await page.getByRole("button", { name: "합성 표본 비교", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("표시 기준 변경 있음");
  await expect(page.getByRole("region", { name: "합성 비교 결과" })).toContainText("표본 부족");
  await expect(page.getByText("실제 설정·점수·표·재계산 작업은 변경하지 않았습니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /활성화|복원/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("rating-config-comparison.png"), fullPage: true });
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 320, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("rating-config-320.png"), fullPage: true });
  }
  expect(errors).toEqual([]);
});
