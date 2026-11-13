import { expect, test } from "@playwright/test";

test("administrator previews identity changes, keeps session credentials private, and is asked to reauthenticate", async ({ context, page, baseURL }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  const identityResponse = await page.goto("/admin/identities?user=qa-active-reviewer");
  expect(identityResponse?.headers()["cache-control"]).toContain("no-store");
  expect(identityResponse?.headers()["vary"]).toContain("Cookie");
  await expect(page.getByRole("heading", { name: "회원 권한·세션" })).toBeVisible();
  await expect(page.getByText("현재 권한: REVIEWER")).toBeVisible();
  expect(await page.content()).not.toContain("qa-active-reviewer-session");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("identity-console.png"), fullPage: true });
  await page.getByRole("button", { name: "관리자 권한 부여 미리보기" }).click();
  await expect(page.getByRole("heading", { name: "변경 미리보기" })).toBeVisible();
  await expect(page.getByText("현재 권한: REVIEWER")).toBeVisible();
  await page.getByRole("button", { name: "변경 확정" }).click();
  await expect(page).toHaveURL(/\/admin\/reauth/);
  await expect(page.getByRole("heading", { name: "관리자 재인증" })).toBeVisible();
  await expect(page.getByRole("button", { name: "인증 코드 보내기" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("reauthentication.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});
