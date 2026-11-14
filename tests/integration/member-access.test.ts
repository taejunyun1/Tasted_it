import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { hashPassword } from "../../app/features/auth/password.server";
import { grantAdminAssurance } from "../../app/features/auth/admin-assurance.server";
import { authenticateAccount } from "../../app/features/auth/account.server";
import { createUserSession, getOptionalUser } from "../../app/features/auth/session.server";
import { commitMemberChange, getMemberPreview, listMembers, prepareMemberChange } from "../../app/features/members/member-admin.server";
import { readAdminActivity } from "../../app/features/operations/admin-activity.server";
import { parseActivityQuery } from "../../app/features/operations/admin-activity";
import { resolveGoogleAccount } from "../../app/features/auth/google-account.server";
import { connectNaverIdentity, disconnectNaverIdentity } from "../../app/features/auth/naver-account.server";
import { getPublicReviewerProfile } from "../../app/features/reviewers/reviewer.server";
import { assignStudentTask,getStudentTask,submitStudentTask } from "../../app/features/students/tasks.server";

let password: Awaited<ReturnType<typeof hashPassword>>;
beforeAll(async()=>{password=await hashPassword("synthetic-member-password");});
async function member(role="USER",verified=true) {
  const id=crypto.randomUUID(),now=new Date().toISOString(),email=`private-${id}@example.test`;
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,password_hash,password_salt,email_verified_at,created_at,updated_at) VALUES (?,?,'Synthetic member',?,?,?,?,?,?)").bind(id,email,role,password.hash,password.salt,verified?now:null,now,now).run();
  const cookie=await createUserSession({userId:id,now:new Date(),requestUrl:"https://retaste.test"});
  const sessionId=decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
  return {id,email,cookie,sessionId};
}
async function admin() {
  const row=await member("ADMIN");const caller={actorUserId:row.id,sessionId:row.sessionId,now:new Date().toISOString()};
  await grantAdminAssurance(env.DB,{actorUserId:row.id,sessionId:row.sessionId,now:new Date(caller.now),method:"PASSWORD"});
  return caller;
}
async function change(caller:Awaited<ReturnType<typeof admin>>,targetUserId:string,action:"RESTRICT"|"LIFT"|"REVOKE_SESSIONS",extra={}) {
  const at={...caller,now:new Date().toISOString()};
  const preview=await prepareMemberChange(env.DB,{...at,targetUserId,action,reason:"private operational reason",durationDays:7,...extra});
  return commitMemberChange(env.DB,{...at,operationId:preview.operationId});
}
async function directRestriction(userId:string,actor:string,extra={}) {
  const now=new Date();const values={starts:new Date(now.getTime()-1000).toISOString(),expires:new Date(now.getTime()+86400000).toISOString(),...extra};
  return env.DB.prepare("INSERT INTO member_access_restrictions(user_id,version,reason,starts_at,expires_at,updated_by,updated_at) VALUES (?,1,'test restriction',?,?,?,?)").bind(userId,values.starts,values.expires,actor,now.toISOString()).run();
}
const sessionUser=(cookie:string)=>getOptionalUser(new Request("https://retaste.test/me",{headers:{Cookie:cookie}}));

describe("member access and sessions",()=>{
  it("keeps access separate from role; blocks password, old cookie and DB/session creation; lift needs fresh login",async()=>{
    const caller=await admin(),target=await member("REVIEWER");
    const result=await change(caller,target.id,"RESTRICT");
    expect(await getMemberPreview(env.DB,{...caller,operationId:result.operationId})).toMatchObject({committed:true,reason:""});
    const orphan=crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO admin_operations(id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,status,result_json,created_at,expires_at,committed_at)
      VALUES (?,'MEMBER_ACCESS_CHANGE',?,?,NULL,'orphan','{"title":"test","count":1}',1,'COMMITTED','{}',?,?,?)`)
      .bind(orphan,caller.actorUserId,caller.sessionId,caller.now,new Date(Date.parse(caller.now)+600000).toISOString(),caller.now).run();
    await expect(getMemberPreview(env.DB,{...caller,operationId:orphan})).rejects.toThrow("MEMBER_RECEIPT_UNAVAILABLE");
    expect(await sessionUser(target.cookie)).toBeNull();
    await expect(authenticateAccount(createDb(env.DB),{email:target.email,password:"synthetic-member-password"})).rejects.toThrow("ACCOUNT_RESTRICTED");
    await expect(createUserSession({userId:target.id,now:new Date(),requestUrl:"https://retaste.test"})).rejects.toThrow("ACCOUNT_RESTRICTED");
    await expect(env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES (?,?,?,?)").bind(crypto.randomUUID(),target.id,new Date().toISOString(),"2099-01-01T00:00:00.000Z").run()).rejects.toThrow("ACCOUNT_RESTRICTED");
    await expect(env.DB.prepare("UPDATE sessions SET user_id=? WHERE id=?").bind(target.id,caller.sessionId).run()).rejects.toThrow("ACCOUNT_RESTRICTED");
    expect((await env.DB.prepare("SELECT role FROM users WHERE id=?").bind(target.id).first<{role:string}>())?.role).toBe("REVIEWER");
    const activity=await readAdminActivity(env.DB,parseActivityQuery(new URLSearchParams({view:"operations",operation:result.operationId}),new Date().toISOString()),new Date().toISOString());
    expect(JSON.stringify(activity)).not.toContain("private operational reason");
    await change(caller,target.id,"LIFT");
    expect(await sessionUser(target.cookie)).toBeNull();
    const next=await createUserSession({userId:target.id,now:new Date(),requestUrl:"https://retaste.test"});
    expect((await sessionUser(next))?.id).toBe(target.id);
  });
  it("expires without a cron and never resurrects deleted sessions",async()=>{
    const caller=await admin(),target=await member();
    await directRestriction(target.id,caller.actorUserId,{starts:"2000-01-01T00:00:00.000Z",expires:"2000-01-02T00:00:00.000Z"});
    expect(await sessionUser(target.cookie)).toBeNull();
    const cookie=await createUserSession({userId:target.id,now:new Date(),requestUrl:"https://retaste.test"});
    expect((await sessionUser(cookie))?.id).toBe(target.id);
  });
  it("masks searched email, binds 50-row cursor, and hides withdrawn accounts",async()=>{
    const caller=await admin(),target=await member("USER",false);
    const matched=await listMembers(env.DB,{...caller,query:target.email,targetUserId:target.id});
    expect(matched.members).toHaveLength(1);expect(JSON.stringify(matched)).not.toContain(target.email);expect(matched.selected?.emailMasked).toContain("***");
    const prefix=`listing-${crypto.randomUUID()}`;
    for(let i=0;i<51;i++) await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES (?,?,'List','USER',?,?)").bind(`${prefix}-${String(i).padStart(2,"0")}`,`${prefix}-${i}@example.test`,caller.now,caller.now).run();
    const first=await listMembers(env.DB,{...caller,query:prefix});expect(first.members).toHaveLength(50);expect(first.nextCursor).toBeTruthy();
    expect((await listMembers(env.DB,{...caller,query:prefix,cursor:first.nextCursor!})).members).toHaveLength(1);
    await expect(listMembers(env.DB,{...caller,query:"different",cursor:first.nextCursor!})).rejects.toThrow("MEMBER_INPUT_INVALID");
    await env.DB.prepare("UPDATE users SET email=? WHERE id=?").bind(`withdrawn.${target.id}@invalid.local`,target.id).run();
    expect((await listMembers(env.DB,{...caller,query:target.id})).members).toHaveLength(0);
    await expect(prepareMemberChange(env.DB,{...caller,targetUserId:target.id,action:"RESTRICT",reason:"test",durationDays:1})).rejects.toThrow("MEMBER_NOT_FOUND");
  });
  it("rejects self, overlong/future/noncanonical restriction and preserves last effective admin",async()=>{
    const caller=await admin(),target=await member();
    await expect(prepareMemberChange(env.DB,{...caller,targetUserId:caller.actorUserId,action:"RESTRICT",reason:"test",durationDays:1})).rejects.toThrow("MEMBER_SELF_RESTRICTION");
    await expect(prepareMemberChange(env.DB,{...caller,targetUserId:target.id,action:"RESTRICT",reason:"test",durationDays:91})).rejects.toThrow("MEMBER_INPUT_INVALID");
    await expect(directRestriction(target.id,caller.actorUserId,{starts:"2099-01-01T00:00:00.000Z",expires:"2099-01-02T00:00:00.000Z"})).rejects.toThrow("FUTURE");
    await expect(directRestriction(target.id,caller.actorUserId,{starts:"2026-11-14T01:00:00+09:00",expires:"2026-11-15T01:00:00+09:00"})).rejects.toThrow();
    const admins=(await env.DB.prepare("SELECT id FROM users WHERE role='ADMIN' AND email_verified_at IS NOT NULL AND id<>?").bind(caller.actorUserId).all<{id:string}>()).results;
    for(const row of admins) await env.DB.prepare("UPDATE users SET role='USER' WHERE id=?").bind(row.id).run();
    const another=await member("ADMIN");await directRestriction(another.id,caller.actorUserId);
    await expect(env.DB.prepare("UPDATE users SET role='USER' WHERE id=?").bind(caller.actorUserId).run()).rejects.toThrow("LAST_ADMIN_REQUIRED");
    await expect(directRestriction(caller.actorUserId,another.id)).rejects.toThrow("MEMBER_LAST_ADMIN");
    const system=await member("ADMIN",false),systemCaller={actorUserId:system.id,sessionId:system.sessionId,now:new Date().toISOString()};
    await grantAdminAssurance(env.DB,{...systemCaller,now:new Date(systemCaller.now),method:"PASSWORD"});
    const guarded=await prepareMemberChange(env.DB,{...systemCaller,targetUserId:caller.actorUserId,action:"RESTRICT",durationDays:1,reason:"test"});
    await expect(commitMemberChange(env.DB,{...systemCaller,operationId:guarded.operationId})).rejects.toThrow("MEMBER_LAST_ADMIN");
  });
  it("atomically rejects stale/duplicate and new-session snapshots, and revokes unverified selected/all sessions",async()=>{
    const caller=await admin(),target=await member("USER",false);
    const page=await listMembers(env.DB,{...caller,targetUserId:target.id});
    const select=await prepareMemberChange(env.DB,{...caller,targetUserId:target.id,action:"REVOKE_SESSIONS",reason:"test",selectedSessionRef:page.selected!.sessions[0]!.ref});
    await createUserSession({userId:target.id,now:new Date(),requestUrl:"https://retaste.test"});
    await expect(commitMemberChange(env.DB,{...caller,operationId:select.operationId})).rejects.toThrow();
    expect((await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?").bind(target.id).all()).results).toHaveLength(2);
    await change(caller,target.id,"REVOKE_SESSIONS");expect((await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?").bind(target.id).all()).results).toHaveLength(0);
    const first=await prepareMemberChange(env.DB,{...caller,targetUserId:target.id,action:"RESTRICT",durationDays:1,reason:"first"});
    const stale=await prepareMemberChange(env.DB,{...caller,targetUserId:target.id,action:"RESTRICT",durationDays:7,reason:"second"});
    await commitMemberChange(env.DB,{...caller,operationId:first.operationId});
    expect((await commitMemberChange(env.DB,{...caller,operationId:first.operationId})).replayed).toBe(true);
    await expect(commitMemberChange(env.DB,{...caller,operationId:stale.operationId})).rejects.toThrow();
    expect((await getMemberPreview(env.DB,{...caller,operationId:stale.operationId})).reason).toBe("second");
  });
  it("does not link or revoke provider identities for restricted accounts",async()=>{
    const caller=await admin(),target=await member();await directRestriction(target.id,caller.actorUserId);
    await expect(resolveGoogleAccount(createDb(env.DB),{providerSubject:"new-google",email:target.email,emailVerified:true,displayName:"test",now:new Date()})).rejects.toThrow("ACCOUNT_RESTRICTED");
    await expect(connectNaverIdentity(createDb(env.DB),{userId:target.id,providerSubject:"naver",email:target.email,now:new Date()})).rejects.toThrow("ACCOUNT_RESTRICTED");
    let revoked=false;
    await expect(disconnectNaverIdentity(createDb(env.DB),{userId:target.id,providerSubject:"naver",revoke:async()=>{revoked=true;}})).rejects.toThrow("ACCOUNT_RESTRICTED");
    expect(revoked).toBe(false);
  });
  it("preserves one effective admin when concurrent restrictions race",async()=>{
    const first=await member("ADMIN"),second=await member("ADMIN");
    const others=(await env.DB.prepare("SELECT id FROM users WHERE role='ADMIN' AND email_verified_at IS NOT NULL AND id NOT IN (?,?)").bind(first.id,second.id).all<{id:string}>()).results;
    for(const row of others) await env.DB.prepare("UPDATE users SET role='USER' WHERE id=?").bind(row.id).run();
    await member("ADMIN",false);
    const results=await Promise.allSettled([directRestriction(first.id,second.id),directRestriction(second.id,first.id)]);
    expect(results.filter((x)=>x.status==="fulfilled")).toHaveLength(1);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM users u WHERE role='ADMIN' AND email_verified_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM member_access_restrictions r WHERE r.user_id=u.id AND r.lifted_at IS NULL AND r.expires_at>?)`).bind(new Date().toISOString()).first<{n:number}>())?.n).toBe(1);
  });
  it("keeps the current actor session when revoking other sessions",async()=>{
    const caller=await admin();
    await createUserSession({userId:caller.actorUserId,now:new Date(),requestUrl:"https://retaste.test"});
    await change(caller,caller.actorUserId,"REVOKE_SESSIONS");
    const rows=await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?").bind(caller.actorUserId).all<{id:string}>();
    expect(rows.results).toEqual([{id:caller.sessionId}]);
  });
  it("does not change an existing public reviewer profile's eligibility",async()=>{
    const caller=await admin(),target=await member("REVIEWER");const slug=`public-${target.id}`;
    await env.DB.prepare(`INSERT INTO reviewer_profiles(user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,created_at,updated_at)
      VALUES (?,?,'ACTIVE','test','test','GWANGJU','[]',?,?,?,?)`).bind(target.id,slug,caller.now,caller.now,caller.now,caller.now).run();
    await change(caller,target.id,"RESTRICT");
    expect((await getPublicReviewerProfile(createDb(env.DB),slug))?.userId).toBe(target.id);
    expect(await sessionUser(target.cookie)).toBeNull();
  });
  it("checks the DB clock when a student write was authenticated before restriction",async()=>{
    const caller=await admin(),student=await member(),checker=await member();const db=createDb(env.DB);
    const requestTime=new Date(Date.now()-60_000).toISOString();
    for(const [code,user] of [["C",student],["D",checker]] as const) await env.DB.prepare("UPDATE student_seats SET user_id=?,is_active=1,expires_at='2099-01-01T00:00:00.000Z' WHERE code=?").bind(user.id,code).run();
    const task=await assignStudentTask(db,{actorUserId:caller.actorUserId,kind:"QA",assignedSeat:"C",checkerSeat:"D",targetId:"/places",title:"Synthetic QA",now:requestTime});
    const loaded=await getStudentTask(db,{userId:student.id,taskId:task.id,now:requestTime});
    const raced=new Proxy(db,{get(target,key,receiver){
      if(key==="batch") return async(...args:Parameters<typeof db.batch>)=>{await directRestriction(student.id,caller.actorUserId);return target.batch(...args);};
      const value=Reflect.get(target,key,receiver);return typeof value==="function"?value.bind(target):value;
    }});
    await expect(submitStudentTask(raced,{userId:student.id,taskId:task.id,expectedVersion:0,targetFingerprint:loaded.fingerprint,classification:{kind:"QA",decision:"PASS",note:"Synthetic QA result",evidenceUrl:""},now:requestTime})).rejects.toThrow("STUDENT_TASK_CONFLICT");
    expect((await env.DB.prepare("SELECT version FROM student_tasks WHERE id=?").bind(task.id).first<{version:number}>())?.version).toBe(0);
  });
  it("blocks an identity unlink if restriction arrives during provider await and permits account cleanup",async()=>{
    const caller=await admin(),target=await member();
    await env.DB.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_subject,provider_email,created_at,updated_at) VALUES (?,?,'NAVER',?,?,?,?)").bind(crypto.randomUUID(),target.id,target.id,target.email,caller.now,caller.now).run();
    await expect(disconnectNaverIdentity(createDb(env.DB),{userId:target.id,providerSubject:target.id,revoke:async()=>{await directRestriction(target.id,caller.actorUserId);}})).rejects.toThrow("ACCOUNT_RESTRICTED");
    expect((await env.DB.prepare("SELECT id FROM auth_identities WHERE user_id=?").bind(target.id).all()).results).toHaveLength(1);
    await expect(env.DB.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_subject,provider_email,created_at,updated_at) VALUES (?,?,'GOOGLE',?,?,?,?)").bind(crypto.randomUUID(),target.id,crypto.randomUUID(),target.email,caller.now,caller.now).run()).rejects.toThrow("ACCOUNT_ACCESS_CHANGED");
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(target.id).run();
    expect((await env.DB.prepare("SELECT id FROM auth_identities WHERE user_id=?").bind(target.id).all()).results).toHaveLength(0);
  });
  it("rejects authentication begun before a restrict-and-lift cycle",async()=>{
    const caller=await admin(),target=await member();const started=new Date(Date.now()-60000);
    await env.DB.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_subject,provider_email,created_at,updated_at) VALUES (?,?,'NAVER',?,?,?,?)").bind(crypto.randomUUID(),target.id,target.id,target.email,caller.now,caller.now).run();
    await expect(disconnectNaverIdentity(createDb(env.DB),{userId:target.id,providerSubject:target.id,now:started,revoke:async()=>{
      await directRestriction(target.id,caller.actorUserId);
      await env.DB.prepare("UPDATE member_access_restrictions SET lifted_at=?,updated_at=?,version=2 WHERE user_id=?").bind(new Date().toISOString(),new Date().toISOString(),target.id).run();
    }})).rejects.toThrow("ACCOUNT_RESTRICTED");
    await expect(createUserSession({userId:target.id,now:started,requestUrl:"https://retaste.test"})).rejects.toThrow("ACCOUNT_ACCESS_CHANGED");
    await expect(connectNaverIdentity(createDb(env.DB),{userId:target.id,providerSubject:"different",email:target.email,now:started})).rejects.toThrow();
    await expect(resolveGoogleAccount(createDb(env.DB),{providerSubject:"pre-restriction",email:target.email,emailVerified:true,displayName:"test",now:started})).rejects.toThrow("ACCOUNT_RESTRICTED");
    const fresh=await createUserSession({userId:target.id,now:new Date(),requestUrl:"https://retaste.test"});
    expect((await sessionUser(fresh))?.id).toBe(target.id);
  });
});
