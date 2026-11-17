import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("admin previews and cancels one pending public sync while member access is denied", async ({ page }, info) => {
  test.skip(Boolean(process.env.BASE_URL) && !process.env.BASE_URL?.startsWith("http://127.0.0.1"), "Synthetic local fixtures only");
  const id = `qa-public-sync-${info.project.name}`, now = new Date().toISOString();
  const sql = (query: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", query], { encoding: "utf8" });
  sql(`DELETE FROM public_data_sync_runs WHERE id='${id}'; INSERT INTO public_data_sync_runs(id,source_type,region_code,address_field,status,next_page,started_at,created_at,updated_at) VALUES('${id}','BAKERY','GWANGJU_JEONNAM','ROAD_NM_ADDR','PENDING',7,'${now}','${now}','${now}'); DELETE FROM public_data_sync_runs WHERE id='${id}-legacy'; INSERT INTO public_data_sync_runs(id,source_type,region_code,address_field,status,next_page,started_at,created_at,updated_at) VALUES('${id}-legacy','BAKERY','GWANGJU_JEONNAM','ROAD_NM_ADDR','RUNNING',4,'${now}','${now}','${now}'); INSERT OR REPLACE INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES('qa-admin-session','qa-admin','PASSWORD','${now}','2099-01-01T00:00:00.000Z');`);
  try {
    await page.context().addCookies([{ name:"retaste_session", value:"qa-reviewer-member-session", domain:"127.0.0.1", path:"/" }]);
    expect((await page.goto("/admin/data-sync"))?.status()).toBe(403);
    await page.context().addCookies([{ name:"retaste_session", value:"qa-admin-session", domain:"127.0.0.1", path:"/" }]);
    const response = await page.goto("/admin/data-sync"); expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading",{name:"공공데이터 동기화",exact:true})).toBeVisible();
    const row=page.locator("article").filter({has:page.getByText(`작업 ID: ${id}`,{exact:true})});
    const legacy=page.locator("article").filter({has:page.getByText(`작업 ID: ${id}-legacy`,{exact:true})});
    await expect(legacy).toContainText("결과 불명");
    await expect(legacy.getByRole("button",{name:"취소 미리보기"})).toBeDisabled();
    await row.getByLabel("처리 사유").fill("합성 대기 작업 취소 검증");
    await row.getByRole("button",{name:"취소 미리보기"}).click();
    const preview=page.getByRole("region",{name:"동기화 실행 확인"});
    await expect(preview).toContainText(id); await expect(preview).toContainText("이미 허용된 외부 요청");
    await preview.screenshot({path:info.outputPath("public-sync-preview.png")});
    await preview.getByRole("button",{name:"확인 후 반영"}).click();
    await expect(page.getByRole("status")).toContainText("현재 작업: 취소");
    await expect(row).toContainText("제과점 · 취소");
    await expect(row.getByRole("button",{name:"취소 미리보기"})).toBeDisabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath("public-sync-cancelled.png"),fullPage:true});
  } finally { sql(`DELETE FROM public_data_sync_runs WHERE id IN ('${id}','${id}-legacy'); DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';`); }
});
