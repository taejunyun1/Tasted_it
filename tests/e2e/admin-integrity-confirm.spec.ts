import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("integrity confirmation preserves the target through recent-auth navigation", async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "Requires isolated local D1 fixtures");
  const caseId = `qa-confirm-${testInfo.project.name}`;
  const sql = (statement: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", statement], { encoding: "utf8" });
  sql(`DELETE FROM integrity_cases WHERE id='${caseId}'; INSERT INTO integrity_cases(id,signal_type,subject_type,subject_id,dedupe_key,status,evidence_json,created_at,updated_at) VALUES('${caseId}','SYNTHETIC','USER','qa-admin','${caseId}','OPEN','{}','2026-11-14T00:00:00.000Z','2026-11-14T00:00:00.000Z');`);
  try {
    await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
    const response = await page.goto("/admin/ratings");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    const item = page.locator(".integrity-case").filter({ has: page.locator(`input[name="caseId"][value="${caseId}"]`) });
    await item.getByPlaceholder("처리 사유").fill("합성 사건 확인");
    await item.getByRole("button", { name: "조작 확인", exact: true }).click();
    await expect(page.getByRole("heading", { name: "사건 처리 실행 확인" })).toBeVisible();
    const preview = page.getByRole("status").filter({ hasText: "사건 처리 실행 확인" });
    await expect(preview).toContainText(caseId);
    await expect(preview).toContainText("OPEN → CONFIRMED");
    await preview.screenshot({ path: testInfo.outputPath("integrity-preview.png") });
    await preview.getByRole("button", { name: "확인 후 반영", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/reauth\?returnTo=/);
    await expect(page.getByRole("heading", { name: "관리자 재인증" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("returnTo")).toContain("operationKind=INTEGRITY_CASE_TRANSITION");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { sql(`DELETE FROM integrity_cases WHERE id='${caseId}';`); }
});
