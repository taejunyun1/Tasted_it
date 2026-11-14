import { z } from "zod";
import { sha256Hex } from "../auth/google-oauth.server";
import { isWithdrawnEmail } from "../auth/withdraw";
import { commitAdminOperation, getAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";

type Caller = { actorUserId: string; sessionId: string; now: string };
type Member = { id: string; displayName: string; email: string; role: "USER" | "REVIEWER" | "ADMIN"; updatedAt: string };
type Restriction = { version: number; reason: string; startsAt: string; expiresAt: string; liftedAt: string | null };
type Session = { rowId: number; id: string; createdAt: string; expiresAt: string };
type Action = "RESTRICT" | "LIFT" | "REVOKE_SESSIONS";
type Payload = { targetUserId: string; action: Action; reason: string; expectedVersion: number; expectedUpdatedAt: string;
  expectedRole: Member["role"]; startsAt: string; expiresAt: string | null; sessions: Array<Omit<Session, "id">>; selectedRows: number[] };
const active = (r: Restriction | null, now: string) => !!r && !r.liftedAt && r.startsAt <= now && r.expiresAt > now;
const cursorSchema = z.object({ version: z.literal(1), query: z.string().max(100), after: z.string().min(1).max(128) }).strict();
function fail(code: string): never { throw new Error(code); }
function emailMask(value: string) { const [local, domain] = value.split("@"); return `${local?.slice(0, 1) || "*"}***@${domain ?? "***"}`; }
async function authorize(db: D1Database, caller: Caller) {
  const found = await db.prepare(`SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND u.id=? AND s.expires_at>? AND u.role='ADMIN' AND u.email NOT LIKE 'withdrawn.%@invalid.local'
    AND NOT EXISTS(SELECT 1 FROM member_access_restrictions r WHERE r.user_id=u.id AND r.lifted_at IS NULL AND r.starts_at<=? AND r.expires_at>?)`)
    .bind(caller.sessionId, caller.actorUserId, caller.now, caller.now, caller.now).first();
  if (!found) fail("ADMIN_REQUIRED");
}
async function member(db: D1Database, userId: string) {
  const row = await db.prepare("SELECT id,display_name AS displayName,email,role,updated_at AS updatedAt FROM users WHERE id=?").bind(userId).first<Member>();
  if (!row || isWithdrawnEmail(row.email)) fail("MEMBER_NOT_FOUND");
  return row;
}
async function restriction(db: D1Database, userId: string) {
  return db.prepare("SELECT version,reason,starts_at AS startsAt,expires_at AS expiresAt,lifted_at AS liftedAt FROM member_access_restrictions WHERE user_id=?").bind(userId).first<Restriction>();
}
async function sessions(db: D1Database, userId: string) {
  const result = await db.prepare("SELECT rowid AS rowId,id,created_at AS createdAt,expires_at AS expiresAt FROM sessions WHERE user_id=? ORDER BY rowid LIMIT 1001").bind(userId).all<Session>();
  if (result.results.length > 1000) fail("MEMBER_SESSION_LIMIT");
  return result.results;
}
const ref = (value: string) => sha256Hex(`member-session-reference:${value}`);
function publicMember(user: Member, r: Restriction | null, now: string) {
  return { id: user.id, displayName: user.displayName, emailMasked: emailMask(user.email), role: user.role,
    accessStatus: active(r, now) ? "RESTRICTED" as const : "ACTIVE" as const, restrictionExpiresAt: r?.expiresAt ?? null };
}
export async function listMembers(db: D1Database, input: Caller & { query?: string; cursor?: string; targetUserId?: string }) {
  await authorize(db, input);
  const query = (input.query ?? "").trim();
  if (query.length > 100) fail("MEMBER_INPUT_INVALID");
  let after = "";
  if (input.cursor) {
    try {
      if (input.cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) fail("MEMBER_INPUT_INVALID");
      const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(input.cursor.replace(/-/g,"+").replace(/_/g,"/")), (c) => c.charCodeAt(0))));
      const cursor = cursorSchema.parse(decoded);
      if (cursor.query !== query) fail("MEMBER_INPUT_INVALID");
      after = cursor.after;
    } catch { fail("MEMBER_INPUT_INVALID"); }
  }
  const result = await db.prepare(`SELECT u.id,u.display_name AS displayName,u.email,u.role,u.updated_at AS updatedAt,
    r.starts_at AS restrictionStart,r.expires_at AS restrictionEnd,r.lifted_at AS restrictionLifted
    FROM users u LEFT JOIN member_access_restrictions r ON r.user_id=u.id
    WHERE u.id>? AND u.email NOT LIKE 'withdrawn.%@invalid.local'
    AND (instr(lower(u.display_name),lower(?))>0 OR instr(lower(u.email),lower(?))>0 OR instr(lower(u.id),lower(?))>0)
    ORDER BY u.id LIMIT 51`).bind(after, query, query, query).all<Member & {restrictionStart:string|null;restrictionEnd:string|null;restrictionLifted:string|null}>();
  const users = result.results.slice(0,50);
  const members = users.map((u) => publicMember(u,u.restrictionStart && u.restrictionEnd ? {version:0,reason:"",startsAt:u.restrictionStart,expiresAt:u.restrictionEnd,liftedAt:u.restrictionLifted}:null,input.now));
  const nextCursor = result.results.length > 50 ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ version:1,query,after:users.at(-1)!.id })))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","") : null;
  let selected = null;
  if (input.targetUserId) {
    const user = await member(db,input.targetUserId); const r=await restriction(db,user.id);
    selected = { ...publicMember(user,r,input.now), restrictionReason:r?.reason ?? null, restrictionVersion:r?.version ?? 0,
      sessions: await Promise.all((await sessions(db,user.id)).filter((s)=>s.expiresAt>input.now).map(async(s)=>({ref:await ref(s.id),createdAt:s.createdAt,expiresAt:s.expiresAt,isCurrent:s.id===input.sessionId}))) };
  }
  return { members, nextCursor, selected };
}
export async function prepareMemberChange(db: D1Database, input: Caller & { targetUserId: string; action: Action; reason: string; durationDays?: number; selectedSessionRef?: string }) {
  await authorize(db,input);
  const reason = input.reason.trim();
  if (reason.length<2 || reason.length>300 || reason.includes("\0") || !["RESTRICT","LIFT","REVOKE_SESSIONS"].includes(input.action)) fail("MEMBER_INPUT_INVALID");
  if (input.action!=="REVOKE_SESSIONS" && input.targetUserId===input.actorUserId) fail("MEMBER_SELF_RESTRICTION");
  const user=await member(db,input.targetUserId), current=await restriction(db,user.id), snapshot=await sessions(db,user.id);
  let expiresAt: string|null=null;
  if(input.action==="RESTRICT") {
    if(!Number.isInteger(input.durationDays) || input.durationDays!<1 || input.durationDays!>90) fail("MEMBER_INPUT_INVALID");
    expiresAt=new Date(Date.parse(input.now)+input.durationDays!*86400000).toISOString();
  } else if(input.action==="LIFT" && !current) fail("MEMBER_INPUT_INVALID");
  const selectedRows:number[]=[];
  for(const s of snapshot) if(s.id!==input.sessionId && s.expiresAt>input.now && (!input.selectedSessionRef || await ref(s.id)===input.selectedSessionRef)) selectedRows.push(s.rowId);
  if(input.action==="REVOKE_SESSIONS" && (!selectedRows.length || (input.selectedSessionRef && selectedRows.length!==1))) fail("MEMBER_STALE");
  const payload:Payload={targetUserId:user.id,action:input.action,reason,expectedVersion:current?.version??0,expectedUpdatedAt:user.updatedAt,expectedRole:user.role,
    startsAt:current?.startsAt??input.now,expiresAt:input.action==="RESTRICT"?expiresAt:current?.expiresAt??null,
    sessions:snapshot.map(({id:_,...s})=>s),selectedRows};
  return prepareAdminOperation(db,{...input,kind:"MEMBER_ACCESS_CHANGE",payload,summary:{title:input.action==="RESTRICT"?"회원 접근 제한":input.action==="LIFT"?"회원 접근 제한 해제":"회원 세션 회수",count:1}});
}
export async function getMemberPreview(db:D1Database,input:Caller&{operationId:string}) {
  const op=await getAdminOperation(db,{...input,kind:"MEMBER_ACCESS_CHANGE"});
  if(op.status==="COMMITTED") {
    const receipt=await db.prepare(`SELECT 1 FROM admin_operations o JOIN admin_operation_commits c
      ON c.operation_id=o.id AND c.actor_user_id=o.actor_user_id AND c.kind=o.kind AND c.committed_at=o.committed_at
      WHERE o.id=? AND o.status='COMMITTED' AND c.session_id=? AND o.actor_user_id=? AND o.kind='MEMBER_ACCESS_CHANGE'
      AND (SELECT COUNT(*) FROM admin_audit_logs a WHERE a.action='ADMIN_OPERATION_COMMITTED'
        AND a.target_type='ADMIN_OPERATION' AND a.target_id=o.id AND a.actor_user_id=o.actor_user_id)=1`)
      .bind(op.id,input.sessionId,input.actorUserId).first();
    if(!receipt) fail("MEMBER_RECEIPT_UNAVAILABLE");
    const result=op.result as {targetUserId:string;change:Action;expiresAt:string|null;revokedSessions:number};
    const user=await member(db,result.targetUserId).catch(()=>null);
    return {operationId:op.id,committed:true,action:result.change,displayName:user?.displayName??"회원",emailMasked:user?emailMask(user.email):"",reason:"",expiresAt:result.expiresAt,sessionCount:result.revokedSessions};
  }
  const p=op.payload as Payload; const user=await member(db,p.targetUserId);
  return {operationId:op.id,committed:false,action:p.action,displayName:user.displayName,emailMasked:emailMask(user.email),reason:p.reason,
    expiresAt:p.action==="RESTRICT"?p.expiresAt:null,sessionCount:p.action==="REVOKE_SESSIONS"?p.selectedRows.length:p.sessions.length};
}
export async function commitMemberChange(db:D1Database,input:Caller&{operationId:string}) {
  return commitAdminOperation(db,{...input,kind:"MEMBER_ACCESS_CHANGE"},async(op)=>{
    const p=op.payload as Payload;
    if(p.action!=="REVOKE_SESSIONS"&&p.targetUserId===input.actorUserId) fail("MEMBER_SELF_RESTRICTION");
    if(p.action==="RESTRICT"&&(!p.expiresAt||p.expiresAt<=input.now)) fail("MEMBER_STALE");
    const checks=[db.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?,'member-version',CASE WHEN EXISTS(SELECT 1 FROM users WHERE id=? AND updated_at=? AND role=? AND email NOT LIKE 'withdrawn.%@invalid.local')
      AND COALESCE((SELECT version FROM member_access_restrictions WHERE user_id=?),0)=? THEN 1 ELSE 0 END`)
      .bind(input.operationId,p.targetUserId,p.expectedUpdatedAt,p.expectedRole,p.targetUserId,p.expectedVersion),
      db.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?,'member-sessions',CASE WHEN (SELECT COUNT(*) FROM sessions WHERE user_id=?)=?
      AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=? AND NOT EXISTS(SELECT 1 FROM json_each(?) j
       WHERE json_extract(j.value,'$.rowId')=s.rowid AND json_extract(j.value,'$.createdAt')=s.created_at AND json_extract(j.value,'$.expiresAt')=s.expires_at)) THEN 1 ELSE 0 END`)
      .bind(input.operationId,p.targetUserId,p.sessions.length,p.targetUserId,JSON.stringify(p.sessions))];
    const statements:D1PreparedStatement[]=[];
    if(p.action==="REVOKE_SESSIONS") statements.push(db.prepare(`DELETE FROM sessions WHERE user_id=? AND rowid IN(SELECT value FROM json_each(?)) AND id<>?`).bind(p.targetUserId,JSON.stringify(p.selectedRows),input.sessionId));
    else statements.push(db.prepare(`INSERT INTO member_access_restrictions(user_id,version,reason,starts_at,expires_at,lifted_at,updated_by,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,reason=excluded.reason,starts_at=excluded.starts_at,
      expires_at=excluded.expires_at,lifted_at=excluded.lifted_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(p.targetUserId,p.expectedVersion+1,p.reason,p.action==="RESTRICT"?input.now:p.startsAt,p.expiresAt,p.action==="LIFT"?input.now:null,input.actorUserId,input.now));
    const current=await restriction(db,p.targetUserId);
    const restricted=p.action==="RESTRICT"||(p.action==="REVOKE_SESSIONS"&&active(current,input.now));
    return {checks,statements,result:{targetUserId:p.targetUserId,change:p.action,status:restricted?"RESTRICTED":"ACTIVE",expiresAt:restricted?(p.action==="RESTRICT"?p.expiresAt:current?.expiresAt??null):null,
      revokedSessions:p.action==="REVOKE_SESSIONS"?p.selectedRows.length:p.sessions.length,reasonCode:p.action==="RESTRICT"?"OPERATOR_RESTRICTION":p.action==="LIFT"?"OPERATOR_LIFT":"OPERATOR_SESSION_REVOKE"}};
  });
}
