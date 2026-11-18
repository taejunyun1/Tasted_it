import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses synthetic sessions on the loopback test Worker only");

for (const width of [320, 390, 1440]) {
  test(`discovery text and filter targets remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/places");
    const body = await page.locator("body").evaluate((node) => {
      const style = getComputedStyle(node);
      return { size: Number.parseFloat(style.fontSize), line: Number.parseFloat(style.lineHeight), words: style.wordBreak };
    });
    expect(body.words).toBe("keep-all");
    expect(body.line / body.size).toBeGreaterThanOrEqual(1.59);
    for (const label of await page.locator(".eyebrow, .place-reason, .discovery-chip-list button").all()) {
      if (await label.isVisible()) expect(await label.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
    }
    for (const button of await page.locator(".discovery-chip-list button").all()) {
      if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await page.screenshot({ path: `docs/evidence/2026-11-18-discovery-readability-${width}.png`, fullPage: true });
  });

  test(`map, course and member labels remain readable at ${width}px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
    await page.route((url) => url.origin !== new URL(baseURL!).origin, route => route.abort());
    const cases = [
      { id: "map", path: "/?qa=1&view=browse", labels: ".map-category-groups button, .map-category-children button, .map-result-head span, .map-place-index, .map-place-summary small, .map-place-rating" },
      { id: "courses", path: "/courses", labels: ".course-hero p, .course-filter-title span, .course-meal-group legend small, .course-meal-count" },
      { id: "member", path: "/me", labels: ".member-profile__email, .member-profile__email span" },
      { id: "admin", path: "/admin", labels: ".admin-home__metric small, .admin-control__status" },
      { id: "admin-members", path: "/admin/members?q=qa-reviewer-member", labels: ".admin-members__state" },
    ];
    for (const item of cases) {
      await page.goto(item.path);
      const labels = page.locator(item.labels);
      expect(await labels.count()).toBeGreaterThan(0);
      for (const label of await labels.all()) {
        if (await label.isVisible()) expect(await label.evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
      }
      if (width < 761) {
        for (const target of await page.locator(".site-head .brand, .course-choice-chip").all()) {
          if (await target.isVisible()) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await page.screenshot({ path: `docs/evidence/2026-11-18-${item.id}-readability-${width}.png`, fullPage: true });
    }
  });
}
