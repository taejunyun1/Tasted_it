import { expect, test } from "@playwright/test";

// Uses only the local QA account and isolated D1 fixture.
test.skip(Boolean(process.env.BASE_URL), "Vote withdrawal fixture runs only against the isolated local database");
test("public vote change and withdrawal survive reload without clearing a saved place", async ({ context, page }, testInfo) => {
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  const route = "/places/sample-dongmyeong-ramen";
  const origin = new URL(testInfo.project.use.baseURL!).origin;
  // Reset only this QA account's reaction so desktop/mobile runs are independent.
  for (const form of [{ intent: "withdraw" }, { intent: "save", saved: "true" }]) {
    const response = await context.request.post(route, { form, headers: { Origin: origin } });
    expect(response.ok()).toBe(true);
  }
  await page.goto(route);
  await expect(page.getByRole("button", { name: "평가 취소", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "추천", exact: true }).click();
  await expect(page.locator(".reaction-status")).toHaveText("이곳을 추천했어요.");
  await page.getByRole("button", { name: "비추천", exact: true }).click();
  await page.getByRole("radio", { name: "메뉴", exact: true }).check();
  await page.getByRole("button", { name: "비추천 반영", exact: true }).click();
  await expect(page.locator(".reaction-status")).toHaveText("이곳을 비추천했어요.");
  await expect(page.locator(".save-control")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("before-withdraw.png"), fullPage: true });
  await page.getByRole("button", { name: "평가 취소", exact: true }).click();
  await expect(page.locator(".reaction-status")).toHaveText("아직 평가하지 않았어요.");
  await expect(page.getByRole("button", { name: "평가 취소", exact: true })).toHaveCount(0);
  await expect(page.locator(".save-control")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator(".reaction-status")).toHaveText("아직 평가하지 않았어요.");
  await expect(page.getByRole("button", { name: "추천", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "비추천", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".save-control")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("after-withdraw.png"), fullPage: true });
});
