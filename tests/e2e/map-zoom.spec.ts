import { expect, test } from "@playwright/test";

test("map keeps its zoom level while bounds refresh the place list", async ({ page }) => {
  await page.goto(`/?qa=${Date.now()}-${Math.random()}`);
  const zoomIn = page.getByRole("link", { name: "지도 확대", exact: true });
  await expect(zoomIn).toBeVisible();
  const initialBounds = new URL(page.url()).searchParams.get("bbox");

  await zoomIn.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("bbox"))
    .not.toBe(initialBounds);
  const firstBounds = new URL(page.url()).searchParams.get("bbox");

  await page.getByRole("link", { name: "지도 확대", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("bbox"))
    .not.toBe(firstBounds);
  await expect.poll(async () => Number(await page.locator(".map-result-head strong").textContent()))
    .toBe(await page.getByRole("button", { name: /선택$/ }).count());
});

test("manual zoom out persists after selecting a filtered place", async ({ page }) => {
  await page.goto(`/?qa=${Date.now()}-${Math.random()}`);
  const map = page.getByLabel("장소 지도");

  await page.getByRole("button", { name: "🍚 한식" }).click();
  const category = page.getByLabel("세부 카테고리").getByRole("button").first();
  await category.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("category")).toBeTruthy();

  await page.getByRole("button", { name: /선택$/ }).first().click();
  await expect(map).toHaveAttribute("data-map-zoom", "16");
  await page.waitForTimeout(1_700);

  const focusedBounds = new URL(page.url()).searchParams.get("bbox");
  await page.getByRole("link", { name: "지도 축소", exact: true }).click();
  await expect(map).toHaveAttribute("data-map-zoom", "15");
  await expect.poll(() => new URL(page.url()).searchParams.get("bbox"))
    .not.toBe(focusedBounds);

  const zoomedOutBounds = new URL(page.url()).searchParams.get("bbox");
  await page.waitForTimeout(1_000);
  await expect(map).toHaveAttribute("data-map-zoom", "15");
  expect(new URL(page.url()).searchParams.get("bbox")).toBe(zoomedOutBounds);
});

test("district and neighborhood clusters drill down to individual place pins", async ({ page }) => {
  await page.goto(`/?qa=${Date.now()}-${Math.random()}`);
  const map = page.getByLabel("장소 지도");
  const district = map.getByRole("button", { name: /음식점 \d+곳, 확대해서 보기$/ }).first();
  await expect(district).toBeVisible();
  const initialBounds = new URL(page.url()).searchParams.get("bbox");

  await district.click();

  await expect(map).toHaveAttribute("data-map-zoom", "13");
  await expect.poll(() => new URL(page.url()).searchParams.get("bbox")).not.toBe(initialBounds);
  const neighborhood = map.getByRole("button", { name: /음식점 \d+곳, 확대해서 보기$/ }).first();
  await expect(neighborhood).toBeVisible();
  const districtBounds = new URL(page.url()).searchParams.get("bbox");

  await neighborhood.click();

  await expect(map).toHaveAttribute("data-map-zoom", "15");
  await expect.poll(() => new URL(page.url()).searchParams.get("bbox")).not.toBe(districtBounds);
  await expect(map.getByRole("button", { name: /지도 핀$/ }).first()).toBeVisible();
});
