import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

function sql(command: string) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", command], { stdio: "pipe" });
}
test("bounded CSV downloads and read-only policy versions work on desktop and mobile", async ({ page, context, baseURL }, testInfo) => {
  const now = new Date().toISOString();
  const prefix = `records-${testInfo.project.name}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  sql(`DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';
    INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at) VALUES
    ('${prefix}-1','qa-admin','APPROVE_CANDIDATE','USER','private-target','private-payload','${now}'),
    ('${prefix}-2','qa-admin','APPROVE_CANDIDATE','USER','private-target','private-payload','${now}');`);
  try {
    await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
    const response = await page.goto("/admin/records");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading", { name: "기록 내보내기·정책 문서", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "CSV 생성", exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: /현재 원문 보기/ })).toHaveCount(2);
    await expect(page.getByText("실제 운영주체와 개인정보 보호책임자·문의처", { exact: true })).toBeVisible();
    sql(`INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES('qa-admin-session','qa-admin','PASSWORD','${now}','2099-01-01T00:00:00.000Z');`);
    await page.reload();
    await page.getByLabel("최대 행 수").fill("1");
    await page.getByRole("button", { name: "CSV 생성", exact: true }).click();
    await expect(page.getByRole("heading", { name: "CSV 생성됨 · 1건" })).toBeVisible();
    await expect(page.getByText("행 상한에 도달해 나머지 기록이 있습니다.", { exact: false })).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV 다운로드", exact: true }).click();
    const download = await downloaded;
    const csv = await readFile((await download.path())!, "utf8");
    expect(csv).toContain("기록 참조");
    expect(csv).not.toMatch(/private-|qa-admin|payload|@/);
    await page.getByRole("button", { name: "같은 조건의 다음 페이지 생성" }).click();
    await expect(page.getByRole("heading", { name: "CSV 생성됨 · 1건" })).toBeVisible();
    await expect(page.getByText("이 조건의 마지막 페이지입니다.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("heading", { name: "기록 내보내기·정책 문서", level: 1 }).click();
    await page.screenshot({ path: testInfo.outputPath("admin-records.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    sql(`DELETE FROM admin_audit_logs WHERE id IN ('${prefix}-1','${prefix}-2') OR (action='ADMIN_AUDIT_EXPORT' AND actor_user_id='qa-admin' AND created_at>='${now}'); DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';`);
  }
});
