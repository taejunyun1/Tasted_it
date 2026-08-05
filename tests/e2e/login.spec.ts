import { expect, test } from "@playwright/test";

test("login uses verified email credentials and ignores external return targets", async ({ page }) => {
  await page.goto("/login?returnTo=https://evil.example/path");
  await expect(page.getByLabel("이메일")).toBeVisible();
  await expect(page.getByLabel("비밀번호")).toBeVisible();
  await expect(page.getByRole("link", { name: "회원가입" })).toBeVisible();
  await expect(page.getByRole("link", { name: "비밀번호 재설정" })).toBeVisible();
});

test("anonymous visitor is redirected from admin review", async ({ page }) => {
  await page.goto("/admin/candidates");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fcandidates$/);
});
