import { expect, test } from "@playwright/test";

const initial = "?q=라멘&bbox=126.90,35.14,126.93,35.16&selected=sample-place-1&view=list";

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/[^/]*(?:naver\.com|naver\.net|pstatic\.net)\//, (route) => route.abort());
});

test("category search preserves the current bounds, selection and list view", async ({ page }) => {
  await page.goto(`/maps/ramen-detail${initial}`);
  await page.getByRole("textbox", { name: "동네 또는 가게" }).fill("동명동");
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("동명동");
  const search = new URL(page.url()).searchParams;
  expect(search.get("view")).toBe("list");
  expect(search.get("selected")).toBe("sample-place-1");
  expect(search.get("bbox")).toBe("126.9,35.14,126.93,35.16");
});

test("category locate applies the current position without losing query or view", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "geolocation", {
    configurable: true, value: { getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: 35.1595, longitude: 126.8526 } } as GeolocationPosition) },
  }));
  await page.goto(`/maps/ramen-detail${initial}`);
  await page.getByRole("button", { name: "내 주변", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("bbox")).toBe("126.82760,35.14150,126.87760,35.17750");
  expect(new URL(page.url()).searchParams.get("view")).toBe("list");
  expect(new URL(page.url()).searchParams.get("q")).toBe("라멘");
  await expect(page.getByRole("status").filter({ hasText: "현재 위치" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("category-location.png"), fullPage: true });
});

for (const scenario of ["denied", "timeout", "unsupported", "outside"] as const) {
  test(`category locate explains ${scenario} without removing search context`, async ({ page }) => {
    await page.addInitScript((scenario) => Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: scenario === "unsupported" ? undefined : {
        getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => scenario === "outside"
          ? success({ coords: { latitude: 37.5665, longitude: 126.978 } } as GeolocationPosition)
          : failure({ code: scenario === "timeout" ? 3 : 1 } as GeolocationPositionError),
      },
    }), scenario);
    await page.goto(`/maps/ramen-detail${initial}`);
    await page.getByRole("button", { name: "내 주변", exact: true }).click();
    const phrase = { denied: "위치 권한", timeout: "시간", unsupported: "지원하지", outside: "광주·전남" }[scenario];
    await expect(page.getByRole("status").filter({ hasText: phrase })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("q")).toBe("라멘");
    expect(new URL(page.url()).searchParams.get("view")).toBe("list");
  });
}

test("a failed SDK can retry once into one healthy map instance", async ({ page }, testInfo) => {
  let requests = 0;
  await page.route("https://oapi.map.naver.com/openapi/v3/maps.js?**", async (route) => {
    requests += 1;
    if (requests === 1) { await route.abort(); return; }
    await route.fulfill({ contentType: "text/javascript", body: `
      (() => { window.__mapInstances = 0;
      class LatLng { constructor(y,x) { this.y=y; this.x=x; } lat(){return this.y;} lng(){return this.x;} }
      class LatLngBounds { constructor(sw,ne){this.sw=sw;this.ne=ne;} getSW(){return this.sw;} getNE(){return this.ne;} }
      class Map { constructor(){window.__mapInstances++;this.zoom=12;} getZoom(){return this.zoom;} fitBounds(){} setCenter(){} setZoom(z){this.zoom=z;} morph(){} destroy(){} }
      window.naver = { maps: { Map, LatLng, LatLngBounds, Marker: class {setMap(){}}, Point: class {}, Position:{TOP_RIGHT:1}, Event:{addListener(){return {};},removeListener(){}} } }; })();
    ` });
  });
  await page.goto(`/maps/ramen-detail${initial.replace("view=list", "view=map")}`);
  await page.getByRole("button", { name: "지도 다시 불러오기" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __mapInstances?: number }).__mapInstances)).toBe(1);
  await expect(page.getByRole("button", { name: "지도 다시 불러오기" })).toHaveCount(0);
  expect(requests).toBe(2);
  await expect(page.locator("#naver-maps-sdk")).toHaveCount(1);
  await expect(page.locator(".result-panel .place-card")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("map-sdk-recovered.png"), fullPage: true });
});

test("SDK retries stop after two explicit attempts and preserve the list", async ({ page }) => {
  let requests = 0;
  await page.route("https://oapi.map.naver.com/openapi/v3/maps.js?**", async (route) => { requests += 1; await route.abort(); });
  await page.goto(`/maps/ramen-detail${initial.replace("view=list", "view=map")}`);
  for (let attempt = 0; attempt < 2; attempt += 1) await page.getByRole("button", { name: "지도 다시 불러오기" }).click();
  await expect(page.getByRole("button", { name: "지도 다시 불러오기" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "새로고침" })).toBeVisible();
  expect(requests).toBe(3);
  await expect(page.locator(".result-panel .place-card")).toHaveCount(1);
});
