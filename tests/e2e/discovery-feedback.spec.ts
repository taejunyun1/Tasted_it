import { expect, test } from "@playwright/test";

test("course location failures are explained while default search stays usable", async ({ page }, testInfo) => {
  await page.goto("/courses");
  await page.evaluate(() => Object.defineProperty(navigator, "geolocation", {
    configurable: true, value: { getCurrentPosition: (_success: unknown, failure: (error: { code: number }) => void) => {
      (window as unknown as { finishLocation: () => void }).finishLocation = () => failure({ code: 1 });
    } },
  }));
  await page.getByRole("button", { name: "내 위치 사용", exact: true }).click();
  await expect(page.getByRole("button", { name: "위치 확인 중…", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("확인하고");
  await page.evaluate(() => (window as unknown as { finishLocation: () => void }).finishLocation());
  for (const [code, message] of [[1, "권한"], [2, "확인할 수"], [3, "시간"]] as const) {
    await page.evaluate((failureCode) => Object.defineProperty(navigator, "geolocation", {
      configurable: true, value: { getCurrentPosition: (_success: unknown, failure: (error: { code: number }) => void) => failure({ code: failureCode }) },
    }), code);
    await page.getByRole("button", { name: "내 위치 사용", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(message);
    await expect(page.getByRole("status")).toContainText("광주시청");
  }
  await page.evaluate(() => Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined }));
  await page.getByRole("button", { name: "내 위치 사용", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("지원하지");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `output/playwright/course-location-feedback-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "이 조건으로 코스 만들기", exact: true }).click();
  await expect(page.locator(".course-context")).toContainText("광주시청 기준");
  expect(new URL(page.url()).searchParams.has("lat")).toBe(false);
});

test("course location uses valid coordinates and preserves them after an out-of-market result", async ({ page }) => {
  await page.goto("/courses");
  await page.evaluate(() => Object.defineProperty(navigator, "geolocation", {
    configurable: true, value: { getCurrentPosition: (success: (position: { coords: { latitude: number; longitude: number } }) => void) => success({ coords: { latitude: 35.1595, longitude: 126.8526 } }) },
  }));
  await page.getByRole("button", { name: "내 위치 사용", exact: true }).click();
  await expect(page.getByRole("button", { name: "현재 위치 반영됨", exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "geolocation", {
    configurable: true, value: { getCurrentPosition: (success: (position: { coords: { latitude: number; longitude: number } }) => void) => success({ coords: { latitude: 37.5, longitude: 127 } }) },
  }));
  await page.getByRole("button", { name: "현재 위치 반영됨", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("광주·전남");
  await expect(page.getByRole("status")).toContainText("선택한 위치");
  await expect(page.locator('input[name="lat"]')).toHaveValue("35.1595");
  await expect(page.locator('input[name="lng"]')).toHaveValue("126.8526");
});

test("place search announces pending and recovers failed navigation with its filters", async ({ page }, testInfo) => {
  const bbox = "126.8,35.1,127,35.25";
  const query = "없는 식당";
  await page.goto(`/places?category=ramen-detail&bbox=${bbox}&badge=food-ramen&badge=style-market&temp=1`);
  let seen: () => void;
  const requestSeen = new Promise<void>((resolve) => { seen = resolve; });
  let release: () => void;
  const requestRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/places.data?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") !== query) return route.continue();
    seen();
    await requestRelease;
    await route.abort("failed");
  });
  await page.getByLabel("장소 검색", { exact: true }).fill(query);
  const click = page.getByRole("button", { name: "찾기", exact: true }).click();
  await requestSeen;
  await expect(page.getByRole("button", { name: "찾는 중…", exact: true })).toBeDisabled();
  await expect(page.locator("#place-search-status")).toContainText("찾고 있어요");
  release!();
  await click;
  await expect(page.getByRole("heading", { name: "장소를 불러오지 못했어요", exact: true })).toBeVisible();
  await expect(page.getByLabel("장소 검색", { exact: true })).toHaveValue(query);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `output/playwright/place-search-recovery-${testInfo.project.name}.png`, fullPage: true });
  await page.unroute("**/places.data?*");
  const retryResponse = page.waitForResponse((response) => response.request().isNavigationRequest()
    && new URL(response.url()).pathname === "/places" && new URL(response.url()).searchParams.get("q") === query);
  await page.getByRole("button", { name: "다시 검색", exact: true }).click();
  expect((await retryResponse).status()).toBe(200);
  await expect(page.locator("#place-search-status")).toContainText("0곳");
  const restored = new URL(page.url()).searchParams;
  expect(restored.get("q")).toBe(query);
  expect(restored.get("category")).toBe("ramen-detail");
  expect(restored.get("bbox")).toBe(bbox);
  expect(restored.getAll("badge")).toEqual(["food-ramen", "style-market"]);
  expect(restored.get("temp")).toBe("1");
});
