import { z } from "zod";
import { createDb } from "../../db/client.server";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";
import { assignmentSchema, seatCodeSchema, type TaskKind } from "./policy";
import { getStudentSubject } from "./subjects.server";
import { requireStudentAdmin } from "./invitations.server";

type Caller = { actorUserId: string; sessionId: string; now: string };
type Bound = Caller & { operationId: string };
const KIND = "STUDENT_ADMIN_CHANGE" as const;
const rowSchema = z.object({ targetRef: z.string().min(1).max(128), outcome: z.enum(["APPLY", "SKIP", "APPLIED"]), code: z.string().max(40), targetId: z.string().min(1).max(128).optional(), targetType: z.enum(["SEAT","TASK","WORK_ITEM"]).optional() }).strict();
const resultSchema = z.object({ change: z.string().max(40), requestedCount: z.number().int().min(1).max(25), appliedCount: z.number().int().min(0).max(25), skippedCount: z.number().int().min(0).max(25), results: z.array(rowSchema).max(25) }).strict();
export type StudentAdminView = { id: string; status: "PENDING" | "COMMITTED"; expiresAt: string; change: string; rows: (z.infer<typeof rowSchema> & {label?:string})[]; requestedCount: number; appliedCount?: number; skippedCount: number };
export type StudentAdminCommand = { change: "ISSUE_INVITE"; seatCode: string } | { change: "SET_ACCESS"; seatCode: string; active: boolean } | { change: "CANCEL_TASK"; taskId: string } | { change: "ASSIGN_TASK"; kind: TaskKind; assignedSeat: string; checkerSeat: string; targetId: string; title: string } | { change: "BATCH_ASSIGN"; assignedSeat: string; checkerSeat: string; targetIds: string[] };
const columns = {
  student_seats: ["code", "user_id", "is_active", "can_classify_places", "can_classify_reviews", "can_record_qa", "can_approve_registration", "expires_at", "version"],
  student_tasks: ["id", "kind", "target_id", "assigned_seat", "checker_seat", "is_active", "status", "version"],
  place_review_work_items: ["id", "business_license_id", "place_id", "source_kind", "stage", "status", "selected_category_id", "stage_version", "updated_at"],
  reviewer_visit_reviews: ["id", "place_id", "version", "content_version", "status", "updated_at"],
  places: ["id", "name", "address", "status", "latitude", "longitude", "updated_at"],
  business_licenses: ["id", "business_name", "business_subtype", "normalized_status", "lot_address", "road_address", "latitude", "longitude", "updated_at"],
} as const;
type Table = keyof typeof columns;
type Snapshot = { table: Table; values: Record<string, string | number | null> };
type Seat = { code: string; user_id: string | null; is_active: number; can_classify_places: number; can_classify_reviews: number; can_record_qa: number; can_approve_registration: number; expires_at: string; version: number };
type PlannedTask = { id: string; kind: TaskKind; targetId: string; title: string; assignedSeat: string; checkerSeat: string; targetRef: string };
type Payload = { change: StudentAdminCommand["change"]; snapshots: Snapshot[]; rows: z.infer<typeof rowSchema>[]; tasks: PlannedTask[]; seatCode?: string; active?: boolean; taskId?: string; inviteIds: string[] };
const scalar = z.union([z.string(), z.number(), z.null()]);
const payloadSchema = z.object({ change: z.enum(["ISSUE_INVITE", "SET_ACCESS", "CANCEL_TASK", "ASSIGN_TASK", "BATCH_ASSIGN"]), snapshots: z.array(z.object({ table: z.enum(["student_seats", "student_tasks", "place_review_work_items", "reviewer_visit_reviews", "places", "business_licenses"]), values: z.record(z.string(), scalar) }).strict()).max(100), rows: z.array(rowSchema).min(1).max(25), tasks: z.array(z.object({ id: z.uuid(), kind: z.enum(["PLACE", "REVIEW", "QA"]), targetId: z.string().min(1).max(512), title: z.string().max(120), assignedSeat: seatCodeSchema, checkerSeat: seatCodeSchema, targetRef: z.string().max(128) }).strict()).max(25), seatCode: seatCodeSchema.optional(), active: z.boolean().optional(), taskId: z.string().max(128).optional(), inviteIds: z.array(z.string().max(128)).max(100) }).strict();
function fail(code: string): never { throw new Error(code); }
async function digest(value: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, "0")).join(""); }
async function snapshot(db: D1Database, table: Table, id: string): Promise<Snapshot | null> {
  const key = table === "student_seats" ? "code" : "id";
  const values = await db.prepare(`SELECT ${columns[table].join(",")} FROM ${table} WHERE ${key}=?`).bind(id).first<Record<string, string | number | null>>();
  return values ? { table, values } : null;
}
function predicate(s: Snapshot) {
  if (!Object.hasOwn(columns, s.table) || Object.keys(s.values).length !== columns[s.table].length || columns[s.table].some(k => !Object.hasOwn(s.values,k))) fail("STUDENT_INPUT_INVALID");
  return { sql: `EXISTS(SELECT 1 FROM ${s.table} WHERE ${columns[s.table].map(k => `${k} IS ?`).join(" AND ")})`, values: columns[s.table].map(k => s.values[k]!) };
}
async function seatSnapshot(db: D1Database, code: string) {
  const s = await snapshot(db, "student_seats", seatCodeSchema.parse(code));
  if (!s) fail("STUDENT_SEAT_UNAVAILABLE");
  return s;
}
function requireSeat(s: Snapshot, kind: TaskKind, now: string) {
  const v = s.values as Seat;
  const cap = kind === "PLACE" ? v.can_classify_places : kind === "REVIEW" ? v.can_classify_reviews : v.can_record_qa;
  if (!v.is_active || !cap || v.expires_at <= now) fail("STUDENT_CAPABILITY_REQUIRED");
}
async function sourceSnapshots(db: D1Database, kind: TaskKind, targetId: string) {
  if (kind === "QA") return [];
  const result: Snapshot[] = [];
  const main = await snapshot(db, kind === "PLACE" ? "place_review_work_items" : "reviewer_visit_reviews", targetId);
  if (!main || (kind === "PLACE" && main.values.status !== "ACTIVE")) fail("STUDENT_TARGET_UNAVAILABLE");
  result.push(main);
  if (typeof main.values.place_id === "string") {
    const place = await snapshot(db,"places",main.values.place_id); if (!place || (kind === "REVIEW" && place.values.status !== "PUBLISHED")) fail("STUDENT_TARGET_UNAVAILABLE"); result.push(place);
  }
  if (typeof main.values.business_license_id === "string") {
    const license = await snapshot(db,"business_licenses",main.values.business_license_id); if (!license) fail("STUDENT_TARGET_UNAVAILABLE"); result.push(license);
  }
  return result;
}
async function pendingInvites(db: D1Database, code: string) {
  const rows = (await db.prepare("SELECT id FROM student_invitations WHERE seat_code=? AND consumed_at IS NULL AND revoked_at IS NULL ORDER BY id LIMIT 101").bind(code).all<{id:string}>()).results;
  if (rows.length > 100) fail("STUDENT_INPUT_INVALID");
  return rows.map(r => r.id);
}
export async function prepareStudentAdminOperation(db: D1Database, input: Caller & { command: StudentAdminCommand }) {
  await requireStudentAdmin(createDb(db), input.actorUserId);
  const c = input.command;
  const p: Payload = { change: c.change, snapshots: [], rows: [], tasks: [], inviteIds: [] };
  if (c.change === "ISSUE_INVITE" || c.change === "SET_ACCESS") {
    const s = await seatSnapshot(db,c.seatCode), v = s.values as Seat;
    p.snapshots.push(s); p.seatCode = v.code; p.inviteIds = await pendingInvites(db,v.code);
    if (c.change === "ISSUE_INVITE" && (v.user_id || !v.is_active || v.expires_at <= input.now)) fail("STUDENT_SEAT_UNAVAILABLE");
    if (c.change === "SET_ACCESS") p.active = z.boolean().parse(c.active);
    p.rows.push({ targetRef: v.code, targetId:v.code, targetType:"SEAT", outcome: "APPLY", code: c.change === "ISSUE_INVITE" ? "INVITE_ISSUED" : c.active ? "ACCESS_ENABLED" : "ACCESS_DISABLED" });
  } else if (c.change === "CANCEL_TASK") {
    p.taskId = z.string().min(1).max(128).parse(c.taskId);
    const task = await snapshot(db,"student_tasks",p.taskId);
    if (!task || task.values.is_active !== 1) fail("STUDENT_TASK_NOT_FOUND");
    p.snapshots.push(task); p.rows.push({ targetRef: p.taskId, targetId:p.taskId, targetType:"TASK", outcome: "APPLY", code: "TASK_CANCELLED" });
  } else {
    const batch = c.change === "BATCH_ASSIGN";
    const values = c.change === "BATCH_ASSIGN" ? { kind: "PLACE" as const, assignedSeat: seatCodeSchema.parse(c.assignedSeat), checkerSeat: seatCodeSchema.parse(c.checkerSeat) } : assignmentSchema.parse({kind:c.kind,assignedSeat:c.assignedSeat,checkerSeat:c.checkerSeat,targetId:c.targetId,title:c.title});
    if (values.assignedSeat === values.checkerSeat) fail("STUDENT_INPUT_INVALID");
    for (const code of [values.assignedSeat,values.checkerSeat]) { const s = await seatSnapshot(db,code); requireSeat(s,values.kind,input.now); p.snapshots.push(s); }
    const ids = c.change === "BATCH_ASSIGN" ? [...new Set(z.array(z.string().min(1).max(128)).min(1).max(25).parse(c.targetIds))] : [c.targetId];
    for (const id of ids) {
      const ref = `s-${(await digest(`${values.kind}:${id}`)).slice(0,24)}`;
      const existing = values.kind === "QA" ? null : await db.prepare("SELECT id FROM student_tasks WHERE kind=? AND target_id=? AND is_active=1 LIMIT 1").bind(values.kind,id).first<{id:string}>();
      if (existing) { p.rows.push({targetRef:ref,targetId:existing.id,targetType:"TASK",outcome:"SKIP",code:"ALREADY_ASSIGNED"}); continue; }
      try {
        const sources = await sourceSnapshots(db,values.kind,id);
        const subject = await getStudentSubject(createDb(db),values.kind,id,input.now);
        const taskId=crypto.randomUUID();
        p.snapshots.push(...sources); p.tasks.push({id:taskId,kind:values.kind,targetId:id,title:c.change === "BATCH_ASSIGN" ? `${subject.title} 분류`.slice(0,120) : c.title,assignedSeat:values.assignedSeat,checkerSeat:values.checkerSeat,targetRef:ref});
        p.rows.push({targetRef:ref,targetId:taskId,targetType:"TASK",outcome:"APPLY",code:"ASSIGNED"});
      } catch (error) {
        if (!batch || !["STUDENT_TARGET_UNAVAILABLE", "STUDENT_SOURCE_CHANGED"].includes(error instanceof Error ? error.message : "")) throw error;
        p.rows.push({targetRef:ref,targetId:id,targetType:"WORK_ITEM",outcome:"SKIP",code:"SOURCE_UNAVAILABLE"});
      }
    }
  }
  return prepareAdminOperation(db,{...input,kind:KIND,payload:p,summary:{title:"학생 계정·업무 변경",count:p.rows.length}});
}
async function visibleRows(db:D1Database, rows:z.infer<typeof rowSchema>[], tasks:PlannedTask[] = []) {
  return Promise.all(rows.map(async row=>{
    let label:string|null=null;
    if (row.targetType==="SEAT") label=`학생 ${row.targetId}`;
    if (row.targetType==="TASK") label=tasks.find(t=>t.id===row.targetId)?.title ?? await db.prepare("SELECT title FROM student_tasks WHERE id=?").bind(row.targetId!).first<string>("title");
    if (row.targetType==="WORK_ITEM") label=await db.prepare("SELECT coalesce(p.name,b.business_name) title FROM place_review_work_items w LEFT JOIN places p ON p.id=w.place_id LEFT JOIN business_licenses b ON b.id=w.business_license_id WHERE w.id=?").bind(row.targetId!).first<string>("title");
    return {...row,label:label??`대상 없음 · ${row.targetId??row.targetRef}`};
  }));
}
export async function getStudentAdminOperation(db: D1Database, input: Bound): Promise<StudentAdminView> {
  const op = await getVerifiedAdminOperation(db,{...input,kind:KIND});
  if (op.status === "COMMITTED") {
    const r = resultSchema.parse(op.result);
    return {id:op.id,status:op.status,expiresAt:op.expiresAt,change:r.change,rows:await visibleRows(db,r.results),requestedCount:r.requestedCount,appliedCount:r.appliedCount,skippedCount:r.skippedCount};
  }
  const p = payloadSchema.parse(op.payload);
  return {id:op.id,status:op.status,expiresAt:op.expiresAt,change:p.change,rows:await visibleRows(db,p.rows,p.tasks),requestedCount:p.rows.length,skippedCount:p.rows.filter(r=>r.outcome==="SKIP").length};
}
export async function commitStudentAdminOperation(db: D1Database, input: Bound) {
  await getStudentAdminOperation(db,input);
  let invitation: {token:string;seatCode:string;expiresAt:string} | undefined;
  const committed = await commitAdminOperation(db,{...input,kind:KIND},async op => {
    const p = payloadSchema.parse(op.payload);
    const checks = p.snapshots.map((s,i) => { const q = predicate(s); return db.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) SELECT ?,?,CASE WHEN " + q.sql + " THEN 1 ELSE 0 END").bind(op.id,`snapshot-${i}`,...q.values); });
    const statements: D1PreparedStatement[] = [];
    for (const s of p.snapshots.filter(s=>s.table === "student_seats")) {
      if (p.change === "ASSIGN_TASK" || p.change === "BATCH_ASSIGN") checks.push(db.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM student_seats WHERE code=? AND is_active=1 AND expires_at>?) THEN 1 ELSE 0 END").bind(op.id,`seat-time-${s.values.code}`,s.values.code!,input.now));
    }
    for (const t of p.tasks) {
      if (t.kind !== "QA") checks.push(db.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) SELECT ?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM student_tasks WHERE kind=? AND target_id=? AND is_active=1) THEN 1 ELSE 0 END").bind(op.id,`vacant-${t.id}`,t.kind,t.targetId));
      statements.push(db.prepare("INSERT INTO student_tasks(id,kind,target_id,title,assigned_seat,checker_seat,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(t.id,t.kind,t.targetId,t.title,t.assignedSeat,t.checkerSeat,input.actorUserId,input.now,input.now));
    }
    if (p.seatCode) {
      checks.push(db.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) SELECT ?,?,CASE WHEN (SELECT count(*) FROM student_invitations WHERE seat_code=? AND consumed_at IS NULL AND revoked_at IS NULL)=? AND NOT EXISTS(SELECT 1 FROM student_invitations WHERE seat_code=? AND consumed_at IS NULL AND revoked_at IS NULL AND id NOT IN (SELECT value FROM json_each(?))) THEN 1 ELSE 0 END").bind(op.id,"pending-invites",p.seatCode,p.inviteIds.length,p.seatCode,JSON.stringify(p.inviteIds)));
      if (p.change === "ISSUE_INVITE") {
        checks.push(db.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM student_seats WHERE code=? AND user_id IS NULL AND is_active=1 AND expires_at>?) THEN 1 ELSE 0 END").bind(op.id,"seat-available",p.seatCode,input.now));
        const seat = p.snapshots.find(s=>s.table==="student_seats")!;
        const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
        const expiresAt = new Date(Math.min(Date.parse(input.now)+7*86400000,Date.parse(String(seat.values.expires_at)))).toISOString();
        invitation = {token,seatCode:p.seatCode,expiresAt};
        statements.push(db.prepare("INSERT INTO student_invitations(id,seat_code,token_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),p.seatCode,await digest(token),expiresAt,input.actorUserId,input.now));
        statements.push(db.prepare("UPDATE student_seats SET updated_at=? WHERE code=?").bind(input.now,p.seatCode));
      } else statements.push(db.prepare("UPDATE student_seats SET is_active=?,updated_at=? WHERE code=?").bind(p.active?1:0,input.now,p.seatCode));
      // Only the frozen old invitations are revoked; the newly issued link survives.
      for (const id of p.inviteIds) statements.push(db.prepare("UPDATE student_invitations SET revoked_at=? WHERE id=?").bind(input.now,id));
    }
    if (p.change === "CANCEL_TASK") statements.push(db.prepare("UPDATE student_tasks SET is_active=0,version=version+1,updated_at=? WHERE id=?").bind(input.now,p.taskId!));
    // Even a completely skipped batch has a receipt, bound to its frozen seat snapshots.
    const results = p.rows.map(r=>({...r,outcome:r.outcome==="APPLY"?"APPLIED" as const:"SKIP" as const}));
    return {checks,statements,result:{change:p.change,requestedCount:results.length,appliedCount:results.filter(r=>r.outcome==="APPLIED").length,skippedCount:results.filter(r=>r.outcome==="SKIP").length,results}};
  });
  // Replayed or uncertain success must never disclose a fresh, unrelated link.
  return {...committed,invitation:committed.replayed?undefined:invitation};
}
