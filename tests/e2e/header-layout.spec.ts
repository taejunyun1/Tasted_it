import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test.skip(Boolean(process.env.BASE_URL), "Uses only isolated local header fixtures");

async function bounds(locator: Locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = [rect.x + 1, rect.x + rect.width / 2, rect.right - 1].every(x => {
      const target = document.elementFromPoint(x, rect.y + rect.height / 2);
      return Boolean(target && element.contains(target));
    });
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, hit };
  });
}

async function tabToMenu(page: Page) {
  const reached: string[] = [];
  await page.locator(".site-head .brand").focus();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    const target = await page.evaluate(() => ({ menu: document.activeElement?.tagName === "SUMMARY", href: document.activeElement?.getAttribute("href") }));
    if (target.href) reached.push(target.href);
    if (target.menu) return reached;
  }
  throw new Error("Header menu cannot be reached from the brand with Tab");
}

test("header controls fit and remain keyboard reachable at 320px, CSS enlargement, and desktop", async ({ page, context }, testInfo) => {
  const externalRequests: string[] = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") { externalRequests.push(url.hostname); await route.abort(); }
    else await route.continue();
  });
  const measurements: unknown[] = [];
  for (const user of ["anonymous", "reviewer"] as const) {
    await context.clearCookies();
    if (user === "reviewer") await context.addCookies([{ name: "retaste_session", value: "qa-active-reviewer-session", domain: "127.0.0.1", path: "/" }]);
    for (const [width, zoom] of [[320, 1], [640, 2], [1280, 1]] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/places");
      if (zoom === 2) await page.addStyleTag({ content: "html { zoom: 2; }" });
      // Same-route navigation can restore the scroll left by the previous Tab traversal.
      await page.evaluate(() => window.scrollTo(0, 0));
      const header = page.locator(".site-head");
      const menu = header.getByRole("button", { name: "메뉴", exact: true });
      await expect(menu).toBeVisible();
      const closed = { brand: await bounds(header.locator(".brand")), menu: await bounds(menu) };
      expect.soft(closed.brand.x).toBeGreaterThanOrEqual(0);
      expect.soft(closed.brand.right).toBeLessThanOrEqual(width);
      expect.soft(closed.menu.x).toBeGreaterThanOrEqual(0);
      expect.soft(closed.menu.right).toBeLessThanOrEqual(width);
      expect.soft(closed.menu.hit).toBe(true);
      const reached = await tabToMenu(page);
      await expect(menu).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(header.locator("details")).toHaveAttribute("open", "");
      const names = ["맛집 리스트", "코스 추천", "나의 취향", ...(user === "anonymous" ? ["로그인", "회원가입"] : ["장소 제안", "리뷰어 평가"])];
      const open: Record<string, Awaited<ReturnType<typeof bounds>>> = {};
      for (const name of names) {
        const link = header.getByRole("link", { name, exact: true });
        await expect(link).toHaveCount(1);
        open[name] = await bounds(link);
        expect.soft(open[name].x, name).toBeGreaterThanOrEqual(0);
        expect.soft(open[name].right, name).toBeLessThanOrEqual(width);
        expect.soft(open[name].bottom, name).toBeLessThanOrEqual(1000);
        expect.soft(open[name].hit, name).toBe(true);
      }
      if (user === "reviewer") await expect(header.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
      for (let index = 0; index < 9; index++) {
        await page.keyboard.press("Tab");
        const href = await page.evaluate(() => document.activeElement?.closest(".site-head") ? document.activeElement?.getAttribute("href") : null);
        if (href) reached.push(href);
      }
      for (const path of ["/places", "/courses", "/me", ...(user === "reviewer" ? ["/suggestions/new", "/reviewer/ratings"] : ["/login", "/signup"])]) {
        expect.soft(reached.some(href => href.split("?")[0] === path), `Tab reaches ${path}`).toBe(true);
      }
      measurements.push({ user, width, zoom, closed, open, reached });
      await page.screenshot({ path: testInfo.outputPath(`header-${user}-${width}-zoom-${zoom}.png`) });
      await header.getByRole("link", { name: "맛집 리스트", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/places$/);
    }
  }
  const measurementFile = testInfo.outputPath("header-measurements.json");
  await writeFile(measurementFile, JSON.stringify({ measurements, externalRequestsBlocked: externalRequests }, null, 2));
  await testInfo.attach("header-measurements.json", { path: measurementFile, contentType: "application/json" });
});
