import { env } from "cloudflare:workers";
import { beforeEach,expect,it,vi } from "vitest";
import { AUTO_PIPELINE_ACTOR_ID } from "../../app/features/places/place-review-auto-pipeline.server";
import { runScheduledCandidateSync } from "../../app/features/candidates/scheduled-sync.server";
import { commitFeatureFlagChange,isAutoReviewEnabled,prepareFeatureFlagChange,readAutoReviewControl } from "../../app/features/operations/admin-feature-stop.server";
import { parseActivityQuery } from "../../app/features/operations/admin-activity";
import { readAdminActivity } from "../../app/features/operations/admin-activity.server";

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
 const activity=await readAdminActivity(env.DB,parseActivityQuery(new URLSearchParams({view:"operations",kind:"FEATURE_FLAG_CONTROL",operation:p.operationId}),o.now),o.now);
 expect(activity.detail).toMatchObject({title:"자동 검수 중단·해제",auditLinked:true,state:"COMMITTED"});
 expect(JSON.stringify(activity)).not.toContain("자동 검수 중단 확인");
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


it("stops and restores scheduled review transitions while public collection continues", async () => {
  const sources = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] as const;
  const [beforeStop, whileStopped, afterRestore, baselineOff] = sources;
  const collected: string[] = [];
  let currentSource = beforeStop;
  const provider = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const { origin, pathname } = new URL(String(input));
    if (origin === "https://naverapihub.apigw.ntruss.com" && pathname === "/search/v1/local") {
      return Response.json({ total: 0, items: [] });
    }
    if (origin !== "https://apis.data.go.kr" || pathname !== "/1741000/general_restaurants/info") {
      throw new Error("Unexpected provider request");
    }
    collected.push(currentSource);
    return Response.json({
      response: {
        header: { resultCode: "0" },
        body: { totalCount: 1, items: { item: [{
          MNG_NO: currentSource, BPLC_NM: `합성 식당 ${currentSource}`, BZSTAT_SE_NM: "한식",
          ROAD_NM_ADDR: "광주광역시 동구 합성로 1", CRD_INFO_X: 191724, CRD_INFO_Y: 183438,
          SALS_STTS_CD: "01", SALS_STTS_NM: "영업/정상", DTL_SALS_STTS_CD: "01", DTL_SALS_STTS_NM: "영업",
        }] } },
      },
    });
  });
  const settings = {
    ...env,
    DATA_GO_KR_SERVICE_KEY: "synthetic",
    NAVER_LOCAL_SEARCH_ENABLED: "true",
    NAVER_API_HUB_KEY_ID: "synthetic",
    NAVER_API_HUB_KEY: "synthetic",
    REVIEW_CONFIDENT_ADVANCE_ENABLED: "true",
  };
  const tick = async (source: string, baseline: "true" | "false" = "true") => {
    currentSource = source;
    // Generated bindings describe the configured literal, but the scheduler also accepts an off baseline at runtime.
    await runScheduledCandidateSync({ ...settings, REVIEW_AUTO_PIPELINE_ENABLED: baseline } as Parameters<typeof runScheduledCandidateSync>[0]);
  };
  const review = (source: string) => env.DB.prepare(`
    SELECT items.id,items.stage,items.stage_version,items.last_transition_by
    FROM place_review_work_items AS items
    JOIN business_licenses AS licenses ON licenses.id=items.business_license_id
    WHERE licenses.source_management_no=? AND items.source_kind='PUBLIC_DATA' AND items.status='ACTIVE'
  `).bind(source).first<{ id: string; stage: string; stage_version: number; last_transition_by: string | null }>();
  const advanced = { stage: "NAVER_VERIFICATION", stage_version: 1, last_transition_by: AUTO_PIPELINE_ACTOR_ID };
  const waiting = { stage: "SOURCE_REVIEW", stage_version: 0, last_transition_by: null };
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    // UTC day 24 always selects the restaurant road-address collection job.
    vi.setSystemTime("2026-11-24T09:00:00.000Z");
    const o = await operator();
    await assure(o);
    await tick(beforeStop);
    expect(await review(beforeStop)).toMatchObject(advanced);

    const stop = await prepareFeatureFlagChange(env.DB, { ...o, stopped: true, reason: "합성 자동 검수 중단" }, "true");
    expect((await commitFeatureFlagChange(env.DB, { ...o, operationId: stop.operationId }, "true")).current)
      .toMatchObject({ stopped: true, effective: false, version: 1 });
    await tick(whileStopped);
    const paused = await review(whileStopped);
    expect(paused).toMatchObject(waiting);

    const resume = { ...o, stopped: false, reason: "합성 자동 검수 중단 해제" };
    await expect(prepareFeatureFlagChange(env.DB, resume, "false")).rejects.toThrow("FEATURE_BASELINE_DISABLED");
    const restore = await prepareFeatureFlagChange(env.DB, resume, "true");
    expect((await commitFeatureFlagChange(env.DB, { ...o, operationId: restore.operationId }, "true")).current)
      .toMatchObject({ stopped: false, effective: true, version: 2 });
    await tick(afterRestore);
    expect(await review(whileStopped)).toMatchObject({ id: paused!.id, ...advanced });
    expect(await review(afterRestore)).toMatchObject(advanced);
    const transitions = await env.DB.prepare(`
      SELECT actor_user_id FROM admin_audit_logs WHERE action='PLACE_REVIEW_STAGE_CHANGE' AND target_id=?
    `).bind(paused!.id).all<{ actor_user_id: string }>();
    expect(transitions.results).toEqual([{ actor_user_id: AUTO_PIPELINE_ACTOR_ID }]);

    await tick(baselineOff, "false");
    expect(await review(baselineOff)).toMatchObject(waiting);
    expect(collected).toEqual(sources);
  } finally {
    provider.mockRestore();
    vi.useRealTimers();
  }
});
