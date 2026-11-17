import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const localD1 = (sql: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { encoding: "utf8" });
test("reads stale RSI and previews an alert without claiming recovery", async ({ page, context, baseURL }, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "isolated local fixtures only");
  const now = new Date().toISOString(), id = `qa-reliability-${testInfo.project.name}`;
  const paths = ["/", "/places", "/login", "/admin", "/robots.txt", "/privacy"].map((path) => ({ path, status: path === "/admin" ? 302 : 200, ok: true }));
  localD1(`INSERT INTO admin_audit_logs(id,action,target_type,target_id,after_state,created_at) VALUES('${id}-rsi','RSI_SELF_CHECK','OPERATIONS','rsi-scheduled','${JSON.stringify({ trigger: "scheduled", ok: true, failed: 0, paths })}','2026-11-01T00:00:00.000Z');
    INSERT INTO operational_alerts(id,alert_type,severity,status,source_id,message,details_json,first_occurred_at,last_occurred_at) VALUES('${id}','PUBLIC_DATA_SYNC','ERROR','OPEN','private-source','private-error','{"private":"detail"}','${now}','${now}');`);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  const response = await page.goto("/admin/reliability");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading", { name: "점검·경보·검증 근거", exact: true })).toBeVisible();
  await expect(page.getByText("최근 정기 점검:", { exact: false })).toContainText("오래됨");
  expect(await page.content()).not.toMatch(/private-source|private-error|private.*detail/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("reliability.png"), fullPage: true });
  await page.getByLabel("처리 사유").first().fill("합성 검토 이력을 기록합니다");
  await page.getByRole("button", { name: "검토 처리 미리보기" }).first().click();
  await expect(page.getByRole("heading", { name: "경보 처리 미리보기" })).toBeVisible();
  await expect(page.getByText("이 작업은 경보를 검토 처리로 표시합니다.", { exact: false })).toContainText("실제 장애 회복");
  await page.getByRole("button", { name: "검토 처리 확정" }).click();
  await expect(page).toHaveURL(/\/admin\/reauth/);
  expect(errors).toEqual([]);
});
test("blocks a non-admin reader", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", url: baseURL! }]);
  const response = await page.goto("/admin/reliability");
  expect(response?.status()).toBe(403);
  expect(response?.headers()["cache-control"]).toContain("no-store");
});
