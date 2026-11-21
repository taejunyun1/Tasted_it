import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl(), "Uses disposable users in the isolated local Worker only");
function sql(query: string) {
  return execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", query], { stdio: "pipe" });
}
for (const committed of [false, true]) {
  test(`withdrawal ${committed ? "committed response loss" : "pre-delivery failure"} waits for an explicit authentication check`, async ({ page, context, baseURL }, info) => {
    const id = `withdraw-${randomUUID()}`, session = `withdraw-session-${randomUUID()}`;
    const now = new Date().toISOString(), expires = new Date(Date.now() + 3_600_000).toISOString();
    sql(`INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES('${id}','${id}@example.test','합성 탈퇴 검증','USER','${now}','${now}','${now}'); INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES('${session}','${id}','${expires}','${now}');`);
    await context.addCookies([{ name: "retaste_session", value: session, url: baseURL! }]);
    await page.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
    let posts = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const routePattern = (url: URL) => url.pathname === "/me" || url.pathname === "/me.data";
    await page.route(routePattern, async route => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      await gate;
      if (committed) await route.fetch({ maxRedirects: 0 });
      await route.abort("failed");
    });
    try {
      await page.goto("/me");
      await page.locator(".member-withdraw summary").click();
      const form = page.locator(".member-withdraw form");
      await form.getByRole("textbox").fill("탈퇴합니다");
      const submit = form.getByRole("button", { name: "탈퇴하기", exact: true });
      const click = submit.click();
      await expect(form.getByRole("button", { name: "탈퇴 처리 중…", exact: true })).toBeDisabled();
      await expect(form.getByRole("textbox")).toBeDisabled();
      await form.evaluate(node => (node as HTMLFormElement).requestSubmit());
      expect(posts).toBe(1);
      release(); await click;
      const alert = page.locator(".member-withdraw [role=alert]");
      await expect(alert).toContainText("탈퇴 처리 결과를 확인하지 못했습니다");
      await expect(alert).toBeFocused();
      await expect(form.getByRole("button", { name: "탈퇴하기", exact: true })).toBeDisabled();
      await form.evaluate(node => (node as HTMLFormElement).requestSubmit());
      expect(posts).toBe(1);
      await page.screenshot({ path: info.outputPath(`withdraw-${committed ? "committed" : "uncommitted"}-unknown.png`), fullPage: true });
      await page.unroute(routePattern);
      await page.getByRole("button", { name: "현재 로그인 상태 확인", exact: true }).click();
      if (committed) {
        await expect(page).toHaveURL(/\/login\?returnTo=%2Fme$/);
        await expect(page.getByText("합성 탈퇴 검증", { exact: true })).toHaveCount(0);
      } else {
        await expect(page).toHaveURL(/\/me$/);
        await expect(page.getByText("합성 탈퇴 검증", { exact: true })).toBeVisible();
        await page.locator(".member-withdraw summary").click();
        await expect(page.getByRole("button", { name: "탈퇴하기", exact: true })).toBeEnabled();
        await page.locator(".member-withdraw input[name=confirm]").fill("탈퇴합니다");
        await page.getByRole("button", { name: "탈퇴하기", exact: true }).click();
        await expect(page).toHaveURL(`${baseURL}/`);
        expect((await context.cookies()).some(cookie => cookie.name === "retaste_session")).toBe(false);
        await page.goto("/me");
        await expect(page).toHaveURL(/\/login\?returnTo=%2Fme$/);
      }
      expect(posts).toBe(1);
      await page.screenshot({ path: info.outputPath(`withdraw-${committed ? "committed" : "uncommitted"}-checked.png`), fullPage: true });
    } finally {
      release();
      sql(`DELETE FROM sessions WHERE user_id='${id}'; DELETE FROM users WHERE id='${id}';`);
    }
  });
}
