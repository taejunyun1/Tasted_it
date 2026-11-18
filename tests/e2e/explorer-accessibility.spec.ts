import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses the isolated local discovery fixture");

for (const width of [390, 768]) {
  test(`discovery lists and selected category controls stay accessible at ${width}px`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
    await page.goto("/places");
    const rail = page.locator(".discovery-rail").first();
    await expect(rail).toHaveAttribute("role", "list");
    const items = rail.getByRole("listitem");
    expect(await items.count()).toBeGreaterThan(1);
    const first = items.nth(0).getByRole("link").first();
    const second = items.nth(1).getByRole("link").first();
    await first.focus();
    await page.keyboard.press("Tab");
    await expect(second).toBeFocused();
    await expect(second).toBeInViewport();

    await page.goto("/?qa=1&view=browse");
    if (width <= 760) await page.getByRole("button", { name: "목록", exact: true }).click();
    const categories = page.getByRole("group", { name: "대표 카테고리", exact: true });
    const all = categories.getByRole("button", { name: "전체", exact: true });
    const japanese = categories.getByRole("button").filter({ hasText: "일식" });
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(japanese).toHaveAttribute("aria-pressed", "false");
    await japanese.click();
    await expect(japanese).toHaveAttribute("aria-expanded", "true");
    await expect(japanese).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("group", { name: "세부 카테고리", exact: true }).getByRole("button", { name: /^라멘,/ }).click();
    await expect(japanese).toHaveAttribute("aria-pressed", "true");
    await expect(all).toHaveAttribute("aria-pressed", "false");
    for (const control of await page.locator(".site-head .brand, .site-head__primary a, .map-category-groups button").all()) {
      if (await control.isVisible()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `docs/evidence/2026-11-18-explorer-accessibility-${width}.png` });
  });
}
