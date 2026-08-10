import { expect, test } from "@playwright/test";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";

const TEST_PASSWORD = "local-onboarding-password";

function localD1(sql: string) {
  const output = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", "--local", "--command", sql, "--json"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  return JSON.parse(output) as Array<{ results: Array<Record<string, unknown>> }>;
}

function fixtureIdentity(testInfo: TestInfo) {
  const suffix = testInfo.project.name.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase();
  return {
    userId: `e2e-onboarding-${suffix}`,
    email: `e2e-onboarding-${suffix}@retaste.local`,
  };
}

function seedLoginMember(testInfo: TestInfo) {
  const identity = fixtureIdentity(testInfo);
  const saltBytes = Buffer.from(`retaste-${testInfo.project.name}`);
  const passwordHash = pbkdf2Sync(TEST_PASSWORD, saltBytes, 99_999, 32, "sha256").toString("base64");
  const passwordSalt = saltBytes.toString("base64");
  localD1(`
    DELETE FROM product_events WHERE user_id='${identity.userId}';
    DELETE FROM sessions WHERE user_id='${identity.userId}';
    DELETE FROM user_taste_badges WHERE user_id='${identity.userId}';
    DELETE FROM users WHERE id='${identity.userId}';
    INSERT INTO users (
      id,email,display_name,role,password_hash,password_salt,email_verified_at,created_at,updated_at
    ) VALUES (
      '${identity.userId}','${identity.email}','E2E 온보딩 회원','USER',
      '${passwordHash}','${passwordSalt}','2026-08-10T00:00:00Z',
      '2026-08-10T00:00:00Z','2026-08-10T00:00:00Z'
    );
  `);
  return identity;
}

function deleteLoginMember(userId: string, guestId: string | null) {
  localD1(`
    DELETE FROM product_events
      WHERE user_id='${userId}'${guestId ? ` OR guest_session_id='${guestId}'` : ""};
    DELETE FROM sessions WHERE user_id='${userId}';
    DELETE FROM user_taste_badges WHERE user_id='${userId}';
    ${guestId ? `DELETE FROM guest_taste_sessions WHERE id='${guestId}';` : ""}
    DELETE FROM users WHERE id='${userId}';
  `);
}

async function openOnboarding(page: Page) {
  await page.goto("/places");
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

test("guest completes optional onboarding and reaches personalized places", async ({ context, page }) => {
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
  const sessionId = await guestCookie(context);
  expect(sessionId).not.toBeNull();

  await page.getByRole("button", { name: "추천 보러가기" }).click();
  await expect(page).toHaveURL(/\/places\?bbox=/);
  await expect(page.getByRole("heading", { name: "취향과 새로운 발견" })).toBeVisible();

  if (!process.env.BASE_URL) {
    const stored = localD1(`
      SELECT completed_at FROM guest_taste_sessions WHERE id='${sessionId}';
      SELECT badge_id FROM guest_taste_badges WHERE session_id='${sessionId}' ORDER BY badge_id;
    `);
    expect(stored[0]?.results[0]?.completed_at).toEqual(expect.any(String));
    expect(stored[1]?.results).toEqual([
      { badge_id: "food-gukbap" },
      { badge_id: "food-naengmyeon" },
      { badge_id: "style-old-school" },
    ]);
  }
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
  await openOnboarding(page);
  await page.getByRole("button", { name: "현재 위치 사용하기" }).click();
  await expect(page.getByText("광주 중심에서 추천", { exact: true })).toBeVisible();

  await continueToFood(page);
  await continueToStyle(page);
  await continueToPreview(page);
  await expect(page.getByText("광주 중심 추천을 준비했어요.", { exact: true })).toBeVisible();
  await expect(page.locator(".taste-onboarding__preview .place-card").first()).toBeVisible();
});

test("password login returns to the requested place and merges guest taste once", async ({ context, page }, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "The privacy-safe login fixture and merge assertions require local D1.");
  const identity = seedLoginMember(testInfo);
  let sessionId: string | null = null;
  try {
    await openOnboarding(page);
    await continueToFood(page);
    await page.getByRole("button", { name: "국밥러" }).click();
    await continueToStyle(page);
    sessionId = await guestCookie(context);
    expect(sessionId).not.toBeNull();

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
    const merged = localD1(`
      SELECT merged_user_id FROM guest_taste_sessions WHERE id='${sessionId}';
      SELECT badge_id,source FROM user_taste_badges
        WHERE user_id='${identity.userId}' ORDER BY badge_id,source;
      SELECT count(*) AS event_count FROM product_events
        WHERE user_id='${identity.userId}' AND guest_session_id='${sessionId}'
          AND event_name='GUEST_CONVERTED';
    `);
    expect(merged[0]?.results).toEqual([{ merged_user_id: identity.userId }]);
    expect(merged[1]?.results).toEqual([{ badge_id: "food-gukbap", source: "USER" }]);
    expect(merged[2]?.results).toEqual([{ event_count: 1 }]);
  } finally {
    deleteLoginMember(identity.userId, sessionId);
  }
});
