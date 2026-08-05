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
