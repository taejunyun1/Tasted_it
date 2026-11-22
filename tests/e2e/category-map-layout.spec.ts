import { execFileSync } from "node:child_process";
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
    await expect(pin).toBeFocused();
    await expect(pin).toBeInViewport();
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

test("the category map and list show the same second page and recover invalid or changed filters", async ({ page, context, baseURL }, testInfo) => {
  const fixture = `category-page-${crypto.randomUUID().slice(0, 8)}`;
  const names = Array.from({ length: 125 }, (_, index) => String(index).padStart(3, "0"));
  const ids = names.map((name) => `${fixture}-${name}`);
  const localSql = (command: string) => execFileSync(process.execPath, [
    "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB",
    "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", command,
  ], { stdio: "pipe" });
  const bbox = "126.8,35.1,127,35.2";
  const path = "/maps/ramen-detail";
  const filters = new URLSearchParams({ q: fixture, bbox, view: "map" });
  try {
    const rows = ids.map((id, index) => `('${id}','${id}','합성 라멘 ${names[index]}','PUBLISHED','광주광역시 합성 주소','합성',35.15,126.9,'${fixture}','2026-11-22','2026-11-22')`);
    localSql(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES ${rows.join(",")};
      INSERT INTO place_categories(place_id,category_id,is_primary) VALUES ${ids.map((id) => `('${id}','cat-ramen',1)`).join(",")};`);
    await blockNaverRequests(page);
    await installReadyMap(page);
    await page.goto(`${path}?${filters}`);
    const tabs = page.getByRole("navigation", { name: "보기 방식" });
    const pagination = page.getByRole("navigation", { name: "장소 목록 페이지" });
    const pins = page.locator(".map-panel .map-pin");
    const cards = page.locator(".result-panel .place-card");
    const secondPageIds = ids.slice(100);
    await expect(pins).toHaveCount(100);
    const list = tabs.getByRole("link", { name: "목록", exact: true });
    const map = tabs.getByRole("link", { name: "지도", exact: true });
    const isNextMapPage = (url: URL) => url.pathname === `${path}.data`
      && url.searchParams.get("view") === "map" && url.searchParams.get("page") === "2";
    let releasePage = () => {};
    const holdPage = new Promise<void>((release) => { releasePage = release; });
    await page.route(isNextMapPage, async (route) => {
      await holdPage;
      await route.continue().catch(() => {});
    }, { times: 1 });
    try {
      const pendingPage = page.waitForRequest((request) => isNextMapPage(new URL(request.url())));
      await pagination.getByRole("link", { name: "다음 페이지" }).click();
      await pendingPage;
      await list.click();
      await expect(page).toHaveURL((url) => url.searchParams.get("view") === "list" && url.searchParams.get("page") === "2");
    } finally {
      releasePage();
    }
    await expect(page.getByRole("status").filter({ hasText: "125 PLACES" })).toContainText("101–125번째 표시");
    await expect.poll(() => cards.evaluateAll((nodes) => nodes.map((node) => node.id.slice("place-".length)))).toEqual(secondPageIds);
    await page.screenshot({ path: testInfo.outputPath("category-page-two-list.png"), fullPage: true });

    await map.click();
    await expect(page).toHaveURL((url) => url.searchParams.get("view") === "map" && url.searchParams.get("page") === "2");
    await expect.poll(() => pins.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-place-id")))).toEqual(secondPageIds);
    await page.screenshot({ path: testInfo.outputPath("category-page-two-map.png"), fullPage: true });

    await list.click();
    await expect(page).toHaveURL((url) => url.pathname === path && url.searchParams.get("view") === "list"
      && url.searchParams.get("page") === "2" && url.searchParams.get("q") === fixture && url.searchParams.get("bbox") === bbox);
    await expect.poll(() => cards.evaluateAll((nodes) => nodes.map((node) => node.id.slice("place-".length)))).toEqual(secondPageIds);
    await cards.first().getByRole("link").click();
    await expect(page.getByRole("heading", { name: "합성 라멘 100", exact: true })).toBeVisible();
    if (testInfo.project.name === "mobile-chromium") expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === path && url.searchParams.get("page") === "2" && !url.searchParams.has("place"));

    await context.grantPermissions(["geolocation"], { origin: new URL(baseURL!).origin });
    await context.setGeolocation({ latitude: 35.15, longitude: 126.9 });
    await tabs.getByRole("button", { name: "내 주변" }).click();
    await expect(page).toHaveURL((url) => !url.searchParams.has("page") && url.searchParams.get("bbox") === "126.87500,35.13200,126.92500,35.16800");
    await expect(cards).toHaveCount(100);

    const listFilters = new URLSearchParams({ q: fixture, bbox, view: "list" });
    const firstPage = page.getByRole("link", { name: "같은 조건의 첫 페이지로 돌아가기" });
    const invalid = await page.goto(`${path}?${listFilters}&page=1&page=2`);
    expect(invalid?.status()).toBe(400);
    await firstPage.click();
    await expect(page).toHaveURL(`${path}?${listFilters}`);
    await expect(cards).toHaveCount(100);
    await page.goto(`${path}?${listFilters}&page=3`);
    await expect(cards).toHaveCount(0);
    await expect(firstPage).toBeVisible();
    await firstPage.click();
    await expect(cards).toHaveCount(100);

    await pagination.getByRole("link", { name: "다음 페이지" }).click();
    await page.getByLabel("동네 또는 가게").fill(`${fixture}-없는검색`);
    await page.getByRole("button", { name: "찾기", exact: true }).click();
    await expect(page.locator(".result-count")).toHaveText("0 PLACES");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("라멘 지도");
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  } finally {
    localSql(`DELETE FROM places WHERE substr(id,1,${fixture.length})='${fixture}';`);
  }
});
