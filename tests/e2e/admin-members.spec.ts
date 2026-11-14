import { expect, test } from "@playwright/test";

test("member access preview keeps private fields masked and requires reauthentication", async ({ context, page, baseURL }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  const response = await page.goto("/admin/members?q=qa-reviewer-member&user=qa-reviewer-member&saved=1");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["vary"]).toContain("Cookie");
  await expect(page.getByRole("heading", { name: "회원 관리", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "QA 리뷰어 신청자", exact: true })).toBeVisible();
  await expect(page.getByText("현재 1명 · 최대 50명")).toBeVisible();
  await expect(page.getByText("확정 영수증을 확인했습니다.", { exact: false })).toHaveCount(0);
  expect(await page.content()).not.toContain("qa-reviewer-member@retaste.local");
  expect(await page.content()).not.toContain("qa-reviewer-member-session");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: testInfo.outputPath("member-console.png"), fullPage: true });

  const denied = await context.request.post("/admin/members", {
    headers: { Origin: "https://outside.invalid" },
    form: { intent: "prepare", targetUserId: "qa-reviewer-member", action: "RESTRICT", reason: "합성 계정 검증", durationDays: "1" },
    maxRedirects: 0,
  });
  // React Router rejects cross-origin document actions before the route's 403 guard.
  expect(denied.status()).toBe(400);
  expect(denied.headers()["cache-control"]).toContain("no-store");

  await page.getByRole("combobox", { name: "제한 기간", exact: true }).selectOption("1");
  await page.getByRole("textbox", { name: "변경 사유", exact: true }).fill("합성 계정 접근 제한 미리보기 검증");
  await page.getByRole("button", { name: "제한 미리보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "변경 미리보기", exact: true })).toBeVisible();
  await expect(page.getByText("합성 계정 접근 제한 미리보기 검증", { exact: true })).toBeVisible();
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: testInfo.outputPath("member-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "변경 확정", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/reauth\?returnTo=/);
  await expect(page.getByRole("heading", { name: "관리자 재인증", exact: true })).toBeVisible();
  expect(decodeURIComponent(page.url())).toContain("operation=");
  expect(errors).toEqual([]);
});
