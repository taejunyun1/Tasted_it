import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

function localD1(sql: string) {
  return execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { encoding: "utf8" });
}
test.beforeEach(async ({}, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "Local synthetic D1 only");
  const userId = `e2e-onboarding-${testInfo.project.name}`;
  localD1(`DELETE FROM saved_places WHERE user_id='${userId}'; DELETE FROM member_save_choices WHERE user_id='${userId}';`);
});
const detail = "/places/sample-dongmyeong-ramen";

test("guest save waits for hydration and its initial read, then recovers the current member choice after a failed read", async ({ page, context }, testInfo) => {
  await page.route("https://oapi.map.naver.com/**", (route) => route.abort());
  let releaseEntry!: () => void;
  let releaseRead!: () => void;
  let readStarted!: () => void;
  const entryBarrier = new Promise<void>((resolve) => { releaseEntry = resolve; });
  const readBarrier = new Promise<void>((resolve) => { releaseRead = resolve; });
  const initialRead = new Promise<void>((resolve) => { readStarted = resolve; });
  await page.route("**/entry.client.tsx*", async (route) => { await entryBarrier; await route.continue(); });
  let firstRead = true;
  await page.route("**/resources/guest-saves*", async (route) => {
    if (route.request().method() === "GET" && firstRead) {
      firstRead = false;
      readStarted();
      await readBarrier;
      return route.abort("failed");
    }
    return route.continue();
  });
  const entryRequested = page.waitForRequest((request) => /\/entry\.client\.tsx(?:\?|$)/.test(request.url()));
  try {
    await page.goto(detail, { waitUntil: "commit" });
    await entryRequested;
    const control = page.locator(".guest-save-control");
    const save = control.getByRole("button", { name: "임시 저장", exact: true });
    await expect(save).toBeVisible();
    await expect(save).toBeDisabled();
    await control.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    // Caret hiding mutates input style attributes before React hydrates them.
    await control.screenshot({ path: testInfo.outputPath("guest-ssr-disabled.png"), caret: "initial" });
    releaseEntry();
    await initialRead;
    await expect(save).toBeDisabled();
    releaseRead();
    await expect(control.getByRole("alert")).toContainText("다시 시도");
    await expect(save).toBeDisabled();
    const retry = control.getByRole("button", { name: "저장 상태 다시 확인", exact: true });
    await expect(retry).toBeEnabled();
    await control.screenshot({ path: testInfo.outputPath("guest-read-retry.png") });

    // Login in another client request while this already-rendered guest control is waiting.
    const origin = new URL(page.url()).origin;
    const loggedIn = await context.request.post("/login", { maxRedirects: 0, headers: { Origin: origin }, form: { email: `e2e-onboarding-${testInfo.project.name}@retaste.local`, password: "local-onboarding-password", returnTo: detail } });
    expect(loggedIn.status()).toBe(302);
    const selected = await context.request.post("/resources/guest-saves", { headers: { Origin: origin }, form: { intent: "save", placeId: "sample-place-1", saved: "true" } });
    expect(selected.status()).toBe(200);
    expect(await selected.json()).toMatchObject({ ok: true, saved: true, signedIn: true });
    await retry.click();
    const currentChoice = control.getByRole("button", { name: "저장 해제", exact: true });
    await expect(currentChoice).toBeEnabled();
    await expect(currentChoice).toHaveAttribute("aria-pressed", "true");
    await expect(control.locator('input[name="saved"]')).toHaveValue("false");
    await expect(control.getByRole("alert")).toHaveCount(0);
    await control.screenshot({ path: testInfo.outputPath("guest-member-choice-ready.png") });
    expect(new URL(page.url()).pathname).toBe(detail);
  } finally { releaseEntry(); releaseRead(); }
});

test("guest saves survive reload, keep their unsave intent after failure and connect after login", async ({ page, context }, testInfo) => {
  await page.goto(detail);
  const save = page.getByRole("button", { name: "임시 저장", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("button", { name: "임시 저장 해제", exact: true })).toBeEnabled();
  await page.reload();
  const unsave = page.getByRole("button", { name: "임시 저장 해제", exact: true });
  await expect(unsave).toBeEnabled();
  let failed = false;
  await page.route("**/resources/guest-saves*", async (route) => {
    if (!failed && route.request().method() === "POST") {
      failed = true;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, message: "합성 저장 실패: 다시 시도해 주세요." }) });
    }
    return route.continue();
  });
  await unsave.click();
  await expect(page.getByRole("alert")).toContainText("다시 시도");
  await expect(unsave).toBeEnabled();
  await unsave.click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(unsave).toBeEnabled();
  let loseResponse = true;
  await page.route("**/resources/guest-saves*", async (route) => {
    if (loseResponse && route.request().method() === "POST") {
      loseResponse = false;
      await route.fetch();
      return route.abort("failed");
    }
    return route.continue();
  });
  await unsave.click();
  await expect(page.getByRole("alert")).toContainText("결과를 확인");
  await expect(unsave).toBeEnabled();
  const serverChoice = await context.request.get("/resources/guest-saves?placeId=sample-place-1");
  expect(await serverChoice.json()).toMatchObject({ ok: true, saved: false });
  const retryWrite = page.waitForRequest((request) => request.method() === "POST" && request.url().includes("/resources/guest-saves"));
  await unsave.click();
  expect(new URLSearchParams((await retryWrite).postData()!).get("saved")).toBe("false");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(unsave).toBeEnabled();
  await page.screenshot({ path: `docs/evidence/cst-guest-save-20261113/${testInfo.project.name}-guest-saved.png`, fullPage: true });

  await page.getByRole("link", { name: "로그인하고 취향 남기기" }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fplaces%2Fsample-dongmyeong-ramen$/);
  await page.getByLabel("이메일", { exact: true }).fill(`e2e-onboarding-${testInfo.project.name}@retaste.local`);
  await page.getByLabel("비밀번호", { exact: true }).fill("local-onboarding-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${detail}$`));
  await expect(page.getByRole("button", { name: "저장됨", exact: true })).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === "retaste_guest")).toBe(false);
});

test("a failed login merge keeps the guest original and offers explicit retry on the return page", async ({ page, context }, testInfo) => {
  const userId = `e2e-onboarding-${testInfo.project.name}`;
  const trigger = `e2e_guest_merge_failure_${testInfo.project.name.replaceAll("-", "_")}`;
  await page.goto(detail);
  await page.getByRole("button", { name: "임시 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "임시 저장 해제", exact: true })).toBeEnabled();
  localD1(`CREATE TRIGGER ${trigger} BEFORE INSERT ON saved_places WHEN NEW.user_id='${userId}' BEGIN SELECT RAISE(ABORT,'synthetic guest merge failure'); END;`);
  try {
    await page.getByRole("link", { name: "로그인하고 취향 남기기" }).click();
    await page.getByLabel("이메일", { exact: true }).fill(`${userId}@retaste.local`);
    await page.getByLabel("비밀번호", { exact: true }).fill("local-onboarding-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${detail}$`));
    await expect(page.getByRole("button", { name: "임시 자료 다시 연결" })).toBeVisible();
    expect((await context.cookies()).some((cookie) => cookie.name === "retaste_guest")).toBe(true);
    await page.screenshot({ path: `docs/evidence/cst-guest-save-20261113/${testInfo.project.name}-merge-retry.png`, fullPage: true });
  } finally { localD1(`DROP TRIGGER IF EXISTS ${trigger};`); }
  await page.getByRole("button", { name: "임시 자료 다시 연결" }).click();
  await expect(page.getByRole("button", { name: "저장됨", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "임시 자료 다시 연결" })).toHaveCount(0);
  expect((await context.cookies()).some((cookie) => cookie.name === "retaste_guest")).toBe(false);
});

test("mobile detail sheet offers the same temporary save without leaving the list", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "The quick sheet is the mobile presentation");
  await page.goto("/places?bbox=126.80,35.10,127.00,35.25");
  await page.locator("section.discovery-all").getByRole("link", { name: /상세 보기$/ }).first().click();
  const dialog = page.getByRole("dialog", { name: /상세 정보$/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "임시 저장", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "임시 저장 해제", exact: true })).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe("/places");
  await page.screenshot({ path: "docs/evidence/cst-guest-save-20261113/mobile-sheet-saved.png", fullPage: true });
});

test("switching a saved mobile sheet to another place with a failed load does not reuse the previous save choice", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "The quick sheet is the mobile presentation");
  await page.goto("/places?bbox=126.80,35.10,127.00,35.25");
  const cards = page.locator("section.discovery-all").getByRole("link", { name: /상세 보기$/ });
  const secondHref = await cards.nth(1).getAttribute("href");
  expect(secondHref).toBeTruthy();
  await cards.first().click();
  const dialog = page.getByRole("dialog", { name: /상세 정보$/ });
  await dialog.getByRole("button", { name: "임시 저장", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "임시 저장 해제", exact: true })).toBeEnabled();
  const firstPlaceId = await dialog.locator('input[name="placeId"]').inputValue();
  let failedRead = false;
  await page.route("**/resources/guest-saves*", async (route) => {
    if (route.request().method() === "GET" && new URL(route.request().url()).searchParams.get("placeId") !== firstPlaceId && !failedRead) {
      failedRead = true;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, message: "합성 상태 조회 실패" }) });
    }
    return route.continue();
  });
  // Browser history can switch the sheet's route data without unmounting its slot.
  const next = new URL(page.url()); next.searchParams.set("place", secondHref!);
  await page.evaluate((url) => {
    const previous = window.history.state;
    window.history.pushState({ ...previous, idx: (previous?.idx ?? 0) + 1 }, "", url);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }, next.href);
  await expect(dialog.locator('input[name="placeId"]')).not.toHaveValue(firstPlaceId);
  await expect(dialog.getByRole("alert")).toBeVisible();
  const secondSave = dialog.getByRole("button", { name: "임시 저장", exact: true });
  await expect(secondSave).toBeDisabled();
  await dialog.getByRole("button", { name: "저장 상태 다시 확인", exact: true }).click();
  await expect(secondSave).toBeEnabled();
  const nextWrite = page.waitForRequest((request) => request.method() === "POST" && request.url().includes("/resources/guest-saves"));
  await secondSave.click();
  const fields = new URLSearchParams((await nextWrite).postData()!);
  expect(fields.get("saved")).toBe("true");
  expect(fields.get("placeId")).not.toBe(firstPlaceId);
});
