import { expect, it } from "vitest";
import { continueB17Rollout } from "../../scripts/b17-rollout-continuation.mjs";
import { fixture } from "./b17-continuation-fixture";

it("executes fixed post-fence operations on synthetic D1 and preserves unrelated state",async()=>{
  const f=await fixture();const result=await continueB17Rollout(f.args,f.adapter);
  expect(result.code).toBeUndefined();
  expect(result).toMatchObject({status:"VERIFIED",cleanup:"VERIFIED",fence:"NORMAL_VERIFIED",mutationOutcome:"APPLIED_VERIFIED"});
  expect(result.budget).toEqual({http:39,d1Commands:46,manualSql:59,migrationSql:201,migrations:9,exports:1,sessions:1,rsi:1});
  expect(f.probedPaths).toContain("/places/continuation-place");
  expect(f.probedPaths).not.toContain("/places/private-place");
  expect(f.metrics()).toEqual({applyCalls:1,normal:true,locked:false,fenceRestored:false});
  expect([...f.privateArtifacts.keys()].sort()).toEqual([
    "legacy-trigger-recovery.json", "preservation-after.json", "preservation-before.json", "session-recovery.json",
  ]);
  const triggerReceipt = JSON.parse(f.privateArtifacts.get("legacy-trigger-recovery.json")!);
  expect(triggerReceipt.sourceSha).toBe(f.args.input.sourceSha);
  expect(triggerReceipt.names).toEqual([
    expect.stringMatching(/^b10_resume_identity_[a-f0-9]{24}$/),
    expect.stringMatching(/^b10_resume_apply_[a-f0-9]{24}$/),
  ]);
  const receipt=JSON.parse(f.privateArtifacts.get("session-recovery.json")!);
  expect(receipt).toMatchObject({operatorId:"continuation-admin",maxAgeSeconds:1800});
  expect(receipt.sessionId).toMatch(/^[a-f0-9-]{36}$/);
  expect(JSON.stringify(result)).not.toContain(receipt.sessionId);
  expect(await f.db.prepare("SELECT id FROM sessions ORDER BY id").all()).toMatchObject({results:[{id:"other-session"}]});
  expect(await f.db.prepare("SELECT id FROM admin_operations ORDER BY id").all()).toMatchObject({results:[{id:"other-pending"}]});
  expect(await f.db.prepare("SELECT status FROM public_data_sync_runs WHERE id='legacy-run'").first("status")).toBe("PENDING");
  expect((await f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'b10_resume_%' OR name LIKE 'b17_provider_%')").all()).results).toEqual([]);
});
