import { expect, test } from "@playwright/test";

test("place list starts with discovery rails before search and the full list", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("hydrated")) hydrationErrors.push(message.text());
  });
  await page.goto("/places?bbox=126.80,35.10,127.00,35.25");

  await expect(page.getByRole("heading", { name: "내 주변 추천" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Re:Taste 추천" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "최근 Golden Pick" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "전체 장소" })).toBeVisible();

  const headings = await page.locator("main h2").allTextContents();
  expect(headings.slice(0, 4)).toEqual(["내 주변 추천", "Re:Taste 추천", "최근 Golden Pick", "전체 장소"]);

  const searchTop = await page.getByPlaceholder("장소 이름이나 주소 검색").boundingBox();
  const fullListTop = await page.getByRole("heading", { name: "전체 장소" }).boundingBox();
  expect(searchTop?.y).toBeGreaterThan(fullListTop?.y ?? 0);
  expect(hydrationErrors).toEqual([]);
});

test("rating cards explain the eight-vote visibility boundary", async ({ page }) => {
  await page.goto("/places?bbox=126.80,35.10,127.00,35.25");
  await expect(page.getByText(/평가 \d\/8|추천 \d+% · \d+명 평가/).first()).toBeVisible();
});
