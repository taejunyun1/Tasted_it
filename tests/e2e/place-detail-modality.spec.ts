import { expect, test, type Locator, type Page } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

const placeName = "Re:Taste 샘플 라멘 동명";
const placeSlug = "sample-dongmyeong-ramen";
const browseQuery = new URLSearchParams({ q: "라멘", bbox: "126.80,35.10,127.00,35.25" });
const mobile = { width: 390, height: 844 };

test.skip(!isControlledLocalBaseUrl(), "Uses a synthetic place on the local Worker");

function detail(page: Page) {
  return page.locator("dialog.place-detail-sheet:modal");
}

async function openDetail(page: Page, opener: Locator) {
  await opener.click();
  const sheet = detail(page);
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAccessibleName(new RegExp(placeName));
  await expect(sheet.getByRole("heading", { name: placeName, exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "상세 정보 닫기" })).toBeFocused();
  return sheet;
}

test("mobile list detail isolates the page and restores the trigger on every dismissal", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.setViewportSize(mobile);
  await page.goto(`/places?${browseQuery}`);
  const opener = page.locator(".discovery-grid").getByRole("link", { name: `${placeName} 상세 보기`, exact: true });
  await expect(opener).toBeVisible();
  await opener.scrollIntoViewIfNeeded();
  await page.evaluate(() => { document.body.style.setProperty("overflow", "auto", "important"); });
  const scrollBefore = await page.evaluate(() => window.scrollY);

  for (const method of ["escape", "button", "backdrop", "history"]) {
    const sheet = await openDetail(page, opener);
    await expect.poll(() => page.locator("body").evaluate((body) => getComputedStyle(body).overflowY)).toBe("hidden");
    await page.locator(".skip-link").evaluate((background: HTMLAnchorElement) => background.focus());
    await expect.poll(() => sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    if (method === "escape") {
      const accessibility = await page.context().newCDPSession(page);
      try {
        const { nodes } = await accessibility.send("Accessibility.getFullAXTree");
        expect(nodes.some((node) => !node.ignored && node.role?.value === "dialog" && String(node.name?.value).includes(placeName))).toBe(true);
        expect(nodes.some((node) => !node.ignored && node.name?.value === "본문으로 건너뛰기")).toBe(false);
      } finally { await accessibility.detach(); }
      await page.screenshot({ path: testInfo.outputPath("mobile-place-detail.png"), animations: "disabled" });
      await page.keyboard.press("Escape");
    }
    if (method === "button") await sheet.getByRole("button", { name: "상세 정보 닫기" }).click();
    if (method === "backdrop") {
      const box = await sheet.boundingBox();
      expect(box?.y).toBeGreaterThan(12);
      await page.mouse.click(mobile.width / 2, box!.y / 2);
    }
    if (method === "history") await page.goBack();

    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page).toHaveURL((url) => !url.searchParams.has("place") && url.searchParams.get("q") === "라멘"
      && url.searchParams.get("bbox") === browseQuery.get("bbox"));
    await expect.poll(() => page.evaluate(() => [document.body.style.overflow, document.body.style.getPropertyPriority("overflow"), window.scrollY]))
      .toEqual(["auto", "important", scrollBefore]);
  }
});

test("map quick information leaves the header operable and returns focus from mobile detail", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";
  await page.goto(`/?view=browse&qa=1&${browseQuery}`);
  if (isMobile) await page.getByRole("button", { name: "목록", exact: true }).click();
  await page.getByRole("button", { name: `${placeName} 선택`, exact: true }).click();

  const quick = page.getByRole("dialog", { name: `${placeName} 빠른 정보`, exact: true });
  await expect(quick).toBeVisible();
  await expect(quick).not.toHaveAttribute("aria-modal", "true");
  const menu = page.getByRole("button", { name: "메뉴", exact: true });
  await menu.click();
  await expect(page.getByRole("link", { name: "로그인", exact: true })).toBeVisible();
  await menu.focus();
  await page.keyboard.press("Escape");
  await expect(quick).toBeVisible();
  if (await menu.evaluate((node) => node.closest("details")?.open)) await menu.click();

  const opener = quick.getByRole("link", { name: "상세 보기", exact: true });
  if (isMobile) {
    const sheet = await openDetail(page, opener);
    await opener.evaluate((link: HTMLAnchorElement) => link.focus());
    await expect.poll(() => sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await sheet.getByRole("button", { name: "상세 정보 닫기" }).click();
    await expect(opener).toBeFocused();
    await expect(page).toHaveURL((url) => url.searchParams.get("selected") === "sample-place-1" && !url.searchParams.has("place"));
    await page.keyboard.press("Escape");
    await expect(quick).toHaveCount(0);
    const mapTab = page.getByRole("group", { name: "모바일 보기 방식" }).getByRole("button", { name: "지도", exact: true });
    await expect(mapTab).toBeFocused();
    await expect(mapTab).toBeInViewport();
  } else {
    await page.screenshot({ path: testInfo.outputPath("desktop-map-quick-info.png"), animations: "disabled" });
    await opener.click();
    await expect(page).toHaveURL(new RegExp(`/places/${placeSlug}$`));
    await expect(page.getByRole("heading", { name: placeName, exact: true })).toBeVisible();
  }
});

test("shared place parameters open mobile detail and reach the desktop canonical page", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";

  for (const target of [`/?place=${placeSlug}`, `/places?${browseQuery}&place=${encodeURIComponent(`/places/${placeSlug}`)}`]) {
    await page.goto(target);
    if (isMobile) {
      const sheet = detail(page);
      await expect(sheet.getByRole("heading", { name: placeName, exact: true })).toBeVisible();
      await expect(sheet.getByRole("button", { name: "상세 정보 닫기" })).toBeFocused();
      await page.reload();
      await expect(sheet.getByRole("heading", { name: placeName, exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL((url) => !url.searchParams.has("place"));
      const fallback = target.startsWith("/?") ? "#map-browse-toggle" : "#all-places";
      await expect(page.locator(fallback)).toBeFocused();
    } else {
      await expect(page).toHaveURL(new RegExp(`/places/${placeSlug}$`));
      await expect(page.getByRole("heading", { name: placeName, exact: true })).toBeVisible();
      await expect(detail(page)).toHaveCount(0);
    }
  }

  await page.goto(`/places?place=${encodeURIComponent("//example.invalid/places/sample-dongmyeong-ramen")}`);
  await expect(page.getByRole("heading", { name: "좋아하는 맛과 낯선 한 끼 사이." })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/places");
  await expect(detail(page)).toHaveCount(0);
});

test("mobile detail respects the reduced motion preference", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.setViewportSize(mobile);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/?place=${placeSlug}`);
  const sheet = detail(page);
  await expect(sheet.getByRole("heading", { name: placeName, exact: true })).toBeVisible();
  await expect(sheet).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(sheet).toHaveCSS("animation-name", "map-sheet-rise");
});
