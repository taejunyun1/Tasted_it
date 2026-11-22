import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { isControlledLocalBaseUrl } from "./local-test-target";

test.skip(!isControlledLocalBaseUrl() || process.env.CST_B09_QUOTA_FAULT_INJECTION !== "1", "Requires an isolated local D1 copy");

function sql(command: string) {
  return execFileSync(process.execPath, [
    "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
    "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", command,
  ], { stdio: "pipe" });
}

test("the B09 queue remains selectable while NAVER usage is unavailable", async ({ context, page, baseURL }, info) => {
  test.setTimeout(60_000);
  const fixture = `qa-b09-quota-${info.project.name}`;
  const name = `B09 합성 검수 ${info.project.name}`;
  const date = "2026-11-01T00:00:00.000Z";
  const path = `/admin/place-operations?step=1&q=${encodeURIComponent(name)}`;
  let unavailable = false;
  const restore = () => {
    if (!unavailable) return;
    sql("ALTER TABLE qa_unavailable_provider_daily_quotas RENAME TO provider_daily_quotas");
    unavailable = false;
  };

  await page.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
  await context.addCookies([{ name: "retaste_session", value: "qa-admin-session", url: baseURL! }]);
  try {
    sql(`INSERT INTO business_licenses(id,source_type,source_management_no,business_name,normalized_status,road_address,region_code,raw_payload,first_seen_at,last_seen_at,created_at,updated_at) VALUES('${fixture}','GENERAL_RESTAURANT','${fixture}','${name}','OPEN','광주광역시 동구 합성로 1','GWANGJU','{}','${date}','${date}','${date}','${date}');
      INSERT INTO place_review_work_items(id,business_license_id,source_kind,stage,status,stage_version,created_at,updated_at) VALUES('${fixture}-work','${fixture}','PUBLIC_DATA','SOURCE_REVIEW','ACTIVE',0,'${date}','${date}');`);

    expect((await page.goto(path))?.status()).toBe(200);
    const quota = page.locator(".place-review-quota");
    const actualUsage = quota.locator("strong");
    await expect(actualUsage.first()).toContainText(/\d[\d,]* \/ \d[\d,]*회/);
    const before = await actualUsage.allTextContents();
    await expect(page.getByRole("checkbox", { name: `${name} 선택`, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("b09-quota-available.png"), fullPage: true });

    sql("ALTER TABLE provider_daily_quotas RENAME TO qa_unavailable_provider_daily_quotas");
    unavailable = true;
    expect((await page.reload())?.status()).toBe(200);
    await expect(quota.getByRole("status")).toHaveText("NAVER 사용량을 불러오지 못했습니다.");
    await expect(actualUsage).toHaveCount(0);
    await page.getByRole("checkbox", { name: `${name} 선택`, exact: true }).check();
    await expect(page.getByRole("button", { name: "수동으로 NAVER 검증 대기로 이동", exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath("b09-quota-unavailable.png"), fullPage: true });

    restore();
    expect((await page.reload())?.status()).toBe(200);
    await expect(quota.getByRole("status")).toHaveCount(0);
    expect(await actualUsage.allTextContents()).toEqual(before);
  } finally {
    restore();
    sql(`DELETE FROM place_review_work_items WHERE id='${fixture}-work'; DELETE FROM business_licenses WHERE id='${fixture}';`);
  }
});
