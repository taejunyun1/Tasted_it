import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

function localD1(sql: string) {
  return execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { encoding: "utf8" });
}
const detail = "/places/sample-dongmyeong-ramen";
test.beforeEach(async ({}, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "Local synthetic D1 only");
  const userId = `e2e-onboarding-${testInfo.project.name}`;
  localD1(`DELETE FROM saved_places WHERE user_id='${userId}'; DELETE FROM member_save_choices WHERE user_id='${userId}';`);
});

test("a committed save with a lost response asks to check the current state", async ({ page }, testInfo) => {
  await page.goto(detail);
  await page.getByRole("button", { name: "임시 저장", exact: true }).click();
  const unsave = page.getByRole("button", { name: "임시 저장 해제", exact: true });
  await expect(unsave).toBeEnabled();
  let committed = false;
  await page.route("**/resources/guest-saves*", async (route) => {
    if (!committed && route.request().method() === "POST") {
      // Let the server commit, then discard only its response to this browser.
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = true;
      return route.abort("failed");
    }
    return route.continue();
  });
  await unsave.click();
  await expect(page.getByRole("alert")).toContainText("새로고침해 현재 상태를 확인");
  expect(committed).toBe(true);
  await page.screenshot({ path: `docs/evidence/guest-response-copy-20261113/${testInfo.project.name}-response-lost.png`, fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "임시 저장", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "임시 저장 해제", exact: true })).toHaveCount(0);
});

test("the merge banner offers an explicit retry after checking the current state", async ({ page }, testInfo) => {
  const userId = `e2e-onboarding-${testInfo.project.name}`;
  const trigger = `e2e_response_copy_${testInfo.project.name.replaceAll("-", "_")}`;
  await page.goto(detail);
  await page.getByRole("button", { name: "임시 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "임시 저장 해제", exact: true })).toBeEnabled();
  localD1(`CREATE TRIGGER ${trigger} BEFORE INSERT ON saved_places WHEN NEW.user_id='${userId}' BEGIN SELECT RAISE(ABORT,'synthetic merge failure for copy'); END;`);
  try {
    await page.getByRole("link", { name: "로그인하고 취향 남기기" }).click();
    await page.getByLabel("이메일", { exact: true }).fill(`${userId}@retaste.local`);
    await page.getByLabel("비밀번호", { exact: true }).fill("local-onboarding-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${detail}$`));
    const banner = page.getByRole("complementary", { name: "임시 자료 계정 연결" });
    await expect(banner).toContainText("계정 연결 상태를 확인");
    await expect(banner.getByRole("button", { name: "임시 자료 다시 연결" })).toBeEnabled();
    await page.screenshot({ path: `docs/evidence/guest-response-copy-20261113/${testInfo.project.name}-merge-retry.png`, fullPage: true });
  } finally { localD1(`DROP TRIGGER IF EXISTS ${trigger};`); }
  await page.reload();
  await page.getByRole("button", { name: "임시 자료 다시 연결" }).click();
  await expect(page.getByRole("button", { name: "저장됨", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "임시 자료 계정 연결" })).toHaveCount(0);
});
