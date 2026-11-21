import {execFileSync} from "node:child_process";
import { expect,test } from "@playwright/test";

test("settings keep values private and only control the next automatic review entry",async({page},info)=>{
 const sql=(query:string)=>execFileSync("pnpm",["exec","wrangler","d1","execute","DB","--local","--config","wrangler.e2e.jsonc","--persist-to",".wrangler/e2e-state","--command",query],{encoding:"utf8"});
 const now=new Date().toISOString();
 sql(`UPDATE admin_feature_stops SET stopped=0,version=0,updated_at='${now}',updated_by=NULL; INSERT OR REPLACE INTO admin_session_assurances VALUES('qa-admin-session','qa-admin','PASSWORD','${now}','2099-01-01T00:00:00.000Z');`);
 try{
  await page.context().addCookies([{name:"retaste_session",value:"qa-reviewer-member-session",domain:"127.0.0.1",path:"/"}]);
  expect((await page.goto("/admin/settings"))?.status()).toBe(403);
  await page.context().addCookies([{name:"retaste_session",value:"qa-admin-session",domain:"127.0.0.1",path:"/"}]);
  const response=await page.goto("/admin/settings");expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading",{name:"설정 상태",exact:true})).toBeVisible();
  const main=page.getByRole("main");await expect(main.locator("article")).toHaveCount(13);
  await expect(main.locator("article").filter({hasText:"PLACE_CATEGORY_V5_ENABLED"})).toContainText("사용되지 않음");
  await expect(main).toContainText("설정 주입 경로·배포 버전");
  await page.getByLabel("처리 사유").fill("합성 자동 검수 중단 검증");
  await page.getByRole("button",{name:"중단 미리보기",exact:true}).click();
  await page.getByRole("button",{name:"확인 후 반영",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("현재 자동 검수 차단");
  await page.screenshot({path:info.outputPath("settings-stopped.png"),fullPage:true});
  await page.getByLabel("처리 사유").fill("합성 중단 해제 검증");
  await page.getByRole("button",{name:"중단 해제 미리보기",exact:true}).click();
  await page.getByRole("button",{name:"확인 후 반영",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("현재 자동 검수 허용");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("settings-restored.png"),fullPage:true});
 }finally{sql(`UPDATE admin_feature_stops SET stopped=0,version=0,updated_at='${now}',updated_by=NULL; DELETE FROM admin_session_assurances WHERE session_id='qa-admin-session';`);}
});
