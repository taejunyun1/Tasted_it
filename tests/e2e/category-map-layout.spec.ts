import { expect, test, type Page } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses the isolated local category fixture and synthetic map responses");

function categoryPath() {
  return `/maps/ramen-detail?${new URLSearchParams({ q: "라멘", bbox: "126.90,35.14,126.93,35.16", selected: "sample-place-1", view: "map" })}`;
}

async function blockNaverRequests(page: Page) {
  const blocked: string[] = [];
  await page.route(/https:\/\/[^/]*(?:naver\.com|naver\.net|pstatic\.net)\//, async route => {
    blocked.push(new URL(route.request().url()).pathname);
    await route.abort();
  });
  return blocked;
}

async function installReadyMap(page: Page) {
  await page.addInitScript(() => {
    class LatLng {
      constructor(private latitude: number, private longitude: number) {}
      lat() { return this.latitude; }
      lng() { return this.longitude; }
    }
    class LatLngBounds {
      constructor(private southwest: LatLng, private northeast: LatLng) {}
      getSW() { return this.southwest; }
      getNE() { return this.northeast; }
    }
    class FakeMap {
      private zoom: number;
      private bounds = new LatLngBounds(new LatLng(35.14, 126.90), new LatLng(35.16, 126.93));
      constructor(public host: HTMLElement, options: { zoom: number }) {
        this.zoom = options.zoom;
        const surface = document.createElement("div");
        surface.dataset.syntheticMap = "ready";
        surface.textContent = "합성 지도 표시 영역";
        surface.style.height = "100%";
        host.appendChild(surface);
      }
      getZoom() { return this.zoom; }
      getBounds() { return this.bounds; }
      fitBounds(bounds: LatLngBounds) { this.bounds = bounds; }
      setCenter(_center: LatLng) {}
      setZoom(zoom: number) { this.zoom = zoom; }
      morph(_center: LatLng, zoom: number) { this.zoom = zoom; }
      destroy() { this.host.replaceChildren(); }
    }
    class Marker {
      private node: HTMLElement;
      constructor(options: { map: FakeMap; icon: { content: HTMLElement } }) {
        this.node = options.icon.content;
        Object.assign(this.node.style, { position: "absolute", top: "45%", left: "45%" });
        options.map.host.appendChild(this.node);
      }
      setMap(map: FakeMap | null) { if (map) map.host.appendChild(this.node); else this.node.remove(); }
    }
    (window as unknown as { naver: unknown }).naver = {
      maps: { Map: FakeMap, Marker, LatLng, LatLngBounds, Point: class {}, Position: { TOP_RIGHT: 1 }, Event: { addListener: () => ({}), removeListener: () => {} } },
    };
  });
}

test("category search stays on one line at 320 CSS pixels and 200 percent content enlargement", async ({ page }, testInfo) => {
  await blockNaverRequests(page);
  for (const [width, zoom] of [[320, 1], [640, 2]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(categoryPath());
    if (zoom === 2) await page.addStyleTag({ content: "html { zoom: 2; }" });
    const input = page.getByRole("textbox", { name: "동네 또는 가게" });
    const button = page.getByRole("button", { name: "찾기", exact: true });
    await input.focus();
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    const size = await button.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = new Set([...range.getClientRects()].filter(rect => rect.width && rect.height).map(rect => Math.round(rect.top)));
      const bounds = element.getBoundingClientRect();
      return { lines: lines.size, height: bounds.height, width: bounds.width };
    });
    expect(size.lines).toBe(1);
    expect(size.height).toBeGreaterThanOrEqual(44 * zoom);
    expect(size.width).toBeGreaterThanOrEqual(44 * zoom);
    expect(await input.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`search-${width}-zoom-${zoom}.png`), fullPage: true });
  }
});

test("a failed category map stays compact and keeps the list and place detail usable", async ({ page }, testInfo) => {
  const blocked = await blockNaverRequests(page);
  for (const [width, zoom] of [[320, 1], [640, 2]] as const) {
    const previousBlockedCount = blocked.length;
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(categoryPath());
    if (zoom === 2) await page.addStyleTag({ content: "html { zoom: 2; }" });
    const notice = page.locator(".map-error");
    await expect(notice).toBeVisible();
    expect(blocked.length).toBeGreaterThan(previousBlockedCount);
    const map = page.getByLabel("장소 지도", { exact: true });
    expect((await map.boundingBox())!.height).toBeLessThanOrEqual(240 * zoom);
    await expect(notice).toContainText("목록");
    await expect(notice).not.toContainText(/Client ID|등록 URL|SDK/);
    await expect(map).toHaveAttribute("data-map-unavailable", "true");
    const noticeBox = (await notice.boundingBox())!;
    const overviewBox = (await map.locator(".map-location-overview").boundingBox())!;
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(overviewBox.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`map-unavailable-zoom-${zoom}.png`), fullPage: true });
    const original = new URL(page.url());
    const listLink = page.getByRole("navigation", { name: "보기 방식" }).getByRole("link", { name: "목록", exact: true });
    await listLink.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".explore-split")).toHaveAttribute("data-view", "list");
    for (const key of ["q", "bbox", "selected"]) expect(new URL(page.url()).searchParams.get(key)).toBe(original.searchParams.get(key));
    const card = page.locator(".result-panel .place-card").first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-selected", "true");
    await card.getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Re:Taste 샘플 라멘 동명", exact: true })).toBeVisible();
  }
});

test("a synthetic initialized category map retains its normal viewport area", async ({ page }, testInfo) => {
  const blocked = await blockNaverRequests(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  await installReadyMap(page);
  await page.goto(categoryPath());
  const map = page.getByLabel("장소 지도", { exact: true });
  await expect(map.locator('[data-synthetic-map="ready"]')).toHaveCount(1);
  await expect(map).not.toHaveAttribute("data-map-unavailable", "true");
  await expect(page.locator(".map-error")).toHaveCount(0);
  // Preserve the existing native map's 500/520px minimum area, less its border.
  const minimumMapArea = page.viewportSize()!.width <= 760 ? 498 : 518;
  expect((await map.boundingBox())!.height).toBeGreaterThanOrEqual(minimumMapArea);
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("map-ready-synthetic.png"), fullPage: true });
});

test("category map pins and list cards retain the current category and filters", async ({ page }, testInfo) => {
  await blockNaverRequests(page);
  await installReadyMap(page);
  const opening = new URL(categoryPath(), "http://localhost");
  await page.goto(`${opening.pathname}${opening.search}`);
  const placeName = "Re:Taste 샘플 라멘 동명";
  const pin = page.getByRole("button", { name: `${placeName} 지도 핀`, exact: true });
  await expect(pin).toBeVisible();
  await pin.focus();
  await page.keyboard.press("Enter");
  const sheet = page.locator("dialog.place-detail-sheet:modal");
  const mobile = testInfo.project.name === "mobile-chromium";
  if (mobile) {
    await expect(sheet.getByRole("heading", { name: placeName, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches("#q, .map-pin[data-place-id='sample-place-1']"))).toBe(true);
  } else {
    await expect(sheet).toHaveCount(0);
  }

  const tabs = page.getByRole("navigation", { name: "보기 방식" });
  await tabs.getByRole("link", { name: "목록", exact: true }).click();
  const card = page.locator(".result-panel").getByRole("link", { name: `${placeName} 상세 보기`, exact: true });
  await card.click();
  if (!mobile) {
    await expect(page).toHaveURL(/\/places\/sample-dongmyeong-ramen$/);
    await expect(page.getByRole("heading", { name: placeName, exact: true })).toBeVisible();
    return;
  }

  await expect(sheet.getByRole("heading", { name: placeName, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-category-detail.png"), animations: "disabled" });
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(card).toBeFocused();
  await expect(page).toHaveURL((url) => url.pathname === opening.pathname && url.searchParams.get("view") === "list"
    && !url.searchParams.has("place") && ["q", "bbox", "selected"].every((key) => url.searchParams.get(key) === opening.searchParams.get(key)));
});
