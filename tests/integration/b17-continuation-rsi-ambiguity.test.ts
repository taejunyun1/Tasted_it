import { expect, it } from "vitest";
import { continueB17Rollout } from "../../scripts/b17-rollout-continuation.mjs";
import { fixture } from "./b17-continuation-fixture";

it("restores maintenance when RSI cannot be correlated with the actual deployment",async()=>{
  const f=await fixture("rsi-log");const result=await continueB17Rollout(f.args,f.adapter);
  expect(result).toMatchObject({status:"HOLD",code:"B17_RSI_TRACE_UNKNOWN",cleanup:"VERIFIED",fence:"VERIFIED"});
  expect(f.metrics()).toMatchObject({normal:false,fenceRestored:true,locked:false});
});
