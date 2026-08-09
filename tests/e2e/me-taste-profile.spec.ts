import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
});

test("profile leads with a natural taste headline and varied taste badges", async ({ page }) => {
  await page.goto("/me");

  await expect(page.getByRole("heading", { level: 1, name: "떡볶이와 국밥을 좋아하는 QA 관리자" })).toBeVisible();
  await expect(page.getByRole("list", { name: "대표 취향" })).toBeVisible();
  await expect(page.locator('.member-taste-badges [data-category="FOOD"]')).toHaveCount(2);
  await expect(page.locator('.member-taste-badges [data-category="TASTE"]')).toHaveCount(1);
  await expect(page.locator('.member-taste-badges [data-category="STYLE"]')).toHaveCount(2);
  await expect(page.locator(".member-taste-badges [data-primary]")).toHaveText("떡볶이러");
});

test("external identities stay as small status badges after the taste log", async ({ page }) => {
  await page.goto("/me");

  const activity = page.getByRole("heading", { level: 2, name: "내가 남긴 맛의 기록" });
  const connections = page.getByLabel("외부 서비스 연결 상태");
  await expect(connections).toContainText("N 네이버 미연결");
  await expect(connections).toContainText("G Google 미연결");
  const activityBox = await activity.boundingBox();
  const connectionBox = await connections.boundingBox();
  expect(activityBox).not.toBeNull();
  expect(connectionBox).not.toBeNull();
  expect(connectionBox!.y).toBeGreaterThan(activityBox!.y);
});
