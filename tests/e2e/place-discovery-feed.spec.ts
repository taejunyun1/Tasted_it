import { expect, test } from "@playwright/test";

test("place list starts with the taste mixer and three distinct recommendation rails", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("hydrated")) hydrationErrors.push(message.text());
  });
  await page.goto("/places?bbox=126.80,35.10,127.00,35.25");

  await expect(page.getByRole("heading", { name: "오늘 뭐 먹지?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "취향과 새로운 발견" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Re:Taste 추천" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Golden Pick 취향 릴레이" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "전체 장소" })).toBeVisible();

  const headings = await page.locator("main h2").allTextContents();
  expect(headings).toEqual([
    "오늘 뭐 먹지?",
    "취향과 새로운 맛 사이",
    "취향과 새로운 발견",
    "Re:Taste 추천",
    "Golden Pick 취향 릴레이",
    "전체 장소",
  ]);

  const searchTop = await page.getByPlaceholder("장소 이름이나 주소 검색").boundingBox();
  const fullListTop = await page.getByRole("heading", { name: "전체 장소" }).boundingBox();
  expect(searchTop?.y).toBeGreaterThan(fullListTop?.y ?? 0);
  expect(hydrationErrors).toEqual([]);
});

test("taste badges rerank in place and stop at two selections", async ({ page }) => {
  await page.goto("/places?bbox=126.80,35.10,127.00,35.25");

  await page.getByRole("button", { name: "냉면" }).click();
  await expect(page.getByRole("heading", { name: "오늘은 시원하게" })).toBeVisible();
  await expect(page).toHaveURL(/\/places\?bbox=/);

  await page.getByRole("button", { name: "노포" }).click();
  await expect(page.getByRole("heading", { name: "오래된 여름의 맛" })).toBeVisible();
  await expect(page.getByRole("button", { name: "냉면" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "노포" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "매운맛" }).click();
  await expect(page.getByText("최대 2개까지 선택할 수 있어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "매운맛" })).toHaveAttribute("aria-pressed", "false");
});

test("rating cards explain the eight-vote visibility boundary", async ({ page }) => {
  await page.goto("/places?bbox=126.80,35.10,127.00,35.25");
  await expect(page.getByText(/평가 \d\/8|추천 \d+% · \d+명 평가/).first()).toBeVisible();
});
