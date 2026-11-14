import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../../app/db/client.server";
import { places, placeReviewWorkItems, studentSeats, studentTasks, users } from "../../app/db/schema";
import { newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";
import { commitStudentAdminOperation, getStudentAdminOperation, prepareStudentAdminOperation, type StudentAdminCommand } from "../../app/features/students/admin-commands.server";
import { acceptStudentInvite } from "../../app/features/students/invitations.server";
import { getStudentTask, submitStudentTask } from "../../app/features/students/tasks.server";
import * as subjects from "../../app/features/students/subjects.server";
import { action } from "../../app/routes/admin-students";

const db = createDb(env.DB);
let caller: {actorUserId:string;sessionId:string;now:string};
async function user(role: "USER"|"ADMIN" = "USER") {
  const id=crypto.randomUUID(), now=new Date().toISOString();
  await db.insert(users).values({id,role,email:`${id}@example.test`,displayName:"합성 계정",emailVerifiedAt:now,createdAt:now,updatedAt:now}); return id;
}
async function assure() { await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)").bind(caller.sessionId,caller.actorUserId,caller.now,new Date(Date.parse(caller.now)+600000).toISOString()).run(); }
async function prepare(command:StudentAdminCommand) {return prepareStudentAdminOperation(env.DB,{...caller,command});}
async function commit(operationId:string) {return commitStudentAdminOperation(env.DB,{...caller,operationId});}
async function place() {
  const id=crypto.randomUUID(), now=caller.now;
  await db.insert(places).values({id,slug:id,name:"합성 동네식당",status:"DRAFT",address:"광주광역시 동구 동명로 10",neighborhood:"동명동",latitude:35.15,longitude:126.92,searchText:id,createdAt:now,updatedAt:now});
  const item=newReviewWorkItemValues({placeId:id,sourceKind:"PLACE_SUGGESTION",now}); await db.insert(placeReviewWorkItems).values(item); return item.id;
}
async function qaTask() {
  const p=await prepare({change:"ASSIGN_TASK",kind:"QA",assignedSeat:"A",checkerSeat:"B",targetId:"/places",title:"합성 화면 시험"}); await commit(p.operationId);
  return (await db.select().from(studentTasks).where(eq(studentTasks.kind,"QA")))[0]!;
}
beforeEach(async()=>{
  vi.restoreAllMocks();
  await env.DB.prepare("DELETE FROM student_tasks").run(); await env.DB.prepare("DELETE FROM student_invitations").run();
  await env.DB.prepare("UPDATE student_seats SET user_id=NULL,is_active=1,expires_at='2099-01-01T00:00:00.000Z'").run();
  caller={actorUserId:await user("ADMIN"),sessionId:crypto.randomUUID(),now:new Date().toISOString()};
  await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)").bind(caller.sessionId,caller.actorUserId,caller.now,"2099-01-01T00:00:00.000Z").run();
});
describe("B08 student administrative commands",()=>{
  it("previews without mutations and requires current recent auth before exposing one fresh invitation",async()=>{
    const p=await prepare({change:"ISSUE_INVITE",seatCode:"C"});
    expect(await env.DB.prepare("SELECT count(*) n FROM student_invitations").first("n")).toBe(0);
    await expect(commit(p.operationId)).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED"); await assure();
    const first=await commit(p.operationId); expect(first.invitation?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const replay=await commit(p.operationId); expect(replay.replayed).toBe(true); expect(replay.invitation).toBeUndefined();
    const stored=await env.DB.prepare("SELECT payload_json,result_json FROM admin_operations WHERE id=?").bind(p.operationId).first();
    expect(JSON.stringify(stored)).not.toContain(first.invitation!.token); expect(stored?.payload_json).toBeNull();
    const audit=await env.DB.prepare("SELECT after_state FROM admin_audit_logs WHERE target_id=?").bind(p.operationId).all();
    expect(audit.results).toHaveLength(1); expect(JSON.stringify(audit.results)).not.toMatch(/token_hash|token|example.test/);
    expect(await getStudentAdminOperation(env.DB,{...caller,operationId:p.operationId})).toMatchObject({status:"COMMITTED",appliedCount:1});
  });
  it("keeps claimed owners and old links when acceptance races a reissue preview",async()=>{
    await assure(); const first=await commit((await prepare({change:"ISSUE_INVITE",seatCode:"C"})).operationId);
    const reissue=await prepare({change:"ISSUE_INVITE",seatCode:"C"}); const member=await user();
    await acceptStudentInvite(db,{token:first.invitation!.token,userId:member,now:caller.now});
    await expect(commit(reissue.operationId)).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await env.DB.prepare("SELECT user_id FROM student_seats WHERE code='C'").first("user_id")).toBe(member);
    expect(await env.DB.prepare("SELECT count(*) n FROM student_invitations").first("n")).toBe(1);
  });
  it("permits only one of two competing invite previews and rejects stale seat changes",async()=>{
    await assure(); const a=await prepare({change:"ISSUE_INVITE",seatCode:"D"}), b=await prepare({change:"ISSUE_INVITE",seatCode:"D"});
    const results=await Promise.allSettled([commit(a.operationId),commit(b.operationId)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(await env.DB.prepare("SELECT count(*) n FROM student_invitations WHERE revoked_at IS NULL").first("n")).toBe(1);
    const access=await prepare({change:"SET_ACCESS",seatCode:"D",active:false});
    await env.DB.prepare("UPDATE student_seats SET can_record_qa=0 WHERE code='D'").run();
    await expect(commit(access.operationId)).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await env.DB.prepare("SELECT is_active FROM student_seats WHERE code='D'").first("is_active")).toBe(1);
  });
  it("returns frozen per-row skips and exactly one batch receipt",async()=>{
    await assure(); const a=await place(), b=await place();
    await commit((await prepare({change:"ASSIGN_TASK",kind:"PLACE",assignedSeat:"A",checkerSeat:"B",targetId:a,title:"합성 개별 배정"})).operationId);
    const p=await prepare({change:"BATCH_ASSIGN",assignedSeat:"A",checkerSeat:"B",targetIds:[a,b,crypto.randomUUID()]});
    const view=await getStudentAdminOperation(env.DB,{...caller,operationId:p.operationId});
    expect(view.rows.map(r=>r.code)).toEqual(["ALREADY_ASSIGNED","ASSIGNED","SOURCE_UNAVAILABLE"]);
    const out=await commit(p.operationId); expect(out.result).toMatchObject({requestedCount:3,appliedCount:1,skippedCount:2});
    await commit(p.operationId); expect(await env.DB.prepare("SELECT count(*) n FROM student_tasks").first("n")).toBe(2);
    expect(await env.DB.prepare("SELECT count(*) n FROM admin_audit_logs WHERE target_id=?").bind(p.operationId).first("n")).toBe(1);
    await expect(prepare({change:"BATCH_ASSIGN",assignedSeat:"A",checkerSeat:"B",targetIds:Array.from({length:26},()=>crypto.randomUUID())})).rejects.toThrow();
  });
  it("applies zero intended rows when one batch source or seat changes after preview",async()=>{
    await assure(); const a=await place(), b=await place();
    const p=await prepare({change:"BATCH_ASSIGN",assignedSeat:"A",checkerSeat:"B",targetIds:[a,b]});
    await db.update(placeReviewWorkItems).set({stageVersion:1}).where(eq(placeReviewWorkItems.id,b));
    await expect(commit(p.operationId)).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await env.DB.prepare("SELECT count(*) n FROM student_tasks").first("n")).toBe(0);
    const second=await prepare({change:"BATCH_ASSIGN",assignedSeat:"A",checkerSeat:"B",targetIds:[a,b]});
    await env.DB.prepare("UPDATE student_seats SET is_active=0 WHERE code='B'").run();
    await expect(commit(second.operationId)).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await env.DB.prepare("SELECT count(*) n FROM admin_operation_commits WHERE operation_id IN (?,?)").bind(p.operationId,second.operationId).first("n")).toBe(0);
  });
  it("preserves seat owners and task history, and cancel conflicts with an intervening submission",async()=>{
    await assure(); const member=await user(); await db.update(studentSeats).set({userId:member}).where(eq(studentSeats.code,"A"));
    const task=await qaTask(); const cancellation=await prepare({change:"CANCEL_TASK",taskId:task.id});
    const loaded=await getStudentTask(db,{userId:member,taskId:task.id,now:caller.now});
    await submitStudentTask(db,{userId:member,taskId:task.id,expectedVersion:0,targetFingerprint:loaded.fingerprint,classification:{kind:"QA",decision:"PASS",note:"합성 환경에서 화면 동작을 확인했습니다.",evidenceUrl:""},now:caller.now});
    await expect(commit(cancellation.operationId)).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    const pause=await prepare({change:"SET_ACCESS",seatCode:"A",active:false}); await commit(pause.operationId);
    expect(await env.DB.prepare("SELECT user_id FROM student_seats WHERE code='A'").first("user_id")).toBe(member);
    expect(await env.DB.prepare("SELECT count(*) n FROM student_task_revisions WHERE task_id=?").bind(task.id).first("n")).toBe(1);
    const cancelled=await prepare({change:"CANCEL_TASK",taskId:task.id}); await commit(cancelled.operationId);
    expect(await env.DB.prepare("SELECT version FROM student_tasks WHERE id=?").bind(task.id).first("version")).toBe(2);
  });
  it("does not append a false resubmission revision after cancellation wins",async()=>{
    await assure(); const member=await user(); await db.update(studentSeats).set({userId:member}).where(eq(studentSeats.code,"A"));
    const task=await qaTask(), loaded=await getStudentTask(db,{userId:member,taskId:task.id,now:caller.now});
    const input={userId:member,taskId:task.id,expectedVersion:0,targetFingerprint:loaded.fingerprint,classification:{kind:"QA",decision:"PASS",note:"합성 환경에서 화면 동작을 확인했습니다.",evidenceUrl:""},now:caller.now};
    await submitStudentTask(db,input);
    const cancellation=await prepare({change:"CANCEL_TASK",taskId:task.id}), original=subjects.getStudentSubject;
    vi.spyOn(subjects,"getStudentSubject").mockImplementationOnce(async(...args)=>{ const subject=await original(...args); await commit(cancellation.operationId); return subject; });
    await expect(submitStudentTask(db,{...input,expectedVersion:1})).rejects.toThrow("STUDENT_TASK_CONFLICT");
    expect(await env.DB.prepare("SELECT count(*) n FROM student_task_revisions WHERE task_id=?").bind(task.id).first("n")).toBe(1);
    expect(await env.DB.prepare("SELECT is_active FROM student_tasks WHERE id=?").bind(task.id).first("is_active")).toBe(0);
  });
  it("rejects an in-flight student submission spanning pause and resume",async()=>{
    await assure(); const member=await user(); await db.update(studentSeats).set({userId:member}).where(eq(studentSeats.code,"A"));
    const task=await qaTask(), loaded=await getStudentTask(db,{userId:member,taskId:task.id,now:caller.now});
    const original=subjects.getStudentSubject;
    vi.spyOn(subjects,"getStudentSubject").mockImplementationOnce(async(...args)=>{
      const subject=await original(...args);
      await env.DB.prepare("UPDATE student_seats SET is_active=0 WHERE code='A'").run();
      await env.DB.prepare("UPDATE student_seats SET is_active=1 WHERE code='A'").run();
      return subject;
    });
    await expect(submitStudentTask(db,{userId:member,taskId:task.id,expectedVersion:0,targetFingerprint:loaded.fingerprint,classification:{kind:"QA",decision:"PASS",note:"합성 환경에서 화면 동작을 확인했습니다.",evidenceUrl:""},now:caller.now})).rejects.toThrow("STUDENT_TASK_CONFLICT");
    expect(await env.DB.prepare("SELECT count(*) n FROM student_task_revisions WHERE task_id=?").bind(task.id).first("n")).toBe(0);
  });
  it("denies non-admin sessions and keeps missing-assurance confirmation pending",async()=>{
    const session=crypto.randomUUID(), id=await user(); await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)").bind(session,id,caller.now,"2099-01-01T00:00:00.000Z").run();
    const request=(sid:string,form:Record<string,string>)=>new Request("https://retaste.test/admin/students",{method:"POST",headers:{Origin:"https://retaste.test","Content-Type":"application/x-www-form-urlencoded",Cookie:`retaste_session=${sid}`},body:new URLSearchParams(form)});
    await expect(action({request:request(session,{intent:"invite",seatCode:"A"})} as never)).rejects.toMatchObject({status:403});
    const p=await prepare({change:"ISSUE_INVITE",seatCode:"A"});
    const denied=await action({request:request(caller.sessionId,{intent:"confirm",operationId:p.operationId})} as never);
    expect(denied).toBeInstanceOf(Response); expect((denied as Response).status).toBe(302); expect((denied as Response).headers.get("Location")).toContain("/admin/reauth?");
    expect(await env.DB.prepare("SELECT status FROM admin_operations WHERE id=?").bind(p.operationId).first("status")).toBe("PENDING");
  });
});
