import { expect, test } from "@playwright/test";

test("anonymous place actions preserve the detail return path", async ({ page }) => {
  await page.goto("/places/sample-dongmyeong-ramen");
  await page.getByRole("link", { name: "로그인하고 취향 남기기" }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fplaces%2Fsample-dongmyeong-ramen$/);
});

test("signed-in dislike reasons are keyboard-selectable single choices with 44px targets", async ({ context, page }) => {
  await context.addCookies([{
    name: "retaste_session",
    value: "qa-admin-session",
    domain: "127.0.0.1",
    path: "/",
  }]);
  await page.goto("/places/sample-dongmyeong-ramen");

  const dislike = page.getByRole("button", { name: "비추천" });
  await dislike.focus();
  await page.keyboard.press("Enter");
  const reasons = page.getByRole("group", { name: "비추천 이유를 하나 선택해 주세요" });
  await expect(reasons).toBeVisible();

  const menu = reasons.getByRole("radio", { name: "메뉴" });
  const distance = reasons.getByRole("radio", { name: "거리" });
  await menu.focus();
  await page.keyboard.press("Space");
  await expect(menu).toBeChecked();
  await distance.check();
  await expect(distance).toBeChecked();
  await expect(menu).not.toBeChecked();

  for (const option of await reasons.locator(".negative-reason-option").all()) {
    const box = await option.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
