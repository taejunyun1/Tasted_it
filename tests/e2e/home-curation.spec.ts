import { expect, test, type Locator, type Page } from "@playwright/test";

test.skip(Boolean(process.env.BASE_URL), "로컬 QA 시드가 있는 환경에서만 실행합니다.");

const DEFAULT_BBOX = "126.72,35.03,127.02,35.25";
const GOLDEN_FALLBACK_NOTICE = "현재 주변 Golden Pick이 없어 리뷰어 평가가 좋은 장소를 추천합니다.";

type RecommendationContract = {
  ok: boolean;
  recommendations: {
    candidateCount: number;
    goldenFallback: boolean;
    notice: string | null;
    places: Array<{ id: string; name: string; isGoldenPick: boolean }>;
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

async function recommendationNames(presentation: Locator) {
  return presentation.locator(".home-curation-card strong").allTextContents();
}

async function directRecommendationContract(page: Page, mode: string) {
  const response = await page.request.get(
    `/resources/home-recommendations?mode=${mode}&bbox=${DEFAULT_BBOX}&locationSource=map_center`,
  );
  expect(response.status()).toBe(200);
  const contract = await response.json() as RecommendationContract;
  expect(contract.ok).toBe(true);
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
  await page.goto("/?qa=1");

  const presentation = curationPresentation(page, testInfo.project.name);
  await expect(presentation.getByRole("heading", { name: "지금 갈 만한 5곳" })).toBeVisible();
  await expect(presentation.locator(".home-curation-card")).toHaveCount(5);
  await expect(presentation.locator(".home-curation-card").first()).toHaveAttribute("aria-pressed", "true");
  await expect(presentation).not.toContainText("QA 낮은 평가 제외");
  await expect(presentation.getByRole("button", { name: "지금 갈 만한 곳", exact: true }))
    .toHaveAttribute("aria-pressed", "true");

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

  await selectMode(page, presentation, "now", "지금 갈 만한 곳");
  const nowNames = await recommendationNames(presentation);
  await selectMode(page, presentation, "taste", "내 취향");
  const tasteNames = await recommendationNames(presentation);
  expect(nowNames.filter((name) => tasteNames.includes(name)).length).toBeLessThanOrEqual(3);

  const requestCountBeforeUiOnlyChange = recommendationRequestCount;
  await presentation.locator(".home-curation-card").nth(1).click();
  await expect(presentation.locator(".home-curation-card").nth(1)).toHaveAttribute("aria-pressed", "true");
  expect(await recommendationNames(presentation)).toEqual(tasteNames);
  expect(recommendationRequestCount).toBe(requestCountBeforeUiOnlyChange);

  if (isMobileProject(testInfo.project.name)) {
    await presentation.getByRole("button", { name: "추천 목록 펼치기", exact: true }).click();
    await expect(presentation).toHaveAttribute("data-snap", "full");
    await presentation.getByRole("button", { name: "추천 목록 접기", exact: true }).click();
    await expect(presentation).toHaveAttribute("data-snap", "half");
    expect(await recommendationNames(presentation)).toEqual(tasteNames);
    expect(recommendationRequestCount).toBe(requestCountBeforeUiOnlyChange);
  }

  await selectMode(page, presentation, "time", "시간대 추천");
  await selectMode(page, presentation, "discovery", "새로운 발견");
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
  await context.setGeolocation({ latitude: 35.145, longitude: 126.875 });
  await page.goto("/?qa=1");

  const presentation = curationPresentation(page, testInfo.project.name);
  const locatedResponsePromise = page.waitForResponse((response) => (
    response.url().includes("/resources/home-recommendations.data")
    && new URL(response.url()).searchParams.get("locationSource") === "gps"
  ));
  await presentation.getByRole("button", { name: "내 위치", exact: true }).click();
  expect((await locatedResponsePromise).status()).toBe(200);
  await expect(presentation.locator(".home-curation-error")).toHaveCount(0);

  await page.getByRole("link", { name: "지도 확대", exact: true }).click();
  const retryArea = page.getByRole("button", { name: "이 지역 다시 추천", exact: true });
  await expect(retryArea).toBeVisible();
  const areaResponsePromise = page.waitForResponse((response) => (
    response.url().includes("/resources/home-recommendations.data")
    && new URL(response.url()).searchParams.get("locationSource") === "map_center"
  ));
  await retryArea.click();
  expect((await areaResponsePromise).status()).toBe(200);
  await expect(retryArea).toHaveCount(0);
  await expect(presentation.locator(".home-curation-error")).toHaveCount(0);
});

test("카드와 지도 marker 선택은 모바일 시트 스크롤 뒤에도 동기화된다", async ({ page }, testInfo) => {
  await page.goto("/?qa=1");

  const presentation = curationPresentation(page, testInfo.project.name);
  const cards = presentation.locator(".home-curation-card");
  await expect(cards).toHaveCount(5);
  const firstName = await cards.first().locator("strong").innerText();
  const lastCard = cards.last();

  if (isMobileProject(testInfo.project.name)) {
    await presentation.getByRole("button", { name: "추천 목록 펼치기", exact: true }).click();
    await expect(presentation).toHaveAttribute("data-snap", "full");
  }

  await lastCard.scrollIntoViewIfNeeded();
  await lastCard.click();
  await expect(lastCard).toHaveAttribute("aria-pressed", "true");
  const map = page.locator('.map-canvas[aria-label="장소 지도"]');
  const lastSelectedId = await map.getAttribute("data-focused-place");
  expect(lastSelectedId).toBeTruthy();

  if (isMobileProject(testInfo.project.name)) {
    const handle = presentation.getByRole("button", { name: "추천 목록 접기", exact: true });
    await dragSheetDown(page, handle);
    await expect(presentation).toHaveAttribute("data-snap", "half");
    await dragSheetDown(page, presentation.getByRole("button", { name: "추천 목록 펼치기", exact: true }));
    await expect(presentation).toHaveAttribute("data-snap", "peek");
  }

  await page.getByRole("button", { name: `1번 ${firstName} 지도 핀`, exact: true }).click();
  await expect(cards.first()).toHaveAttribute("aria-pressed", "true");
  await expect(map).not.toHaveAttribute("data-focused-place", lastSelectedId!);
  if (isMobileProject(testInfo.project.name)) {
    await expect(presentation).toHaveAttribute("data-snap", "half");
  }
});
