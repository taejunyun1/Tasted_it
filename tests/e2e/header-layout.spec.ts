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
    const style = getComputedStyle(element);
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, hit, fontFamily: style.fontFamily, fontSize: style.fontSize };
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

for (const user of ["anonymous", "reviewer"] as const) {
  test(`header controls fit and remain keyboard reachable at 320px, CSS enlargement, and desktop (${user})`, async ({ page, context }, testInfo) => {
    const externalRequests: string[] = [];
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "127.0.0.1") { externalRequests.push(url.hostname); await route.abort(); }
      else await route.continue();
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const measurements: unknown[] = [];
    await context.clearCookies();
    if (user === "reviewer") await context.addCookies([{ name: "retaste_session", value: "qa-active-reviewer-session", domain: "127.0.0.1", path: "/" }]);
    for (const [width, zoom, fontMode] of [[320, 1, "default"], [640, 2, "default"], [320, 1, "monospace-stress"], [640, 2, "monospace-stress"], [1280, 1, "default"]] as const) {
      await page.setViewportSize({ width, height: 1000 });
      // Give each layout its own history entry so Enter below must finish a navigation.
      await page.goto(`/places?header-layout=${width}-${zoom}-${fontMode}`);
      if (zoom === 2) await page.addStyleTag({ content: "html { zoom: 2; }" });
      if (fontMode === "monospace-stress") await page.addStyleTag({ content: ".site-head, .site-head * { font-family: monospace !important; }" });
      // Ignore CSS smooth scrolling when resetting a previous Tab traversal.
      expect(await page.evaluate(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        return window.scrollY;
      })).toBe(0);
      const header = page.locator(".site-head");
      const menu = header.getByRole("button", { name: "메뉴", exact: true });
      await expect(menu).toBeVisible();
      const closed = { brand: await bounds(header.locator(".brand")), menu: await bounds(menu) };
      const { root } = await cdp.send("DOM.getDocument");
      const renderedFonts: Record<string, unknown> = {};
      for (const selector of [".site-head .brand", ".site-head__primary > a", ".site-menu summary"]) {
        const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
        renderedFonts[selector] = (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
      }
      const nav = await bounds(header.locator(".site-head__nav"));
      expect.soft(closed.brand.x).toBeGreaterThanOrEqual(0);
      expect.soft(closed.brand.right).toBeLessThanOrEqual(width);
      expect.soft(closed.menu.x).toBeGreaterThanOrEqual(0);
      expect.soft(closed.menu.right).toBeLessThanOrEqual(width);
      expect.soft(closed.menu.hit).toBe(true);
      if (width <= 760) {
        expect.soft(closed.menu.width / zoom).toBeGreaterThanOrEqual(44);
        expect.soft(closed.menu.height / zoom).toBeGreaterThanOrEqual(44);
      }
      const reached = await tabToMenu(page);
      await expect(menu).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(header.locator("details")).toHaveAttribute("open", "");
      const { nodeId: mobileLinkNode } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".site-menu__primary-link" });
      if (mobileLinkNode) renderedFonts[".site-menu__primary-link"] = (await cdp.send("CSS.getPlatformFontsForNode", { nodeId: mobileLinkNode })).fonts;
      console.log("HEADER_LAYOUT_DIAGNOSTIC", JSON.stringify({ platform: process.platform, user, width, zoom, fontMode, closed, nav, renderedFonts }));
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
      measurements.push({ user, width, zoom, fontMode, closed, nav, renderedFonts, open, reached });
      await page.screenshot({ path: testInfo.outputPath(`header-${user}-${width}-zoom-${zoom}-${fontMode}.png`) });
      await header.getByRole("link", { name: "맛집 리스트", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/places$/);
    }
    if (user === "reviewer") {
      for (const [width, zoom] of [[320, 1], [640, 2]] as const) {
        const height = 320 * zoom;
        await page.setViewportSize({ width, height });
        await page.goto("/places");
        if (zoom === 2) await page.addStyleTag({ content: "html { zoom: 2; }" });
        expect(await page.evaluate(() => {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
          return window.scrollY;
        })).toBe(0);
        const header = page.locator(".site-head");
        const menu = header.getByRole("button", { name: "메뉴", exact: true });
        await menu.focus();
        await page.keyboard.press("Enter");
        const targets = new Set(["맛집 리스트", "코스 추천", "나의 취향", "장소 제안", "리뷰어 평가", "로그아웃"]);
        // A short screen may scroll the menu internally; Tab must reveal every item.
        for (let index = 0; index < 9; index++) {
          await page.keyboard.press("Tab");
          const focused = header.locator(":focus");
          if (await focused.count() === 0) continue;
          const label = (await focused.innerText()).trim();
          if (!targets.has(label)) continue;
          const box = await bounds(focused);
          expect.soft(box.x, label).toBeGreaterThanOrEqual(0);
          expect.soft(box.right, label).toBeLessThanOrEqual(width);
          expect.soft(box.y, label).toBeGreaterThanOrEqual(0);
          expect.soft(box.bottom, label).toBeLessThanOrEqual(height);
          expect.soft(box.hit, label).toBe(true);
          targets.delete(label);
        }
        expect.soft([...targets], "short-screen keyboard targets").toEqual([]);
        measurements.push({ user, width, height, zoom, shortScreen: true, unreached: [...targets], panel: await bounds(header.locator(".site-menu__panel")) });
        await page.screenshot({ path: testInfo.outputPath(`header-short-${width}-zoom-${zoom}.png`) });
      }
    }
    const measurementFile = testInfo.outputPath("header-measurements.json");
    await writeFile(measurementFile, JSON.stringify({ measurements, externalRequestsBlocked: externalRequests }, null, 2));
    await testInfo.attach("header-measurements.json", { path: measurementFile, contentType: "application/json" });
    await cdp.detach();
  });
}
