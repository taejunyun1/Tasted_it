import { expect, test } from "@playwright/test";

test("a map pin opens place information in the explorer panel", async ({ page }) => {
  await page.goto("/");
  const pin = page.getByRole("button", { name: /지도 핀$/ }).first();
  await expect(pin).toBeVisible();
  const placeName = (await pin.getAttribute("aria-label"))?.replace(/ 지도 핀$/, "");

  await pin.click();

  await expect(page).toHaveURL(/selected=/);
  await expect(page.getByRole("button", { name: "목록으로" })).toBeVisible();
  await expect(page.getByRole("heading", { name: placeName })).toBeVisible();
  await expect(page.getByRole("link", { name: "상세 보기" })).toBeVisible();
});

test("a list item opens the same detail and returning preserves filters", async ({ page }) => {
  await page.goto("/?q=국밥");
  const result = page.getByRole("button", { name: /선택$/ }).first();
  await expect(result).toBeVisible();

  await result.click();
  await expect(page).toHaveURL(/selected=/);
  await page.getByRole("button", { name: "목록으로" }).click();

  await expect(page).toHaveURL(/q=/);
  await expect(page).not.toHaveURL(/selected=/);
  await expect(result).toBeVisible();
});

test("an unavailable selected place returns to the list", async ({ page }) => {
  await page.goto("/?selected=missing-place");

  await expect(page).not.toHaveURL(/selected=/);
  await expect(page.getByRole("complementary", { name: "장소 탐색" })).toBeVisible();
});

test("search input follows URL history", async ({ page }) => {
  await page.goto("/?q=국밥");
  const search = page.getByLabel("장소 검색");
  await expect(search).toHaveValue("국밥");

  await page.evaluate(() => {
    history.pushState(null, "", "/?q=라멘");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(search).toHaveValue("라멘");

  await page.goBack();

  await expect(search).toHaveValue("국밥");
});

test("category controls follow URL history", async ({ page }) => {
  await page.goto("/?category=gukbap-detail");
  await expect(page.getByRole("button", { name: /한식/ })).toHaveAttribute("aria-expanded", "true");

  await page.evaluate(() => {
    history.pushState(null, "", "/?category=ramen-detail");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(page.getByRole("button", { name: /일식/ })).toHaveAttribute("aria-expanded", "true");
  await page.goBack();
  await expect(page.getByRole("button", { name: /한식/ })).toHaveAttribute("aria-expanded", "true");
});

test("mobile starts with the map panel collapsed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto("/");

  await expect(page.getByRole("button", { name: "지도" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "목록" })).toHaveAttribute("aria-pressed", "false");
});
