import { expect, test } from "@playwright/test";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";

const TEST_PASSWORD = "local-onboarding-password";

function fixtureIdentity(testInfo: TestInfo) {
  const suffix = testInfo.project.name.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase();
  return {
    email: `e2e-onboarding-${suffix}@retaste.local`,
  };
}

async function openOnboarding(page: Page) {
  await page.goto("/onboarding/taste?returnTo=%2Fplaces");
  await expect(page).toHaveURL(/\/onboarding\/taste\?returnTo=%2Fplaces$/);
  await expect(page.getByRole("heading", { level: 1, name: "지금 가까운 한 끼부터 볼까요?" })).toBeVisible();
}

async function continueToFood(page: Page) {
  await page.getByRole("button", { name: "계속" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "자주 생각나는 메뉴를 골라주세요." })).toBeVisible();
}

async function continueToStyle(page: Page) {
  await page.getByRole("button", { name: "계속" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "좋아하는 맛과 식당 분위기는요?" })).toBeVisible();
}

async function continueToPreview(page: Page) {
  await page.getByRole("button", { name: "계속" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "이 취향으로 추천을 시작할게요." })).toBeVisible();
}

async function guestCookie(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === "retaste_guest")?.value ?? null;
}

test("guest completes optional onboarding and reaches personalized places", async ({ page }) => {
  await openOnboarding(page);
  await continueToFood(page);
  await page.getByRole("button", { name: "국밥러" }).click();
  await page.getByRole("button", { name: "냉면러" }).click();
  await expect(page.getByText("2/5 선택", { exact: true })).toBeVisible();
  await continueToStyle(page);
  await page.getByRole("button", { name: "노포파" }).click();
  await expect(page.getByText("1/3 선택", { exact: true })).toBeVisible();
  await continueToPreview(page);

  await expect(page.getByText("좋아하는 메뉴 2개", { exact: true })).toBeVisible();
  await expect(page.getByText("맛과 스타일 1개", { exact: true })).toBeVisible();
  await expect(page.locator(".taste-onboarding__preview .place-card").first()).toBeVisible();
  await page.getByRole("button", { name: "추천 보러가기" }).click();
  await expect(page).toHaveURL(/\/places\?bbox=/);
  await expect(page.getByRole("heading", { name: "취향과 새로운 발견" })).toBeVisible();
});

test("guest can skip and is not trapped in onboarding", async ({ page }) => {
  await openOnboarding(page);
  await page.getByRole("button", { name: "나중에 할게요" }).click();
  await expect(page).toHaveURL(/\/places$/);
  await expect(page.getByRole("heading", { name: "취향과 새로운 발견" })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/places$/);
  await expect(page.getByRole("heading", { name: "취향과 새로운 발견" })).toBeVisible();
});

test("food and style selection stop at five and three without replacing earlier choices", async ({ page }) => {
  await openOnboarding(page);
  await continueToFood(page);

  for (const label of ["국밥러", "냉면러", "평냉파", "제육러", "김치찌개파"]) {
    await page.getByRole("button", { name: label }).click();
  }
  const sixthFood = page.getByRole("button", { name: "순두부파" });
  await sixthFood.click();
  await expect(page.getByText("5/5 선택", { exact: true })).toBeVisible();
  await expect(sixthFood).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "국밥러" })).toHaveAttribute("aria-pressed", "true");

  await continueToStyle(page);
  for (const label of ["맵부심", "맵찔이", "슴슴한맛"]) {
    await page.getByRole("button", { name: label }).click();
  }
  const fourthStyle = page.getByRole("button", { name: "간센맛" });
  await fourthStyle.click();
  await expect(page.getByText("3/3 선택", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("최대 3개까지 선택할 수 있어요.");
  await expect(fourthStyle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "맵부심" })).toHaveAttribute("aria-pressed", "true");
});

test("guest selections and current step are restored after leaving mid-flow", async ({ page }) => {
  await openOnboarding(page);
  await continueToFood(page);
  await page.getByRole("button", { name: "국밥러" }).click();
  await continueToStyle(page);
  await page.getByRole("button", { name: "노포파" }).click();

  await page.goto("/privacy");
  await page.goto("/onboarding/taste?returnTo=%2Fplaces");
  await expect(page.getByRole("heading", { level: 1, name: "좋아하는 맛과 식당 분위기는요?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "노포파" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "이전" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "자주 생각나는 메뉴를 골라주세요." })).toBeFocused();
  await expect(page.getByRole("button", { name: "국밥러" })).toHaveAttribute("aria-pressed", "true");
});

test("keyboard selection works and focus follows each submitted step", async ({ page }) => {
  await openOnboarding(page);
  const continueButton = page.getByRole("button", { name: "계속" });
  await continueButton.focus();
  await page.keyboard.press("Enter");
  const foodHeading = page.getByRole("heading", { level: 1, name: "자주 생각나는 메뉴를 골라주세요." });
  await expect(foodHeading).toBeFocused();

  const food = page.getByRole("button", { name: "국밥러" });
  await food.focus();
  await page.keyboard.press("Space");
  await expect(food).toHaveAttribute("aria-pressed", "true");
  await continueButton.focus();
  await page.keyboard.press("Enter");
  const styleHeading = page.getByRole("heading", { level: 1, name: "좋아하는 맛과 식당 분위기는요?" });
  await expect(styleHeading).toBeFocused();

  const style = page.getByRole("button", { name: "노포파" });
  await style.focus();
  await page.keyboard.press("Space");
  await expect(style).toHaveAttribute("aria-pressed", "true");
});

test("denied location permission falls back without blocking preview", async ({ context, page }) => {
  await context.clearPermissions();
  await page.addInitScript(() => {
    const state = window as typeof window & { __geolocationCalls?: number };
    const denied = {
      code: 1,
      message: "Permission denied by deterministic E2E stub",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(_success: PositionCallback, error?: PositionErrorCallback) {
          state.__geolocationCalls = (state.__geolocationCalls ?? 0) + 1;
          error?.(denied);
        },
      },
    });
  });
  await openOnboarding(page);
  await page.getByRole("button", { name: "현재 위치 사용하기" }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __geolocationCalls?: number }
  ).__geolocationCalls ?? 0)).toBe(1);
  await expect(page.getByText("광주 중심에서 추천", { exact: true })).toBeVisible();

  await continueToFood(page);
  await continueToStyle(page);
  await continueToPreview(page);
  await expect(page.getByText("광주 중심 추천을 준비했어요.", { exact: true })).toBeVisible();
  await expect(page.locator(".taste-onboarding__preview .place-card").first()).toBeVisible();
});

test("password login returns to the requested place and merges guest taste once", async ({ context, page }, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "The privacy-safe password fixture is seeded only by the local test server.");
  const identity = fixtureIdentity(testInfo);
  await openOnboarding(page);
  await continueToFood(page);
  await page.getByRole("button", { name: "국밥러" }).click();
  await continueToStyle(page);
  expect(await guestCookie(context)).not.toBeNull();

  await page.goto("/places/sample-dongmyeong-ramen");
  await page.getByRole("link", { name: "로그인하고 취향 남기기" }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fplaces%2Fsample-dongmyeong-ramen$/);
  await expect(page.locator('input[name="returnTo"]')).toHaveValue("/places/sample-dongmyeong-ramen");
  await page.getByLabel("이메일").fill(identity.email);
  await page.getByLabel("비밀번호").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();

  await expect(page).toHaveURL(/\/places\/sample-dongmyeong-ramen$/);
  await expect(page.getByRole("heading", { name: "Re:Taste 샘플 라멘 동명" })).toBeVisible();
  expect(await guestCookie(context)).toBeNull();
  await page.goto("/me");
  await expect(page.getByRole("list", { name: "대표 취향" })).toContainText("국밥러");
});
