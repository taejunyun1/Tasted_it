import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const sql = (command: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", command], { stdio: "pipe" });
test("shows aggregate lifecycle samples and unknown history without cleanup controls", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!["127.0.0.1", "localhost"].includes(new URL(baseURL!).hostname), "local fixtures only");
  const id = `private-lifecycle-${testInfo.project.name}`, now = new Date().toISOString();
  sql(`INSERT INTO guest_taste_sessions(id,expires_at,created_at,updated_at) VALUES('${id}','2020-01-01T00:00:00.000Z','${now}','${now}');`);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
    const response = await page.goto("/admin/lifecycle");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading", { name: "비회원·보존 정리 현황", exact: true })).toBeVisible();
    await expect(page.getByText("표본 1행 · 현재 저장 행 전체")).toBeVisible();
    await expect(page.getByText("저장된 관측 없음", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /삭제|정리|승계/ })).toHaveCount(0);
    expect(await page.content()).not.toContain(id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("heading", { name: "비회원·보존 정리 현황", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("admin-lifecycle.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally { sql(`DELETE FROM guest_taste_sessions WHERE id='${id}';`); }
});
