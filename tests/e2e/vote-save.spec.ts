import { expect, test } from "@playwright/test";

test("signed-in user changes a vote and keeps a saved place after reload", async ({ page }) => {
  await page.goto("/login?returnTo=/places/sample-dongmyeong-ramen");
  await page.getByLabel("이메일").fill(`vote-save-${Date.now()}@example.com`);
  await page.getByLabel("표시 이름").fill("취향 테스트");
  await page.getByRole("button", { name: "베타 로그인" }).click();

  await page.getByRole("button", { name: "추천", exact: true }).click();
  await expect(page.getByRole("button", { name: "추천", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "비추천", exact: true }).click();
  await expect(page.getByRole("button", { name: "비추천", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("button", { name: "저장됨" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.getByRole("button", { name: "비추천", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "저장됨" })).toHaveAttribute("aria-pressed", "true");
});
