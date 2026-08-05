import { expect, test } from "@playwright/test";

test("map keeps its zoom level while bounds refresh the place list", async ({ page }) => {
  await page.goto("/");
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
