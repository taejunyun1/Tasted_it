import { expect, test } from "@playwright/test";

test("place detail explains the eight-vote threshold and rating groups", async ({ page }) => {
  await page.goto("/places/sample-dongmyeong-ramen");
  await expect(page.getByText("표본 수집 중 · 0/8")).toBeVisible();
  await expect(page.getByRole("heading", { name: "평가 구성" })).toBeVisible();
  await expect(page.getByText("일반 회원")).toBeVisible();
  await expect(page.getByText("리뷰어", { exact: true })).toBeVisible();
});

test("active reviewer can open the rating workspace", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-active-reviewer-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/reviewer/ratings");
  await expect(page.getByRole("heading", { name: "리뷰어 평가" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Re:Taste 샘플 라멘 동명" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Flavor Print 저장" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Golden Pick 부여" }).first()).toBeVisible();
});
