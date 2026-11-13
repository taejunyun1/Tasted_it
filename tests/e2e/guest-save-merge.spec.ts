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
