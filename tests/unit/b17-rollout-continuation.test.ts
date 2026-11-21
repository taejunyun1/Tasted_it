import { expect, it } from "vitest";
import { continueB17Rollout, continuationManifestHash } from "../../scripts/b17-rollout-continuation.mjs";
import { RolloutBudget, B17_TARGET } from "../../scripts/b17-rollout-runner.mjs";
import { B17_MIGRATIONS } from "../../scripts/b17-rollout-evidence.mjs";
const sha = "a".repeat(40), previousVersion = "11111111-1111-4111-8111-111111111111", fenceVersion = "22222222-2222-4222-8222-222222222222", now = "2026-11-18T02:00:00.000Z", fencedAt = "2026-11-18T01:40:00.000Z";
function setup() {
 const config={name:B17_TARGET.worker,vars:{CST_MAINTENANCE:"false"},compatibility_flags:["nodejs_compat"],compatibility_date:"2026-08-05"};
 const migrations=B17_MIGRATIONS.map(name=>({name,sha256:"b".repeat(64)}));
 const input={sourceSha:sha,previousVersion,operatorId:"operator",legacyRunId:null,quotaCutover:"HOLD",budgetPolicy:"MANUAL_180_INCLUDES_BOOKKEEPING_MIGRATION_201"};
 const checkpoint={sourceSha:sha,artifactDigest:"c".repeat(64),previousVersion,fenceVersion,fencedAt,manifestSha256:continuationManifestHash(migrations)};
 const calls:string[]=[];
 const authority={localHead:sha,mainHead:sha,sourceTree:"d".repeat(40),prTree:"d".repeat(40),clean:true,pullRequest:{number:470,merged:true,base:{ref:"main"},head:{sha},merge_commit_sha:sha},checks:["typecheck and unit","integration","build","playwright smoke"].map(name=>({name,head_sha:sha,status:"completed",conclusion:"success"}))};
 const adapter:any={kind:"SYNTHETIC_LOCAL",now:()=>now,lock:{acquire:async()=>calls.push("lock"),release:async()=>calls.push("unlock")},authority:async()=>authority,buildDigest:async()=>({artifactDigest:checkpoint.artifactDigest,config}),runtime:async()=>({deployment:{created_on:fencedAt,versions:[{version_id:fenceVersion,percentage:100}]},version:{id:fenceVersion,metadata:{created_on:fencedAt},resources:{script_runtime:{compatibility_flags:["nodejs_compat"],compatibility_date:"2026-08-05"},bindings:[{type:"d1",name:"DB",id:B17_TARGET.databaseId},{type:"r2_bucket",name:"REVIEW_PHOTOS",bucket_name:B17_TARGET.bucket},{type:"plain_text",name:"CST_MAINTENANCE",text:"true"}]}},crons:[...B17_TARGET.crons]}),verifyDrain:async()=>({status:"UNKNOWN",canMigrate:false}),query:async()=>{calls.push("query");throw Error("unexpected query")},backup:async()=>calls.push("backup")};
 return {args:{input,checkpoint,prepared:{sourceSha:sha,baselineMigrationNames:["0049.sql"],migrations,config},budget:new RolloutBudget()},adapter,calls};
}
it("stops before backup or D1 when authentic exhaustive drain proof is unavailable",async()=>{
 const f=setup();const result=await continueB17Rollout(f.args,f.adapter);
 expect(result).toMatchObject({status:"HOLD",stage:"DRAIN",code:"B17_DRAIN_NOT_VERIFIED"});expect(f.calls).toEqual(["lock","unlock"]);
});
it.each(["2026-11-18T01:40:00Z", "2026-11-18T01:40:00.000000Z"])("accepts equivalent UTC deployment precision %s without promoting drain evidence",async timestamp=>{
 const f=setup();f.args.checkpoint.fencedAt=timestamp;
 const runtime=f.adapter.runtime;f.adapter.runtime=async()=>{const value=await runtime();value.deployment.created_on=timestamp;value.version.metadata.created_on=timestamp;return value;};
 expect(await continueB17Rollout(f.args,f.adapter)).toMatchObject({status:"HOLD",stage:"DRAIN",code:"B17_DRAIN_NOT_VERIFIED"});
 expect(f.calls).toEqual(["lock","unlock"]);
});
it.each(["2026-02-30T01:40:00Z", "2026-11-18T01:40:00.0000000Z", "2026-11-18T01:40:00+00:00"])("rejects invalid or noncontract UTC checkpoint %s before side effects",async timestamp=>{
 const f=setup();f.args.checkpoint.fencedAt=timestamp;
 await expect(continueB17Rollout(f.args,f.adapter)).rejects.toThrow("B17_CHECKPOINT_INVALID");expect(f.calls).toEqual([]);
});
it("does not elevate a canMigrate boolean or an unrelated fence into proof",async()=>{
 for(const evidence of [{status:"VERIFIED",canMigrate:true},{status:"VERIFIED",canMigrate:true,sourceSha:sha,previousVersion,fenceVersion:previousVersion,fenceDeployedAt:fencedAt,evidenceSha256:"e".repeat(64),checkedAt:now}]){
  const f=setup();f.adapter.verifyDrain=async()=>evidence;expect((await continueB17Rollout(f.args,f.adapter)).status).toBe("HOLD");expect(f.calls).not.toContain("backup");
 }
});

it("preserves redacted observation counts on HOLD without unlocking writes", async () => {
  const f = setup();
  f.adapter.verifyDrain = async () => ({ status: "UNKNOWN", cronWindowElapsed: true, observation: {
    status: "OBSERVED", returnedEvents: 3, observedTerminalOutcomes: 2, partial: true, secret: "source-log-private",
  } });
  const outcome = await continueB17Rollout(f.args, f.adapter);
  expect(outcome).toMatchObject({ status: "HOLD", stage: "DRAIN", proofs: { drain: {
    observation: "OBSERVED", returnedEvents: 3, observedTerminalOutcomes: 2, coveragePartial: true,
  } } });
  expect(JSON.stringify(outcome)).not.toContain("source-log-private");
  expect(f.calls).not.toContain("backup");
});
it("rejects a changed artifact before database work",async()=>{
 const f=setup();f.adapter.buildDigest=async()=>({artifactDigest:"e".repeat(64),config:f.args.prepared.config});
 expect(await continueB17Rollout(f.args,f.adapter)).toMatchObject({status:"HOLD",code:"B17_ARTIFACT_CHANGED"});expect(f.calls).not.toContain("query");
});
it("keeps quota cutover in its separate reviewed post-migration path without any side effect",async()=>{
 const f=setup();f.args.input.quotaCutover="APPLY";
 expect(await continueB17Rollout(f.args,f.adapter)).toMatchObject({status:"HOLD",code:"B17_QUOTA_SEPARATE_REVIEW_REQUIRED"});expect(f.calls).toEqual([]);
});
it("rejects an insufficient remaining budget before export or data capture",async()=>{
 const f=setup();f.args.budget=new RolloutBudget({d1Commands:4});
 f.adapter.verifyDrain=async()=>({status:"VERIFIED",canMigrate:true,evidenceSha256:"e".repeat(64),previousVersion,fenceVersion,fenceDeployedAt:fencedAt,checkedAt:now});
 expect(await continueB17Rollout(f.args,f.adapter)).toMatchObject({status:"HOLD",stage:"RESERVATION",code:"B17_BUDGET_EXCEEDED"});expect(f.calls).toEqual(["lock","unlock"]);
});
