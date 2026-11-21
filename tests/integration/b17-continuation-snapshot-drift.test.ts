import { expect, it } from "vitest";
import { continueB17Rollout } from "../../scripts/b17-rollout-continuation.mjs";
import { fixture } from "./b17-continuation-fixture";

it("rejects a changed reviewed legacy snapshot before installing transition triggers",async()=>{
  const f=await fixture();Object.assign(f.args.checkpoint,{legacySnapshotSha256:"f".repeat(64)});
  const result=await continueB17Rollout(f.args,f.adapter);
  expect(result).toMatchObject({status:"HOLD",code:"B17_LEGACY_REVIEW_DIGEST_MISMATCH",cleanup:"VERIFIED",fence:"KEPT"});
  expect(await f.db.prepare("SELECT status FROM public_data_sync_runs WHERE id='legacy-run'").first("status")).toBe("RUNNING");
  expect((await f.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'b10_resume_%'").all()).results).toEqual([]);
});
