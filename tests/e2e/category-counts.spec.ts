import { expect, test } from "@playwright/test";

const outside = "127.1,35.1,127.2,35.2";

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/[^/]*(?:naver\.com|naver\.net|pstatic\.net)\//, (route) => route.abort());
});

test("browse category shows zero here and the actual overall count without automatically moving the map", async ({ page }, testInfo) => {
  await page.goto(`/?qa=1&view=browse&category=ramen-detail&q=라멘&bbox=${outside}`);
  if (testInfo.project.name.includes("mobile")) await page.locator(".map-mobile-tabs").getByRole("button", { name: "목록", exact: true }).click();
  await expect(page.getByRole("button", { name: "라멘, 현재 범위 0곳, 전체 검색 결과 2곳" })).toBeVisible();
  await expect(page.locator(".map-result-head strong")).toHaveText("0");
  expect(new URL(page.url()).searchParams.get("bbox")).toBe(outside);
  await page.getByRole("button", { name: "전체 결과 2곳 보기" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "전체 결과 2곳 보기" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("browse-zero-count.png"), fullPage: true });
  await page.getByRole("button", { name: "전체 결과 2곳 보기" }).click();
  await expect(page.locator(".map-result-head strong")).toHaveText("2");
  await expect(page.getByRole("button", { name: "라멘, 현재 범위 2곳, 전체 검색 결과 2곳" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe("라멘");
  expect(new URL(page.url()).searchParams.get("category")).toBe("ramen-detail");
});

test("category result expansion preserves query, list view and selected place", async ({ page }, testInfo) => {
  await page.goto(`/maps/ramen-detail?q=라멘&view=list&selected=sample-place-1&bbox=${outside}`);
  await expect(page.locator(".result-count")).toHaveText("0 PLACES");
  expect(new URL(page.url()).searchParams.get("bbox")).toBe(outside);
  await page.getByRole("button", { name: "전체 결과 2곳 보기" }).click();
  await expect(page.locator(".result-count")).toHaveText("2 PLACES");
  await expect(page.locator(".result-panel .place-card")).toHaveCount(2);
  const search = new URL(page.url()).searchParams;
  expect(search.get("q")).toBe("라멘");
  expect(search.get("view")).toBe("list");
  expect(search.get("selected")).toBe("sample-place-1");
  await page.screenshot({ path: testInfo.outputPath("category-expanded-count.png"), fullPage: true });
});
