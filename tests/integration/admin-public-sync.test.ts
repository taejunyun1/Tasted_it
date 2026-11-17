import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../../app/db/client.server";
import { publicDataSyncRuns, sessions, users } from "../../app/db/schema";
import { commitPublicSyncOperation, preparePublicSyncOperation } from "../../app/features/candidates/public-sync-admin.server";
import { listPublicSyncStates, syncPublicDataBatch } from "../../app/features/candidates/sync.server";

beforeEach(async () => { await env.DB.prepare("DELETE FROM public_data_sync_runs").run(); });

async function operator() {
 const db=createDb(env.DB), actorUserId=crypto.randomUUID(),sessionId=crypto.randomUUID(),now=new Date().toISOString();
 await db.insert(users).values({id:actorUserId,email:`${actorUserId}@example.test`,displayName:"합성 관리자",role:"ADMIN",createdAt:now,updatedAt:now});
 await db.insert(sessions).values({id:sessionId,userId:actorUserId,expiresAt:"2099-01-01T00:00:00.000Z",createdAt:now});
 return {db,actorUserId,sessionId,now};
}
async function assure(f:Awaited<ReturnType<typeof operator>>) {
 await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)")
 .bind(f.sessionId,f.actorUserId,f.now,"2099-01-01T00:00:00.000Z").run();
}
const empty = () => Response.json({response:{header:{resultCode:"0"},body:{totalCount:0,items:{item:[]}}}});

describe("public sync admin contract",()=>{
 it("requires recent authentication, then executes one attempt across receipt replay",async()=>{
  const f=await operator(),fetcher=vi.fn(async()=>empty());
  const p=await preparePublicSyncOperation(env.DB,{...f,action:"START",sourceType:"REST_CAFE",addressField:"ROAD_NM_ADDR",reason:"정기 갱신 확인"});
  expect(await f.db.select().from(publicDataSyncRuns)).toHaveLength(0);
  await expect(commitPublicSyncOperation(env.DB,{...f,operationId:p.operationId},{serviceKey:"test",fetcher})).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
  expect(fetcher).not.toHaveBeenCalled(); await assure(f);
  const result=await commitPublicSyncOperation(env.DB,{...f,operationId:p.operationId},{serviceKey:"test",fetcher});
  const replay=await commitPublicSyncOperation(env.DB,{...f,operationId:p.operationId},{serviceKey:"test",fetcher});
  expect(result.run).toMatchObject({status:"COMPLETED",attempts:1});expect(replay.replayed).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await env.DB.prepare("SELECT count(*) n FROM admin_audit_logs WHERE action='ADMIN_OPERATION_COMMITTED' AND target_id=?").bind(p.operationId).first<{n:number}>())?.n).toBe(1);
 });
 it("cancels an inflight GET without committing its page or permitting a second request",async()=>{
  const f=await operator();await assure(f);
  let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(r=>{enter=r}),waiting=new Promise<void>(r=>{release=r});
  const fetcher=vi.fn(async()=>{enter();await waiting;return Response.json({response:{header:{resultCode:"0"},body:{totalCount:200,items:{item:[{MNG_NO:"cancelled-row",BPLC_NM:"저장 금지",ROAD_NM_ADDR:"전남광주통합특별시 동구 확인로 1",SALS_STTS_CD:"01",SALS_STTS_NM:"영업/정상"}]}}}});});
  const pending=syncPublicDataBatch(f.db,{serviceKey:"test",sourceType:"GENERAL_RESTAURANT",addressField:"ROAD_NM_ADDR",fetcher});
  await entered;const run=await f.db.query.publicDataSyncRuns.findFirst();
  const p=await preparePublicSyncOperation(env.DB,{...f,action:"CANCEL",runId:run!.id,reason:"작업 중단 확인"});
  await commitPublicSyncOperation(env.DB,{...f,operationId:p.operationId},{serviceKey:"test",fetcher});
  release();const result=await pending;
  expect(result.run).toMatchObject({status:"CANCELLED",fetchedCount:0,nextPage:1});expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare("SELECT id FROM business_licenses WHERE source_management_no='cancelled-row'").first()).toBeNull();
 });
 it("rejects a changed preview and revoked administrator without calling the provider",async()=>{
  const f=await operator();await assure(f);const fetcher=vi.fn(async()=>empty());
  const p=await preparePublicSyncOperation(env.DB,{...f,action:"START",sourceType:"BAKERY",addressField:"ROAD_NM_ADDR",reason:"검수 자료 갱신"});
  await f.db.insert(publicDataSyncRuns).values({id:crypto.randomUUID(),sourceType:"BAKERY",addressField:"ROAD_NM_ADDR",regionCode:"GWANGJU_JEONNAM",status:"PENDING",startedAt:f.now,createdAt:f.now,updatedAt:f.now});
  await expect(commitPublicSyncOperation(env.DB,{...f,operationId:p.operationId},{serviceKey:"test",fetcher})).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
  await f.db.update(users).set({role:"USER"}).where(eq(users.id,f.actorUserId));
  await expect(preparePublicSyncOperation(env.DB,{...f,action:"START",sourceType:"REST_CAFE",addressField:"LOTNO_ADDR",reason:"새 요청"})).rejects.toThrow("ADMIN_REQUIRED");
  expect(fetcher).not.toHaveBeenCalled();
 });
});

it("quarantines legacy RUNNING jobs without a fence, including previews made before upgrade",async()=>{
 const f=await operator();await assure(f);
 const id=crypto.randomUUID();
 await f.db.insert(publicDataSyncRuns).values({id,sourceType:"BAKERY",regionCode:"GWANGJU_JEONNAM",addressField:"LOTNO_ADDR",status:"RUNNING",nextPage:8,fetchedCount:700,startedAt:f.now,createdAt:f.now,updatedAt:f.now});
 const before=await f.db.query.publicDataSyncRuns.findFirst({where:eq(publicDataSyncRuns.id,id)});
 const fetcher=vi.fn(async()=>empty());
 const result=await syncPublicDataBatch(f.db,{serviceKey:"test",sourceType:"BAKERY",addressField:"LOTNO_ADDR",runId:id,fetcher});
 expect(result).toMatchObject({claimed:false,run:{status:"UNKNOWN",unmanaged:true,canResume:false,canCancel:false}});
 for(const action of ["RESUME","CANCEL"]) {
   await expect(preparePublicSyncOperation(env.DB,{...f,action,runId:id,reason:"이전 실행 확인"})).rejects.toThrow(action === "CANCEL" ? "PUBLIC_SYNC_ACTION_UNAVAILABLE" : "PUBLIC_SYNC_LEGACY_UNVERIFIED");
   const {prepareAdminOperation}=await import("../../app/features/operations/admin-operation.server");
   const p=await prepareAdminOperation(env.DB,{...f,kind:"PUBLIC_SYNC_CONTROL",payload:{action,runId:id,sourceType:"BAKERY",addressField:"LOTNO_ADDR",reason:"이전 미리보기",
    previous:{status:"RUNNING",attempts:0,retryCount:0,nextPage:8,leaseId:null,leaseExpiresAt:null,updatedAt:f.now}},summary:{title:"이전 실행 처리",count:1}});
   await expect(commitPublicSyncOperation(env.DB,{...f,operationId:p.operationId},{serviceKey:"test",fetcher})).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
 }
 expect(fetcher).not.toHaveBeenCalled();
 expect(await f.db.query.publicDataSyncRuns.findFirst({where:eq(publicDataSyncRuns.id,id)})).toEqual(before);
 expect((await env.DB.prepare("SELECT count(*) n FROM admin_operation_commits WHERE actor_user_id=?").bind(f.actorUserId).first<{n:number}>())?.n).toBe(0);
});

it.each([['PENDING',null],['FAILED',null],['PENDING','stale-owner'],['FAILED','stale-owner']] as const)("does not start %s while another legacy/stale run (%s) remains unresolved",async(status,leaseId)=>{
 const f=await operator();await assure(f);
 const older=crypto.randomUUID(),target=crypto.randomUUID();
 await f.db.insert(publicDataSyncRuns).values([
  {id:older,sourceType:"BAKERY",regionCode:"GWANGJU_JEONNAM",addressField:"ROAD_NM_ADDR",status:"RUNNING",leaseId,leaseExpiresAt:leaseId?"2026-01-01T00:00:00.000Z":null,startedAt:"2026-01-01T00:00:00.000Z",createdAt:f.now,updatedAt:f.now},
  {id:target,sourceType:"BAKERY",regionCode:"GWANGJU_JEONNAM",addressField:"ROAD_NM_ADDR",status,startedAt:f.now,createdAt:f.now,updatedAt:f.now},
 ]);
 const before=await f.db.select().from(publicDataSyncRuns),fetcher=vi.fn(async()=>empty());
 const result=await syncPublicDataBatch(f.db,{serviceKey:"test",sourceType:"BAKERY",addressField:"ROAD_NM_ADDR",runId:target,fetcher});
 expect(result.claimed).toBe(false);
 expect((await listPublicSyncStates(f.db,f.now)).find(run=>run.id===target)).toMatchObject({blockedByOtherRun:true,canResume:false});
 await expect(preparePublicSyncOperation(env.DB,{...f,action:"RESUME",runId:target,reason:"최신 작업 재개"})).rejects.toThrow(leaseId ? "PUBLIC_SYNC_ACTION_UNAVAILABLE" : "PUBLIC_SYNC_LEGACY_UNVERIFIED");
 const {prepareAdminOperation}=await import("../../app/features/operations/admin-operation.server");
 const p=await prepareAdminOperation(env.DB,{...f,kind:"PUBLIC_SYNC_CONTROL",payload:{action:"RESUME",runId:target,sourceType:"BAKERY",addressField:"ROAD_NM_ADDR",reason:"이전 미리보기",
  previous:{status,attempts:0,retryCount:0,nextPage:1,leaseId:null,leaseExpiresAt:null,updatedAt:f.now}},summary:{title:"공공자료 재개",count:1}});
 await expect(commitPublicSyncOperation(env.DB,{...f,operationId:p.operationId},{serviceKey:"test",fetcher})).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
 expect(await f.db.select().from(publicDataSyncRuns)).toEqual(before);
 expect(fetcher).not.toHaveBeenCalled();
 expect((await env.DB.prepare("SELECT count(*) n FROM admin_operation_commits WHERE actor_user_id=?").bind(f.actorUserId).first<{n:number}>())?.n).toBe(0);
});

it("globally quarantines legacy writers across source and address scopes",async()=>{
 const f=await operator();await assure(f);
 const legacyId=crypto.randomUUID(),target=crypto.randomUUID();
 await f.db.insert(publicDataSyncRuns).values([
  {id:legacyId,sourceType:"GENERAL_RESTAURANT",regionCode:"GWANGJU_JEONNAM",addressField:"ROAD_NM_ADDR",status:"RUNNING",startedAt:f.now,createdAt:f.now,updatedAt:f.now},
  {id:target,sourceType:"BAKERY",regionCode:"GWANGJU_JEONNAM",addressField:"LOTNO_ADDR",status:"PENDING",startedAt:f.now,createdAt:f.now,updatedAt:f.now},
 ]);
 const before=await f.db.select().from(publicDataSyncRuns),fetcher=vi.fn(async()=>empty());
 const result=await syncPublicDataBatch(f.db,{serviceKey:"test",sourceType:"BAKERY",addressField:"LOTNO_ADDR",runId:target,fetcher});
 expect(result.claimed).toBe(false);
 await expect(syncPublicDataBatch(f.db,{serviceKey:"test",sourceType:"REST_CAFE",addressField:"LOTNO_ADDR",fetcher})).rejects.toThrow("PUBLIC_SYNC_UNAVAILABLE");
 expect((await listPublicSyncStates(f.db,f.now)).find(run=>run.id===target)).toMatchObject({blockedByLegacyRun:true,canResume:false});
 await expect(preparePublicSyncOperation(env.DB,{...f,action:"RESUME",runId:target,reason:"다른 출처 재개"})).rejects.toThrow("PUBLIC_SYNC_LEGACY_UNVERIFIED");
 await expect(preparePublicSyncOperation(env.DB,{...f,action:"START",sourceType:"REST_CAFE",addressField:"LOTNO_ADDR",reason:"새 출처 동기화"})).rejects.toThrow("PUBLIC_SYNC_LEGACY_UNVERIFIED");
 const {prepareAdminOperation}=await import("../../app/features/operations/admin-operation.server");
 for(const action of ["START","RESUME"]){
  const p=await prepareAdminOperation(env.DB,{...f,kind:"PUBLIC_SYNC_CONTROL",payload:{action,runId:action==="START"?crypto.randomUUID():target,
   sourceType:action==="START"?"REST_CAFE":"BAKERY",addressField:"LOTNO_ADDR",reason:"이전 미리보기",
   previous:action==="START"?null:{status:"PENDING",attempts:0,retryCount:0,nextPage:1,leaseId:null,leaseExpiresAt:null,updatedAt:f.now}},summary:{title:"공공자료 처리",count:1}});
  await expect(commitPublicSyncOperation(env.DB,{...f,operationId:p.operationId},{serviceKey:"test",fetcher})).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
 }
 expect(fetcher).not.toHaveBeenCalled();
 expect(await f.db.select().from(publicDataSyncRuns)).toEqual(before);
 expect((await env.DB.prepare("SELECT count(*) n FROM admin_operation_commits WHERE actor_user_id=?").bind(f.actorUserId).first<{n:number}>())?.n).toBe(0);
});
