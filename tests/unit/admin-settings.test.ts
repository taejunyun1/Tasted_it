import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { ADMIN_SETTING_DEFINITIONS, readAdminSettings } from "../../app/features/operations/admin-settings.server";

describe("safe administrator settings",()=>{
 it("reads only allowlisted fields and never returns invalid raw values or credentials",()=>{
  const read:string[]=[];
  const source:Record<string,unknown>={ONBOARDING_ENABLED:"true",NAVER_LOCAL_SEARCH_ENABLED:"bad-secret-value",UNLISTED:"private-unlisted",RESEND_API_KEY:"private-credential"};
  const values=new Proxy(source,{get:(target,key)=>{read.push(String(key));return target[String(key)];}});
  const result=readAdminSettings(values,"2026-11-18T01:00:00.000Z");
  expect(read).toEqual(ADMIN_SETTING_DEFINITIONS.map(item=>item.key));
  const encoded=JSON.stringify(result);
  for(const value of ["bad-secret-value","private-unlisted","private-credential","RESEND_API_KEY"]) expect(encoded).not.toContain(value);
  expect(result.settings.find(row=>row.key==="NAVER_LOCAL_SEARCH_ENABLED")).toMatchObject({received:"INVALID",effect:"DISABLED"});
 });
 it("matches the documented defaults to the committed worker configuration",()=>{
  const config=readFileSync(new URL("../../wrangler.jsonc",import.meta.url),"utf8");
  for(const item of ADMIN_SETTING_DEFINITIONS){
   const match=new RegExp(`"${item.key}"\\s*:\\s*"([^"\\n]*)"`).exec(config);
   expect(match?.[1]??null,item.key).toBe(item.expected);
  }
 });
 it("distinguishes absent, invalid fail-closed, and flags with no consumer",()=>{
  const defaults=readAdminSettings({},"2026-11-18T01:00:00.000Z");
  expect(defaults.settings.find(row=>row.key==="CST_MAINTENANCE")).toMatchObject({received:"MISSING",effect:"DISABLED"});
  expect(readAdminSettings({CST_MAINTENANCE:"invalid"},"2026-11-18T01:00:00.000Z").settings[0]).toMatchObject({received:"INVALID",effect:"ENABLED"});
  expect(readAdminSettings({PLACE_CATEGORY_V5_ENABLED:"true"},"2026-11-18T01:00:00.000Z").settings.find(row=>row.key==="PLACE_CATEGORY_V5_ENABLED")).toMatchObject({received:"TRUE",effect:"UNUSED"});
  expect(readAdminSettings({KAKAO_PLACE_VERIFICATION_MODE:"true"},"2026-11-18T01:00:00.000Z").settings.find(row=>row.key==="KAKAO_PLACE_VERIFICATION_MODE")).toMatchObject({received:"INVALID",effect:"OBSERVE"});
 });
});
