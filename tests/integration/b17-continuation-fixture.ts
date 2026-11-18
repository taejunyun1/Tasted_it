import { createHash } from "node:crypto";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect } from "vitest";
import { continuationManifestHash, b17ReviewedSnapshotHash } from "../../scripts/b17-rollout-continuation.mjs";
import { B17_TARGET, RolloutBudget } from "../../scripts/b17-rollout-runner.mjs";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function fixture(failure?: "partial-migration" | "session-response-lost" | "rsi-log") {
  const db = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  const baseline = env.TEST_MIGRATIONS.filter(row => row.name < "0050"), upgrades = env.TEST_MIGRATIONS.filter(row => row.name >= "0050");
  await applyD1Migrations(db, baseline);
  const now = new Date().toISOString(), old = new Date(Date.now() - 20 * 60_000).toISOString(), later = new Date(Date.now() + 3_600_000).toISOString();
  await db.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES('continuation-admin','synthetic@example.test','Synthetic','ADMIN',?,?,?)").bind(old,old,old).run();
  await db.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES('other-session','continuation-admin',?,?)").bind(later,old).run();
  await db.prepare("INSERT INTO admin_operations(id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,status,created_at,expires_at) VALUES('other-pending','RATING_RECOMPUTE','continuation-admin','other-session','{}','hash','{}',0,'PENDING',?,?)").bind(old,later).run();
  await db.prepare("INSERT INTO public_data_sync_runs(id,source_type,region_code,address_field,status,next_page,total_count,fetched_count,inserted_count,updated_count,skipped_count,started_at,created_at,updated_at) VALUES('legacy-run','REST_CAFE','GWANGJU_JEONNAM','LOTNO_ADDR','RUNNING',1,0,0,0,0,0,?,?,?)").bind(old,old,old).run();
  await db.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES('continuation-place','continuation-place','Synthetic','PUBLISHED','Synthetic','Synthetic',35.1,126.9,'Synthetic',?,?)").bind(old,old).run();
  await db.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES('continuation-place','cat-ramen',1)").run();
  // PUBLISHED alone does not make this row public: it has no primary category.
  await db.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES('0-private-place','private-place','Synthetic hidden','PUBLISHED','Synthetic','Synthetic',35.1,126.9,'Synthetic',?,?)").bind(old,old).run();
  const sourceSha="a".repeat(40), artifactDigest="b".repeat(64), previousVersion="11111111-1111-4111-8111-111111111111", fenceVersion="22222222-2222-4222-8222-222222222222", normalVersion="33333333-3333-4333-8333-333333333333";
  const migrations=upgrades.map(row=>({name:row.name,sha256:"c".repeat(64)}));
  const config={name:B17_TARGET.worker,vars:{CST_MAINTENANCE:"false"},compatibility_flags:["nodejs_compat"],compatibility_date:"2026-08-05"};
  const checkpoint={sourceSha,artifactDigest,previousVersion,fenceVersion,fencedAt:old,manifestSha256:continuationManifestHash(migrations)};
  const legacyBefore=await db.prepare("SELECT rowid,* FROM public_data_sync_runs WHERE id='legacy-run'").first();
  Object.assign(checkpoint,{legacySnapshotSha256:b17ReviewedSnapshotHash({...legacyBefore,attempts:0,lease_id:null,lease_expires_at:null,cancel_requested_at:null,request_count:0,retry_count:0})});
  const input={sourceSha,previousVersion,operatorId:"continuation-admin",legacyRunId:"legacy-run",quotaCutover:"HOLD",budgetPolicy:"MANUAL_180_INCLUDES_BOOKKEEPING_MIGRATION_201"};
  const budget=new RolloutBudget({d1Commands:1,manualSql:1,http:5});
  let normal=false, locked=false, applyCalls=0, lost=false, fenceRestored=false, requestObservedAt=now;
  const probedPaths:string[]=[];
  const privateArtifacts = new Map<string,string>();
  const runtime=()=>({deployment:{created_on:(normal?now:old).replace(/Z$/, "000Z"),versions:[{version_id:normal?normalVersion:fenceVersion,percentage:100}]},version:{id:normal?normalVersion:fenceVersion,metadata:{created_on:(normal?now:old).replace(/Z$/, "000Z")},resources:{script_runtime:{compatibility_flags:["nodejs_compat"],compatibility_date:"2026-08-05"},bindings:[{type:"d1",name:"DB",id:B17_TARGET.databaseId},{type:"r2_bucket",name:"REVIEW_PHOTOS",bucket_name:B17_TARGET.bucket},{type:"plain_text",name:"CST_MAINTENANCE",text:String(!normal)}]}},crons:[...B17_TARGET.crons]});
  const authority={localHead:sourceSha,mainHead:sourceSha,sourceTree:"d".repeat(40),prTree:"d".repeat(40),clean:true,pullRequest:{number:470,merged:true,base:{ref:"main"},head:{sha:sourceSha},merge_commit_sha:sourceSha},checks:["typecheck and unit","integration","build","playwright smoke"].map(name=>({name,head_sha:sourceSha,status:"completed",conclusion:"success"}))};
  const paths=["/","/places","/login","/admin","/robots.txt","/privacy"].map(path=>({path,status:path==="/admin"?302:200,ok:true}));
  const headers={"cache-control":"private, no-store"};
  const adapter:any={
    kind:"SYNTHETIC_LOCAL",now:()=>new Date().toISOString(),lock:{acquire:async()=>{expect(locked).toBe(false);locked=true;},release:async()=>{locked=false;}},
    authority:async()=>authority,buildDigest:async()=>({artifactDigest,config}),runtime:async()=>runtime(),
    verifyDrain:async()=>({status:"VERIFIED",canMigrate:true,evidenceSha256:"e".repeat(64),previousVersion,fenceVersion,fenceDeployedAt:old,checkedAt:new Date().toISOString()}),
    backup:async()=>({bookmark:"synthetic-bookmark",sha256:hash("synthetic-export"),bytes:16}),
    savePrivate:async(name:string,value:string)=>{privateArtifacts.set(name,value);return{sha256:hash(value),bytes:value.length};},
    query:async(sql:string,{expectedStatements}: {expectedStatements:number})=>{
      const statements=sql.trim().startsWith("CREATE TRIGGER")?sql.trim().split(/\n(?=CREATE TRIGGER|INSERT OR IGNORE INTO admin_audit_logs)/).filter(Boolean):sql.trim().split(/;\s*(?=(?:SELECT|PRAGMA|INSERT|DELETE|DROP)\b)/i);
      expect(statements.length).toBe(expectedStatements);
      const results=await db.batch(statements.map(statement=>db.prepare(statement)));
      if(failure==="session-response-lost"&&!lost&&sql.startsWith("INSERT INTO sessions")){lost=true;throw Error("SYNTHETIC_RESPONSE_LOST");}
      return results;
    },
    applyMigrations:async()=>{applyCalls++;await applyD1Migrations(db,failure==="partial-migration"?upgrades.slice(0,2):upgrades);if(failure==="partial-migration")throw Error("SYNTHETIC_MIGRATION_RESPONSE_LOST");},
    deployNormal:async()=>{normal=true;return{runtime:runtime(),sourceSha,artifactDigest};},
    ensureFence:async()=>{normal=false;fenceRestored=true;return runtime();},
    probe:async({path,method,sessionId,form}:any)=>{
      probedPaths.push(path);
      if(path==="/places")return{status:200,headers,body:'<a href="https://outside.invalid/places/wrong">outside</a><a href="/places/wrong/nested">invalid</a><a href="/places/continuation-place?sourceRail=LOCAL">public</a>'};
      if(path==="/places/private-place")return{status:404,headers,body:"not public"};
      if(path==="/admin/rating-config?unknown=1")return{status:400,headers,body:"invalid"};
      if(path==="/admin/settings"&&method==="POST"&&form.intent==="preview-stop"){
        const id="44444444-4444-4444-8444-444444444444";
        await db.prepare("INSERT INTO admin_operations(id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,status,created_at,expires_at) VALUES(?,'FEATURE_FLAG_CONTROL','continuation-admin',?,'{}','hash','{}',1,'PENDING',?,?)").bind(id,sessionId,now,later).run();
        return{status:200,headers,body:`<input name="operationId" value="${id}">`};
      }
      if(path==="/admin/settings"&&method==="POST")return{status:302,headers:{...headers,location:"/admin/reauth?returnTo=fixture"},body:""};
      if(path==="/admin/operations/rsi-check"){
        requestObservedAt=new Date().toISOString();
        const body={ok:true,paths};
        await db.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at) VALUES('rsi-fixture','continuation-admin','RSI_SELF_CHECK','OPERATIONS','rsi-admin',?,?)").bind(JSON.stringify({trigger:"admin",...body}),requestObservedAt).run();
        return{status:200,headers:{...headers,"cf-ray":"synthetic-ray-ICN"},body:JSON.stringify(body)};
      }
      if(path.startsWith("/admin")&&!sessionId)return{status:302,headers:{...headers,location:"/login?returnTo=fixture"},body:""};
      return{status:200,headers,body:"synthetic page"};
    },
    readRsiLog:async()=>failure==="rsi-log"?{status:"UNKNOWN"}:{versionId:normalVersion,outcome:"ok",trigger:"admin",observedAt:requestObservedAt,requestId:"synthetic"},
  };
  return {db,args:{input,checkpoint,prepared:{sourceSha,migrations,baselineMigrationNames:baseline.map(row=>row.name),config},budget},adapter,privateArtifacts,probedPaths,metrics:()=>({applyCalls,normal,locked,fenceRestored})};
}
