import { env } from "cloudflare:workers";
import { beforeEach,expect,it,vi } from "vitest";
import * as automaticReview from "../../app/features/places/place-review-auto-pipeline.server";
import { runScheduledCandidateSync } from "../../app/features/candidates/scheduled-sync.server";
import { commitFeatureFlagChange,isAutoReviewEnabled,prepareFeatureFlagChange,readAutoReviewControl } from "../../app/features/operations/admin-feature-stop.server";

beforeEach(async()=>{await env.DB.prepare("UPDATE admin_feature_stops SET stopped=0,version=0,updated_at=?,updated_by=NULL").bind(new Date().toISOString()).run();});
async function operator(){
 const actorUserId=crypto.randomUUID(),sessionId=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'ADMIN',?,?)").bind(actorUserId,`${actorUserId}@example.test`,"합성 관리자",now,now).run();
 await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)").bind(sessionId,actorUserId,now,"2099-01-01T00:00:00.000Z").run();
 return {actorUserId,sessionId,now};
}
async function assure(o:Awaited<ReturnType<typeof operator>>){await env.DB.prepare("INSERT INTO admin_session_assurances VALUES(?,?,'PASSWORD',?,?)").bind(o.sessionId,o.actorUserId,o.now,"2099-01-01T00:00:00.000Z").run();}
it("requires recent authentication and applies the stop only once across receipt replay",async()=>{
 const o=await operator();expect(await isAutoReviewEnabled(env.DB,"true")).toBe(true);
 const p=await prepareFeatureFlagChange(env.DB,{...o,stopped:true,reason:"자동 검수 중단 확인"},"true");
 expect(await isAutoReviewEnabled(env.DB,"true")).toBe(true);
 await expect(commitFeatureFlagChange(env.DB,{...o,operationId:p.operationId},"true")).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
 await assure(o);const result=await commitFeatureFlagChange(env.DB,{...o,operationId:p.operationId},"true");
 expect(result.current).toMatchObject({stopped:true,effective:false,version:1});
 expect((await commitFeatureFlagChange(env.DB,{...o,operationId:p.operationId},"true")).replayed).toBe(true);
 expect(await isAutoReviewEnabled(env.DB,"true")).toBe(false);
 expect((await env.DB.prepare("SELECT COUNT(*) n FROM admin_audit_logs WHERE target_id=? AND action='ADMIN_OPERATION_COMMITTED'").bind(p.operationId).first<{n:number}>())?.n).toBe(1);
});
it("restores only the current environment baseline and rejects changed previews",async()=>{
 const o=await operator();await assure(o);
 const one=await prepareFeatureFlagChange(env.DB,{...o,stopped:true,reason:"첫 중단"},"true");
 const stale=await prepareFeatureFlagChange(env.DB,{...o,stopped:true,reason:"경합 중단"},"true");
 await commitFeatureFlagChange(env.DB,{...o,operationId:one.operationId},"true");
 await expect(commitFeatureFlagChange(env.DB,{...o,operationId:stale.operationId},"true")).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
 await expect(prepareFeatureFlagChange(env.DB,{...o,stopped:false,reason:"잘못된 활성화"},"false")).rejects.toThrow("FEATURE_BASELINE_DISABLED");
 const restore=await prepareFeatureFlagChange(env.DB,{...o,stopped:false,reason:"중단 해제"},"true");
 await expect(commitFeatureFlagChange(env.DB,{...o,operationId:restore.operationId},"false")).rejects.toThrow("FEATURE_BASELINE_CHANGED");
 expect((await readAutoReviewControl(env.DB,"false")).effective).toBe(false);
 expect((await commitFeatureFlagChange(env.DB,{...o,operationId:restore.operationId},"true")).current).toMatchObject({version:2,stopped:false,effective:true});
 expect((await commitFeatureFlagChange(env.DB,{...o,operationId:one.operationId},"true")).current).toMatchObject({version:2,stopped:false,effective:true});
});
it("fails closed on missing or unreadable control state and never overrides an off baseline",async()=>{
 const broken={prepare(){throw new Error("storage failure");}} as unknown as D1Database;
 expect(await isAutoReviewEnabled(broken,"true")).toBe(false);
 expect(await isAutoReviewEnabled(broken,"false")).toBe(false);
 expect(await readAutoReviewControl(broken,"true")).toMatchObject({available:false,effective:false,canRestore:false});
 await env.DB.prepare("DELETE FROM admin_feature_stops").run();
 expect(await isAutoReviewEnabled(env.DB,"true")).toBe(false);
 await env.DB.prepare("INSERT INTO admin_feature_stops VALUES('REVIEW_AUTO_PIPELINE_ENABLED',0,0,?,NULL)").bind(new Date().toISOString()).run();
 expect(await isAutoReviewEnabled(env.DB,"false")).toBe(false);
});


it("gates the actual scheduled auto-review entry while preserving public collection",async()=>{
 const pipeline=vi.spyOn(automaticReview,"runAutoReviewPipeline").mockResolvedValue({} as never);
 const provider=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>Response.json({response:{header:{resultCode:"0"},body:{totalCount:0,items:{item:[]}}}}));
 const settings={...env,DATA_GO_KR_SERVICE_KEY:"synthetic",NAVER_LOCAL_SEARCH_ENABLED:"true",NAVER_API_HUB_KEY_ID:"synthetic",NAVER_API_HUB_KEY:"synthetic",REVIEW_AUTO_PIPELINE_ENABLED:"true"} as never;
 try{
  await runScheduledCandidateSync(settings);
  expect(pipeline).toHaveBeenCalledTimes(1);
  await env.DB.prepare("UPDATE admin_feature_stops SET stopped=1,version=version+1").run();
  await runScheduledCandidateSync(settings);
  expect(pipeline).toHaveBeenCalledTimes(1);
  expect(provider).toHaveBeenCalledTimes(2);
 }finally{pipeline.mockRestore();provider.mockRestore();}
});
