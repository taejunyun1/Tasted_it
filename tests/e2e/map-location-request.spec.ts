import { expect, test, type Page } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses an injected browser location on a local Worker");

const gunsanBounds = "126.71190,35.94970,126.76190,35.98570";
const defaultBounds = "126.72000,35.03000,127.02000,35.25000";

type LocationProbe = {
  calls: number;
  complete: (outcome?: "success" | "timeout") => void;
};

async function trackLocation(page: Page, baseUrl: string) {
  await page.route(url => url.origin !== new URL(baseUrl).origin && url.protocol.startsWith("http"), route => route.abort());
  await page.addInitScript(() => {
    const probe: LocationProbe = { calls: 0, complete: () => undefined };
    Object.assign(window, { locationProbe: probe });
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition(success: PositionCallback, error: PositionErrorCallback) {
        probe.calls++;
        probe.complete = (outcome = "success") => {
          if (outcome === "timeout") {
            error({ code: 3 } as GeolocationPositionError);
          } else {
            success({ coords: { latitude: 35.9677, longitude: 126.7369 } } as GeolocationPosition);
          }
        };
      },
    } });
  });
  const gpsNavigations: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.searchParams.get("bbox") === gunsanBounds && url.origin === new URL(baseUrl).origin) {
      gpsNavigations.push(url.pathname);
    }
  });
  return gpsNavigations;
}

async function locationCalls(page: Page) {
  return page.evaluate(() => (window as Window & { locationProbe: LocationProbe }).locationProbe.calls);
}

async function finishLocation(page: Page, outcome: "success" | "timeout" = "success") {
  await page.evaluate(async (value) => {
    (window as Window & { locationProbe: LocationProbe }).locationProbe.complete(value);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, outcome);
}

test("Home ignores a pending location after submitting a new search and can retry a timeout", async ({ page, baseURL }, testInfo) => {
  const navigations = await trackLocation(page, baseURL!);
  await page.goto(`/?view=browse&q=before&bbox=${defaultBounds}`);
  await expect(page.locator(".map-canvas")).toHaveAttribute("data-map-unavailable", "true");
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "목록", exact: true }).click();
  }
  const locate = page.getByRole("button", { name: /내 주변/ });
  await locate.click();
  expect(await locationCalls(page)).toBe(1);
  expect.soft(await locate.getAttribute("aria-busy")).toBe("true");
  const search = page.getByRole("textbox", { name: "장소 검색" });
  let continueSearch!: () => void;
  const blocked = new Promise<void>(resolve => { continueSearch = resolve; });
  const nextQuery = (url: URL) => url.pathname.endsWith(".data") && url.searchParams.get("q") === "after";
  await page.route(nextQuery, async route => { await blocked; await route.continue(); });
  try {
    await search.fill("after");
    const requested = page.waitForRequest(request => nextQuery(new URL(request.url())));
    await search.press("Enter");
    await requested;
    await expect.soft(locate).toHaveAttribute("aria-busy", "false");
    await expect.soft(locate).toBeDisabled();
    await finishLocation(page);
    expect(navigations).toEqual([]);
  } finally {
    continueSearch();
  }
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("after");
  expect(new URL(page.url()).searchParams.get("q")).toBe("after");
  await expect(locate).toBeEnabled();

  await locate.click();
  expect(await locationCalls(page)).toBe(2);
  await finishLocation(page, "timeout");
  await expect(page.getByRole("status").filter({ hasText: "현재 위치 확인 시간이 초과됐습니다." })).toBeVisible();
  await expect(locate).toBeEnabled();
  await expect(search).toHaveValue("after");
  await page.screenshot({ path: testInfo.outputPath("home-location-timeout.png"), fullPage: true });
});

test("category view navigation supersedes delayed GPS without rolling back the view", async ({ page, baseURL }, testInfo) => {
  const navigations = await trackLocation(page, baseURL!);
  await page.goto(`/maps/ramen-detail?view=list&bbox=${defaultBounds}`);
  const views = page.getByRole("navigation", { name: "보기 방식" });
  await views.getByRole("button", { name: "내 주변" }).click();
  expect(await locationCalls(page)).toBe(1);
  await expect(views.getByRole("button", { name: "위치 확인 중…" })).toBeDisabled();

  await views.getByRole("link", { name: "지도", exact: true }).click();
  await expect(page.locator(".explore-split")).toHaveAttribute("data-view", "map");
  await finishLocation(page);
  expect(navigations).toEqual([]);
  expect(new URL(page.url()).searchParams.get("view")).toBe("map");
  await expect(views.getByRole("button", { name: "내 주변" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("category-map-after-delayed-location.png"), fullPage: true });
});

test("curated location status and heading stay accessible within the current view", async ({ page, baseURL }, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chromium";
  if (mobile) await page.setViewportSize({ width: 320, height: 700 });
  await trackLocation(page, baseURL!);
  await page.goto("/?qa=1");
  await expect(page.getByLabel("장소 지도", { exact: true })).toBeVisible();
  const main = page.getByRole("main");
  const heading = main.getByRole("heading", { level: 1, name: "지금 갈 만한 5곳" });
  await expect(heading).toHaveCount(1);
  await expect(main.locator("h1")).toHaveCount(1);
  if (mobile) {
    await page.getByRole("button", { name: "추천 목록 펼치기" }).click();
    await expect(page.locator(".home-curation-sheet")).toHaveAttribute("data-snap", "full");
    await expect(heading).toHaveCount(1);
  }
  const recommendations = page.getByRole("complementary", { name: "홈 맛집 추천" });
  const locate = recommendations.getByRole("button", { name: "내 위치", exact: true });
  await locate.click();
  const notice = recommendations.getByRole("status").filter({ hasText: "현재 위치를 확인하고 있습니다." });
  await expect(notice).toBeVisible();
  await expect(locate).toBeDisabled();
  await finishLocation(page, "timeout");
  const error = recommendations.getByRole("status").filter({ hasText: "현재 위치 확인 시간이 초과됐습니다." });
  await expect(error).toBeVisible();
  await expect.poll(() => error.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  })).toBe(true);
  await expect(locate).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("curated-location-timeout.png"), fullPage: true });
  if (mobile) {
    const card = recommendations.locator(".home-curation-card").first();
    await card.press("Enter");
    await expect(recommendations).toHaveAttribute("data-snap", "peek");
    await expect(heading).toHaveCount(1);
    await expect(main.locator("h1")).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("curated-collapsed-heading.png"), fullPage: true });
  }
});
