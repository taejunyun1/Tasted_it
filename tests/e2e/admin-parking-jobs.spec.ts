import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const localD1 = (sql: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", sql], { encoding: "utf8" });

test("parking job controls preserve active data and distinguish queued and unknown outcomes", async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.BASE_URL), "Requires isolated local D1 fixtures");
  const suffix = testInfo.project.name === "chromium" ? "desktop" : "mobile";
  const prefix = `qa-parking-${suffix}`;
  const active = `${prefix}-active`, pending = `${prefix}-pending`, failed = `${prefix}-failed`, legacy = `${prefix}-legacy`;
  const ids = `'${active}','${pending}','${failed}','${legacy}'`;
  const now = new Date().toISOString();
  localD1(`DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';
    DELETE FROM parking_sync_runs WHERE id IN (${ids}); DELETE FROM parking_data_snapshots WHERE id IN (${ids});
    INSERT INTO parking_data_snapshots(id,source,status,row_count,created_at,updated_at,activated_at) VALUES
    ('${active}','PARKING','ACTIVE',99,'${now}','${now}','${now}'),
    ('${pending}','PARKING','STAGING',7,'${now}','${now}',NULL),
    ('${failed}','EV','FAILED',3,'${now}','${now}',NULL),
    ('${legacy}','PARKING','STAGING',2,'${now}','${now}',NULL);
    INSERT INTO parking_sync_runs(id,source,status,snapshot_id,attempts,lease_version,lease_expires_at,started_at,created_at,updated_at,next_page,fetched_count,accepted_count,skipped_count) VALUES
    ('${pending}','PARKING','PENDING','${pending}',1,0,NULL,'${now}','${now}','${now}',2,10,7,3),
    ('${failed}','EV','FAILED','${failed}',1,1,NULL,'${now}','${now}','${now}',1,5,3,2),
    ('${legacy}','PARKING','RUNNING','${legacy}',1,0,NULL,'${now}','${now}','${now}',1,2,2,0);`);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 500) errors.push(`HTTP ${response.status()}`); });
  try {
    await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
    const response = await page.goto(`/admin/jobs/parking?run=${pending}`);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading", { name: "주차·EV 작업", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "현재 사용 자료" })).toContainText(active);
    const detail = page.getByRole("region", { name: "선택한 작업" });
    await detail.getByRole("textbox", { name: "변경 사유" }).fill("합성 주차 수집 취소 검증");
    await detail.getByRole("button", { name: "수집 취소 미리보기", exact: true }).click();
    const preview = page.getByRole("region", { name: "작업 변경 미리보기" });
    await expect(preview).toContainText(pending);
    await expect(preview).toContainText("아직 작업을 변경하지 않았습니다.");
    await preview.screenshot({ path: testInfo.outputPath("parking-preview.png") });
    await preview.getByRole("button", { name: "작업 변경 확정", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/reauth\?returnTo=/);
    const returnTo = new URL(page.url()).searchParams.get("returnTo")!;
    expect(returnTo).toContain("/admin/jobs/parking?");
    const verifiedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 300_000).toISOString();
    localD1(`INSERT OR REPLACE INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES('qa-admin-session','qa-admin','PASSWORD','${verifiedAt}','${expiresAt}');`);
    await page.goto(returnTo);
    await page.getByRole("region", { name: "작업 변경 미리보기" }).getByRole("button", { name: "작업 변경 확정", exact: true }).click();
    await expect(detail).toContainText("CANCELLED");
    await expect(page.getByRole("link", { name: "변경 영수증 보기" })).toBeVisible();
    await expect(page.getByRole("region", { name: "현재 사용 자료" })).toContainText(`${active}`);
    await expect(page.getByRole("region", { name: "현재 사용 자료" })).toContainText("99건");

    await page.goto(`/admin/jobs/parking?run=${failed}`);
    await detail.getByRole("textbox", { name: "변경 사유" }).fill("합성 EV 수집 재시도 검증");
    await detail.getByRole("button", { name: "재시도 미리보기", exact: true }).click();
    await page.getByRole("region", { name: "작업 변경 미리보기" }).getByRole("button", { name: "작업 변경 확정", exact: true }).click();
    await expect(detail).toContainText("PENDING");
    await expect(detail).toContainText("수집 대기");
    await expect(detail).not.toContainText("수집 완료");
    await expect(page.getByText("변경 접수는 수집 완료가 아닙니다.", { exact: false })).toBeVisible();

    await page.goto(`/admin/jobs/parking?run=${legacy}`);
    await expect(detail).toContainText("실행 상태 미확인 (RUNNING)");
    await expect(detail).toContainText("이전 실행의 소유권을 확인할 수 없어 자동 재실행할 수 없습니다.");
    await expect(detail.getByRole("button")).toHaveCount(0);
    await expect(detail).not.toContainText("수집 중");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.screenshot({ path: testInfo.outputPath("parking-jobs.png"), fullPage: true });
  } finally {
    localD1(`DELETE FROM parking_sync_runs WHERE id IN (${ids}); DELETE FROM parking_data_snapshots WHERE id IN (${ids}); DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';`);
  }
});

test("member cannot read parking job controls", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-reviewer-member-session", domain: "127.0.0.1", path: "/" }]);
  const response = await page.goto("/admin/jobs/parking");
  expect(response?.status()).toBe(403);
  expect(response?.headers()["cache-control"]).toContain("no-store");
});
