import { expect, it } from "vitest";
import { continueB17Rollout } from "../../scripts/b17-rollout-continuation.mjs";
import { fixture } from "./b17-continuation-fixture";

it("cleans an exact session even when its committed response was lost",async()=>{
  const f=await fixture("session-response-lost");const result=await continueB17Rollout(f.args,f.adapter);
  expect(result).toMatchObject({status:"HOLD",cleanup:"VERIFIED",fence:"KEPT"});
  expect((await f.db.prepare("SELECT id FROM sessions ORDER BY id").all()).results).toEqual([{id:"other-session"}]);
  expect((await f.db.prepare("SELECT id FROM admin_operations ORDER BY id").all()).results).toEqual([{id:"other-pending"}]);
});