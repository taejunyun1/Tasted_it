import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses only the local synthetic session");

for (const width of [320, 390]) {
  test(`open header menu stays clickable above the home sheet at ${width}px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 844 });
    await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
    await page.goto("/?qa=1");
    await page.getByRole("button", { name: "메뉴", exact: true }).click();
    const logout = page.getByRole("button", { name: "로그아웃", exact: true });
    await logout.scrollIntoViewIfNeeded();
    const hit = await logout.evaluate(node => {
      const box = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    });
    expect(hit).toBe(true);
    // Verify a real pointer activation without deleting the shared QA session.
    await logout.evaluate(node => node.addEventListener("click", event => {
      event.preventDefault();
      node.setAttribute("data-pointer-activated", "true");
    }, { once: true }));
    await logout.click();
    await expect(logout).toHaveAttribute("data-pointer-activated", "true");
    await page.screenshot({ path: `docs/evidence/2026-11-18-header-overlay-${width}.png` });
  });
}
