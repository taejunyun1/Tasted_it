import { expect, it } from "vitest";
import { continueB17Rollout } from "../../scripts/b17-rollout-continuation.mjs";
import { fixture } from "./b17-continuation-fixture";

it("does not retry a partially applied migration or create a session",async()=>{
  const f=await fixture("partial-migration");const result=await continueB17Rollout(f.args,f.adapter);
  expect(result).toMatchObject({status:"HOLD",code:"B17_MIGRATION_LEDGER_MISMATCH",cleanup:"NOT_NEEDED",fence:"KEPT"});
  expect(f.metrics()).toMatchObject({applyCalls:1,normal:false,locked:false});
});