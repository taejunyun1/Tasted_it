import { describe,expect,it } from "vitest";
import { validatePhotoMetadata,validateVisitDeclaration } from "../../app/features/ratings/reviewer-moderation.server";
describe("KST visit and photo declaration dates",()=>{
 it("accepts the actual local day just after KST midnight without inventing a date",()=>{
  const now="2026-11-12T15:05:00.000Z";
  expect(validateVisitDeclaration({visitedOn:"2026-11-13",visitNote:"직접 방문",disclosure:"NONE"},now).visitedOn).toBe("2026-11-13");
  expect(validatePhotoMetadata([{position:0,takenOn:"2026-11-13",rightsBasis:"OWN_WORK",caption:"음식",privacyChecked:true}],now)[0].takenOn).toBe("2026-11-13");
 });
 it("rejects tomorrow and impossible dates across the same boundary",()=>{
  const now="2026-11-12T15:05:00.000Z";
  for(const visitedOn of ["2026-11-14","2026-02-30"])expect(()=>validateVisitDeclaration({visitedOn,visitNote:"직접 방문",disclosure:"NONE"},now)).toThrow("REVIEW_VISIT_INVALID");
 });
});
