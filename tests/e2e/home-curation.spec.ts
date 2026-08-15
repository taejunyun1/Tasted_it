import { expect, test, type Locator, type Page } from "@playwright/test";

test.skip(Boolean(process.env.BASE_URL), "로컬 QA 시드가 있는 환경에서만 실행합니다.");

const DEFAULT_BBOX = "126.72,35.03,127.02,35.25";
const GOLDEN_FALLBACK_NOTICE = "현재 주변 Golden Pick이 없어 과거 선정 이력과 평가 기록을 바탕으로 추천합니다.";
// Golden fallback ignores time-slot scoring. This past-Golden fixture has a
// score gap larger than the bounded date variation, so its SSR order is fixed.
const EVIDENCE_PLACE_IDS = [
  "e2e-home-place-4",
  "e2e-home-place-1",
  "e2e-home-place-2",
  "e2e-home-place-3",
  "e2e-home-place-5",
] as const;
const MOCK_GPS = { latitude: 35.145, longitude: 126.875 };
const MOCK_GPS_BBOX = [126.85, 35.127, 126.9, 35.163] as const;
const QA_MAP_CENTER = { latitude: 35.1595, longitude: 126.8526 };
const QA_ZOOMED_BBOX = [
  126.8526 - 0.02 / 3,
  35.1595 - 0.02 / 3,
  126.8526 + 0.02 / 3,
  35.1595 + 0.02 / 3,
] as const;
const BBOX_TOLERANCE = 0.00001;

type RecommendationContract = {
  ok: boolean;
  requestToken: string;
  recommendations: {
    candidateCount: number;
    goldenFallback: boolean;
    notice: string | null;
    places: Array<{ id: string; isGoldenPick: boolean }>;
  };
};

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === "mobile-chromium"
    ? { width: 390, height: 844 }
    : { width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

function isMobileProject(projectName: string) {
  return projectName === "mobile-chromium";
}

function curationPresentation(page: Page, projectName: string) {
  return isMobileProject(projectName)
    ? page.locator(".home-curation-sheet")
    : page.locator(".home-curation-panel");
}

function recommendationResponse(page: Page, mode: string) {
  return page.waitForResponse((response) => (
    response.url().includes("/resources/home-recommendations.data")
    && new URL(response.url()).searchParams.get("mode") === mode
  ));
}

async function selectMode(
  page: Page,
  presentation: Locator,
  mode: string,
  accessibleName: string,
) {
  const responsePromise = recommendationResponse(page, mode);
  await presentation.getByRole("button", { name: accessibleName, exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(presentation.getByRole("button", { name: accessibleName, exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(presentation.locator(".home-curation-list")).toHaveAttribute("aria-busy", "false");
  await expect(presentation.locator(".home-curation-error")).toHaveCount(0);
  await expect(presentation.locator(".home-curation-card")).toHaveCount(5);
}

async function recommendationIds(presentation: Locator) {
  const ids = await presentation.locator(".home-curation-card")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-place-id")));
  expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  return ids as string[];
}

function bboxFromRequestUrl(url: string) {
  const raw = new URL(url).searchParams.get("bbox");
  expect(raw).not.toBeNull();
  const bbox = raw?.split(",").map(Number) ?? [];
  expect(bbox).toHaveLength(4);
  expect(bbox.every(Number.isFinite)).toBe(true);
  return bbox;
}

function expectBboxNear(actual: number[], expected: readonly number[]) {
  expect(actual).toHaveLength(4);
  expected.forEach((value, index) => {
    expect(Math.abs(actual[index] - value)).toBeLessThanOrEqual(BBOX_TOLERANCE);
  });
}

async function directRecommendationContract(page: Page, mode: string) {
  const requestToken = `direct-${mode}-contract`;
  const response = await page.request.get(
    `/resources/home-recommendations?mode=${mode}&bbox=${DEFAULT_BBOX}&locationSource=map_center&requestToken=${requestToken}`,
  );
  expect(response.status()).toBe(200);
  const contract = await response.json() as RecommendationContract;
  expect(contract.ok).toBe(true);
  expect(contract.requestToken).toBe(requestToken);
  return contract.recommendations;
}

async function dragSheetDown(page: Page, handle: Locator) {
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 90, { steps: 5 });
  await page.mouse.up();
}

test("큐레이션 홈은 다섯 곳과 명시적 전체 탐색을 보존한다", async ({ page }, testInfo) => {
  await page.goto("/?qa=1&mode=golden");

  const presentation = curationPresentation(page, testInfo.project.name);
  await expect(presentation.getByRole("heading", { name: "지금 갈 만한 5곳" })).toBeVisible();
  await expect(presentation.locator(".home-curation-card")).toHaveCount(5);
  await expect(presentation.locator(".home-curation-card").first()).toHaveAttribute("aria-pressed", "true");
  await expect(presentation).not.toContainText("QA 낮은 평가 제외");
  await expect(presentation.getByRole("button", { name: "Golden Pick", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(presentation.getByText(GOLDEN_FALLBACK_NOTICE, { exact: true })).toBeVisible();
  expect(await recommendationIds(presentation)).toEqual(EVIDENCE_PLACE_IDS);

  if (process.env.HOME_CURATION_EVIDENCE === "1") {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: isMobileProject(testInfo.project.name)
        ? "docs/evidence/2026-08-11-home-curation-v2-mobile.png"
        : "docs/evidence/2026-08-11-home-curation-v2-desktop.png",
      animations: "disabled",
      caret: "hide",
      fullPage: false,
      scale: "css",
    });
  }

  await page.getByRole("button", { name: "전체 지도", exact: true }).click();
  await expect(page.getByRole("button", { name: "추천 지도", exact: true })).toBeVisible();
  await expect(page.locator(".map-explorer-panel")).toBeVisible();

  await page.getByRole("button", { name: "추천 지도", exact: true }).click();
  await expect(page.getByRole("button", { name: "전체 지도", exact: true })).toBeVisible();
  await expect(presentation.getByRole("heading", { name: "지금 갈 만한 5곳" })).toBeVisible();
  await expect(presentation.getByRole("button", { name: "지금 갈 만한 곳", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => {
    const raw = sessionStorage.getItem("retaste:home-curation-v2");
    return raw ? JSON.parse(raw).previousMode : null;
  })).toBe("now");
  const returnedNowIds = await recommendationIds(presentation);
  await selectMode(page, presentation, "taste", "내 취향");
  const returnedTasteIds = await recommendationIds(presentation);
  expect(returnedNowIds.filter((id) => returnedTasteIds.includes(id)).length).toBeLessThanOrEqual(3);
});

test("모드 변경은 최소 두 곳을 바꾸고 단순 UI 재렌더는 결과를 바꾸지 않는다", async ({ page }, testInfo) => {
  let recommendationRequestCount = 0;
  page.on("request", (request) => {
    if (request.url().includes("/resources/home-recommendations.data")) recommendationRequestCount += 1;
  });
  await page.goto("/?qa=1");

  const presentation = curationPresentation(page, testInfo.project.name);
  const initialContract = await directRecommendationContract(page, "now");
  expect(initialContract.candidateCount).toBeGreaterThanOrEqual(8);

  const nowIds = await recommendationIds(presentation);
  expect(recommendationRequestCount).toBe(0);
  await selectMode(page, presentation, "taste", "내 취향");
  const tasteIds = await recommendationIds(presentation);
  expect(nowIds.filter((id) => tasteIds.includes(id)).length).toBeLessThanOrEqual(3);

  const requestCountBeforeUiOnlyChange = recommendationRequestCount;
  await presentation.locator(".home-curation-card").nth(1).click();
  await expect(presentation.locator(".home-curation-card").nth(1)).toHaveAttribute("aria-pressed", "true");
  expect(await recommendationIds(presentation)).toEqual(tasteIds);
  expect(recommendationRequestCount).toBe(requestCountBeforeUiOnlyChange);

  if (isMobileProject(testInfo.project.name)) {
    await presentation.getByRole("button", { name: "추천 목록 펼치기", exact: true }).click();
    await expect(presentation).toHaveAttribute("data-snap", "full");
    await presentation.getByRole("button", { name: "추천 목록 접기", exact: true }).click();
    await expect(presentation).toHaveAttribute("data-snap", "half");
    expect(await recommendationIds(presentation)).toEqual(tasteIds);
    expect(recommendationRequestCount).toBe(requestCountBeforeUiOnlyChange);
  }

  await selectMode(page, presentation, "time", "시간대 추천");
  await selectMode(page, presentation, "discovery", "새로운 발견");
});

test("모바일 추천 행 선택은 시트를 접고 같은 장소를 지도 중심으로 삼는다", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), "모바일 전용 레이어링");
  await page.goto("/?qa=1");

  const sheet = page.locator(".home-curation-sheet");
  const secondCard = sheet.locator(".home-curation-card").nth(1);
  const placeId = await secondCard.getAttribute("data-place-id");
  expect(placeId).toBeTruthy();
  await expect(sheet).toHaveAttribute("data-snap", "half");

  await secondCard.click();

  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(page).toHaveURL(new RegExp(`selected=${placeId}`));
  await expect(page.locator(".map-canvas")).toHaveAttribute("data-focused-place", placeId!);
});

test("Golden 활성 후보가 없으면 정확한 안내와 근거 후보만 보인다", async ({ page }, testInfo) => {
  await page.goto("/?qa=1");

  const presentation = curationPresentation(page, testInfo.project.name);
  await selectMode(page, presentation, "golden", "Golden Pick");
  await expect(presentation.getByText(GOLDEN_FALLBACK_NOTICE, { exact: true })).toBeVisible();
  await expect(presentation.locator('.home-curation-card [data-kind="golden"]')).toHaveCount(0);

  const contract = await directRecommendationContract(page, "golden");
  expect(contract.goldenFallback).toBe(true);
  expect(contract.notice).toBe(GOLDEN_FALLBACK_NOTICE);
  expect(contract.places).not.toHaveLength(0);
  expect(contract.places.every((place) => !place.isGoldenPick)).toBe(true);
});

test("위치와 새 지도 영역은 명시적으로 다시 추천한다", async ({ context, page }, testInfo) => {
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:5173" });
  await context.setGeolocation(MOCK_GPS);
  await page.goto("/?qa=1");

  const presentation = curationPresentation(page, testInfo.project.name);
  const locatedResponsePromise = page.waitForResponse((response) => (
    response.url().includes("/resources/home-recommendations.data")
    && new URL(response.url()).searchParams.get("locationSource") === "gps"
  ));
  await presentation.getByRole("button", { name: "내 위치", exact: true }).click();
  const locatedResponse = await locatedResponsePromise;
  expect(locatedResponse.status()).toBe(200);
  expectBboxNear(bboxFromRequestUrl(locatedResponse.url()), MOCK_GPS_BBOX);
  await expect(presentation.locator(".home-curation-error")).toHaveCount(0);

  await page.getByRole("link", { name: "지도 확대", exact: true }).click();
  const retryArea = page.getByRole("button", { name: "이 지역 다시 추천", exact: true });
  await expect(retryArea).toBeVisible();
  await expect(page.locator('.map-canvas[aria-label="장소 지도"]')).toHaveAttribute("data-map-zoom", "13");
  expectBboxNear(bboxFromRequestUrl(page.url()), MOCK_GPS_BBOX);
  const areaResponsePromise = page.waitForResponse((response) => (
    response.url().includes("/resources/home-recommendations.data")
    && new URL(response.url()).searchParams.get("locationSource") === "map_center"
  ));
  await retryArea.click();
  const areaResponse = await areaResponsePromise;
  expect(areaResponse.status()).toBe(200);
  const areaBbox = bboxFromRequestUrl(areaResponse.url());
  expectBboxNear(areaBbox, QA_ZOOMED_BBOX);
  expect(Math.abs((areaBbox[0] + areaBbox[2]) / 2 - QA_MAP_CENTER.longitude))
    .toBeLessThanOrEqual(BBOX_TOLERANCE);
  expect(Math.abs((areaBbox[1] + areaBbox[3]) / 2 - QA_MAP_CENTER.latitude))
    .toBeLessThanOrEqual(BBOX_TOLERANCE);
  await expect(retryArea).toHaveCount(0);
  await expect(presentation.locator(".home-curation-error")).toHaveCount(0);
});

test("내 위치에서 전체 지도를 이동한 뒤 추천 지도로 돌아오면 지도 중심 출처를 유지한다", async ({ context, page }, testInfo) => {
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:5173" });
  await context.setGeolocation(MOCK_GPS);
  await page.goto("/?qa=1");

  const presentation = curationPresentation(page, testInfo.project.name);
  const locatedResponsePromise = page.waitForResponse((response) => (
    response.url().includes("/resources/home-recommendations.data")
    && new URL(response.url()).searchParams.get("locationSource") === "gps"
  ));
  await presentation.getByRole("button", { name: "내 위치", exact: true }).click();
  await locatedResponsePromise;
  await expect.poll(() => new URL(page.url()).searchParams.get("locationSource")).toBe("gps");

  await page.getByRole("button", { name: "전체 지도", exact: true }).click();
  await expect(page.getByRole("button", { name: "추천 지도", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "지도 확대", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("locationSource")).toBe("map_center");

  await page.getByRole("button", { name: "추천 지도", exact: true }).click();
  const returnedPresentation = curationPresentation(page, testInfo.project.name);
  await expect(returnedPresentation).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("locationSource")).toBe("map_center");

  const responsePromise = recommendationResponse(page, "time");
  await returnedPresentation.getByRole("button", { name: "시간대 추천", exact: true }).click();
  const response = await responsePromise;
  expect(new URL(response.url()).searchParams.get("locationSource")).toBe("map_center");
});

test("이전 지역의 다시 추천 동작은 전체 지도 왕복과 새 loader 결과 뒤 남지 않는다", async ({ page }) => {
  let recommendationRequestCount = 0;
  page.on("request", (request) => {
    if (request.url().includes("/resources/home-recommendations.data")) recommendationRequestCount += 1;
  });
  await page.goto("/?qa=1");

  await page.getByRole("link", { name: "지도 확대", exact: true }).click();
  await expect(page.getByRole("button", { name: "이 지역 다시 추천", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "전체 지도", exact: true }).click();
  await expect(page.getByRole("button", { name: "추천 지도", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "지도 확대", exact: true }).click();

  await page.getByRole("button", { name: "추천 지도", exact: true }).click();
  await expect(page.getByRole("button", { name: "전체 지도", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "이 지역 다시 추천", exact: true })).toHaveCount(0);
  expect(recommendationRequestCount).toBe(0);
});

test("지연된 이전 추천 응답은 전체 지도 loader 이후 세션 이력을 덮어쓰지 않는다", async ({ page }, testInfo) => {
  await page.route("**/resources/home-recommendations.data?*", async (route) => {
    const mode = new URL(route.request().url()).searchParams.get("mode");
    if (mode === "taste") await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await page.goto("/?qa=1");

  const presentation = curationPresentation(page, testInfo.project.name);
  const delayedResponse = recommendationResponse(page, "taste");
  await presentation.getByRole("button", { name: "내 취향", exact: true }).click();
  await page.getByRole("button", { name: "전체 지도", exact: true }).click();
  await expect(page.getByRole("button", { name: "추천 지도", exact: true })).toBeVisible();
  await delayedResponse;

  await expect.poll(() => page.evaluate(() => {
    const raw = sessionStorage.getItem("retaste:home-curation-v2");
    return raw ? JSON.parse(raw).previousMode : null;
  })).toBe("now");
});

test("진행 중 resource A를 최신 B로 교체하면 B 화면과 이력을 지킨다", async ({ context, page }, testInfo) => {
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:5173" });
  await context.setGeolocation(MOCK_GPS);
  let releaseA: (() => void) | undefined;
  const aGate = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  let requestAToken: string | null = null;
  let requestBToken: string | null = null;
  await page.route("**/resources/home-recommendations.data?*", async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get("locationSource");
    if (source === "map_center") {
      requestAToken = url.searchParams.get("requestToken");
      await aGate;
    } else if (source === "gps") {
      requestBToken = url.searchParams.get("requestToken");
    }
    await route.continue();
  });
  await page.goto("/?qa=1");

  const presentation = curationPresentation(page, testInfo.project.name);
  await presentation.getByRole("button", { name: "내 취향", exact: true }).click();
  await expect.poll(() => requestAToken).not.toBeNull();
  const responseBPromise = page.waitForResponse((response) => (
    response.url().includes("/resources/home-recommendations.data")
    && new URL(response.url()).searchParams.get("locationSource") === "gps"
  ));
  await presentation.getByRole("button", { name: "내 위치", exact: true }).click();
  const responseB = await responseBPromise;
  expect(requestAToken).not.toBe(requestBToken);
  expect(requestBToken).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  expect(new URL(responseB.url()).searchParams.get("mode")).toBe("taste");
  expectBboxNear(bboxFromRequestUrl(responseB.url()), MOCK_GPS_BBOX);
  await expect(presentation.locator(".home-curation-list")).toHaveAttribute("aria-busy", "false");
  const expectedBIds = await recommendationIds(presentation);
  await expect.poll(() => page.evaluate(() => {
    const raw = sessionStorage.getItem("retaste:home-curation-v2");
    return raw ? JSON.parse(raw).previousIds : [];
  })).toEqual(expectedBIds);

  releaseA?.();
  await page.waitForTimeout(300);

  expect(await recommendationIds(presentation)).toEqual(expectedBIds);
  await expect.poll(() => page.evaluate(() => {
    const raw = sessionStorage.getItem("retaste:home-curation-v2");
    return raw ? JSON.parse(raw).previousIds : [];
  })).toEqual(expectedBIds);
});

test("카드와 지도 marker 선택은 모바일 시트 스크롤 뒤에도 동기화된다", async ({ page }, testInfo) => {
  await page.goto("/?qa=1");

  const presentation = curationPresentation(page, testInfo.project.name);
  const cards = presentation.locator(".home-curation-card");
  await expect(cards).toHaveCount(5);
  const firstId = await cards.first().getAttribute("data-place-id");
  const lastCard = cards.last();
  const lastId = await lastCard.getAttribute("data-place-id");
  expect(firstId).toBeTruthy();
  expect(lastId).toBeTruthy();

  if (isMobileProject(testInfo.project.name)) {
    await presentation.getByRole("button", { name: "추천 목록 펼치기", exact: true }).click();
    await expect(presentation).toHaveAttribute("data-snap", "full");
  }

  await lastCard.scrollIntoViewIfNeeded();
  await lastCard.click();
  await expect(lastCard).toHaveAttribute("aria-pressed", "true");
  const map = page.locator('.map-canvas[aria-label="장소 지도"]');
  await expect(map).toHaveAttribute("data-focused-place", lastId!);

  if (isMobileProject(testInfo.project.name)) {
    const handle = presentation.getByRole("button", { name: "추천 목록 접기", exact: true });
    await dragSheetDown(page, handle);
    await expect(presentation).toHaveAttribute("data-snap", "half");
    await dragSheetDown(page, presentation.getByRole("button", { name: "추천 목록 펼치기", exact: true }));
    await expect(presentation).toHaveAttribute("data-snap", "peek");
  }

  await page.locator(`.map-pin[data-place-id="${firstId}"]`).click();
  await expect(cards.first()).toHaveAttribute("aria-pressed", "true");
  await expect(map).toHaveAttribute("data-focused-place", firstId!);
  if (isMobileProject(testInfo.project.name)) {
    await expect(presentation).toHaveAttribute("data-snap", "half");
  }
});
