import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";
import { mobileSheetVoteFixture } from "./mobile-sheet-vote-fixture";

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

test("mobile Golden Pick rail reveals the keyboard-focused card and restores focus after dismissal", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const firstPick = mobileSheetVoteFixture(baseURL!, "golden-rail-a");
  const secondPick = mobileSheetVoteFixture(baseURL!, "golden-rail-b");
  try {
    firstPick.create({ publicEvidence: true });
    secondPick.create({ publicEvidence: true });
    await page.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
    const path = "/places?bbox=126.918,35.1495,126.922,35.1505";

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(path);
      const rail = page.getByRole("list", { name: "Golden Pick 취향 릴레이" });
      const links = rail.getByRole("link");
      await expect(links).toHaveCount(2);
      const first = links.nth(0);
      const second = links.nth(1);
      const visibleHorizontally = () => second.evaluate(link => {
        const card = link.getBoundingClientRect();
        const list = link.closest('[role="list"]')!.getBoundingClientRect();
        return card.left >= list.left - 1 && card.right <= Math.min(list.right, window.innerWidth) + 1;
      });
      await first.focus();
      await expect(first).toBeFocused();
      expect(await visibleHorizontally()).toBe(false);

      await page.keyboard.press("Tab");
      await expect(second).toBeFocused();
      await expect.poll(visibleHorizontally).toBe(true);
      await expect(second).toHaveCSS("outline-offset", "-4px");
      expect((await second.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const scrollLeft = await rail.evaluate(list => list.scrollLeft);
      expect(scrollLeft).toBeGreaterThan(0);
      const cardURL = new URL((await second.getAttribute("href"))!, baseURL);

      await page.keyboard.press("Enter");
      const sheet = page.getByRole("dialog", { name: "U05 합성 식당 상세 정보" });
      await expect(sheet.getByRole("heading", { name: "U05 합성 식당", exact: true })).toBeVisible();
      const detailURL = new URL(new URL(page.url()).searchParams.get("place")!, baseURL);
      expect(detailURL.pathname).toBe(cardURL.pathname);
      expect(detailURL.searchParams.get("sourceRail")).toBe("GOLDEN");
      expect(detailURL.searchParams.get("discoveryMode")).toBe("REVIEWER");
      expect(detailURL.searchParams.get("recommendationRequestId")).toMatch(/^[\da-f-]{36}$/i);

      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(second).toBeFocused();
      await expect.poll(visibleHorizontally).toBe(true);
      expect(await rail.evaluate(list => list.scrollLeft)).toBeCloseTo(scrollLeft, 0);
      await page.screenshot({ path: testInfo.outputPath(`golden-focus-${width}.png`) });
    }

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await desktop.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
      await desktop.goto(new URL(path, baseURL).href);
      const links = desktop.getByRole("list", { name: "Golden Pick 취향 릴레이" }).getByRole("link");
      await links.first().focus();
      await desktop.keyboard.press("Tab");
      await expect(links.nth(1)).toBeFocused();
      await expect(links.nth(1)).toBeInViewport();
      await desktop.screenshot({ path: testInfo.outputPath("golden-focus-desktop.png") });
    } finally {
      await desktop.close();
    }
  } finally {
    firstPick.cleanup();
    secondPick.cleanup();
  }
});
