import { expect, test } from "@playwright/test";

test("login uses verified email credentials and ignores external return targets", async ({ page }) => {
  await page.goto("/login?returnTo=https://evil.example/path");
  await expect(page.locator("form").first()).toHaveAttribute("action", "/login");
  await expect(page.getByLabel("이메일")).toBeVisible();
  await expect(page.getByLabel("비밀번호")).toBeVisible();
  await expect(page.getByRole("link", { name: "회원가입" })).toBeVisible();
  await expect(page.getByRole("link", { name: "비밀번호 재설정" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Google로 계속하기" })).toBeVisible();
  await expect(page.getByRole("link", { name: "네이버로 계속하기" })).toBeVisible();
});

test("an authenticated member skips login and logout returns to the map", async ({ context, page }, testInfo) => {
  const session = testInfo.project.name === "mobile-chromium" ? "qa-login-flow-mobile" : "qa-login-flow-desktop";
  await context.addCookies([{ name: "retaste_session", value: session, url: "http://127.0.0.1:5173" }]);

  await page.goto("/login?returnTo=/admin/place-operations?step=1");
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "메뉴", exact: true }).click();
  await expect(page.getByLabel("로그인됨 · QA 관리자")).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();
});

test("anonymous visitor is redirected from admin review", async ({ page }) => {
  await page.goto("/admin/place-operations?step=1");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fplace-operations%3Fstep%3D1$/);
});

test("a failed password login shows one public error", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("missing-user@example.test");
  await page.getByLabel("비밀번호").fill("not-the-password");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByText("이메일 또는 비밀번호가 올바르지 않습니다.")).toBeVisible();
  await expect(page.getByText("이메일 인증을 먼저 완료해 주세요.")).toHaveCount(0);
  await page.screenshot({ path: `docs/evidence/2026-08-26-login-error-${testInfo.project.name}.png` });
});
