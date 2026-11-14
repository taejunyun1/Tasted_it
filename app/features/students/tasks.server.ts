import { and, desc, eq, gt, isNotNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../../db/client.server";
import { studentSeats, studentTaskRevisions, studentTasks, users } from "../../db/schema";
import { getStudentSeat, requireStudentAdmin, studentAudit } from "./invitations.server";
import { assignmentSchema, classificationSchema, mayReviewTask, type TaskKind } from "./policy";
import { getStudentSubject, studentCategoryChoices } from "./subjects.server";

type Seat = typeof studentSeats.$inferSelect;
type Task = typeof studentTasks.$inferSelect;
function capability(seat: Seat, kind: TaskKind) {
  return kind === "PLACE" ? seat.canClassifyPlaces : kind === "REVIEW" ? seat.canClassifyReviews : seat.canRecordQa;
}
export async function requireStudentSeat(db: AppDb, userId: string, now: string) {
  const seat = await getStudentSeat(db, { userId, now });
  if (!seat) throw new Error("STUDENT_ACCESS_DENIED");
  return seat;
}
function currentCapability(userId: string, kind: TaskKind, now: string, registration = false) {
  const column = registration ? studentSeats.canApproveRegistration : kind === "PLACE" ? studentSeats.canClassifyPlaces : kind === "REVIEW" ? studentSeats.canClassifyReviews : studentSeats.canRecordQa;
  return sql`exists (select 1 from ${studentSeats} inner join ${users} on ${users.id} = ${studentSeats.userId} where ${studentSeats.userId} = ${userId} and ${studentSeats.isActive} = 1 and ${studentSeats.expiresAt} > ${now} and ${column} = 1 and ${users.emailVerifiedAt} is not null and ${users.role} <> 'ADMIN'
    and not exists(select 1 from member_access_restrictions r where r.user_id=${userId} and r.lifted_at is null and r.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') and r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`;
}

export async function assignStudentTask(db: AppDb, input: z.infer<typeof assignmentSchema> & { actorUserId: string; now: string }) {
  await requireStudentAdmin(db, input.actorUserId);
  const { actorUserId, now, ...raw } = input;
  const values = assignmentSchema.parse(raw);
  for (const code of [values.assignedSeat, values.checkerSeat]) {
    const seat = await db.query.studentSeats.findFirst({ where: eq(studentSeats.code, code) });
    if (!seat || !seat.isActive || seat.expiresAt <= now || !capability(seat, values.kind)) throw new Error("STUDENT_CAPABILITY_REQUIRED");
  }
  await getStudentSubject(db, values.kind, values.targetId, now);
  const id = crypto.randomUUID();
  try { await db.insert(studentTasks).values({ id, ...values, createdBy: actorUserId, createdAt: now, updatedAt: now }); }
  catch { throw new Error("STUDENT_TASK_DUPLICATE"); }
  await studentAudit(db, actorUserId, "STUDENT_TASK_ASSIGNED", id, values, now);
  return { id };
}

export async function listStudentTasks(db: AppDb, input: { userId: string; now: string; page?: number }) {
  const seat = await requireStudentSeat(db, input.userId, input.now);
  const page = z.number().int().min(1).max(10_000).parse(input.page ?? 1);
  const scope = and(eq(studentTasks.isActive, true), or(eq(studentTasks.assignedSeat, seat.code), eq(studentTasks.checkerSeat, seat.code)));
  const [rows, [count]] = await Promise.all([
    db.select().from(studentTasks).where(scope).orderBy(desc(studentTasks.updatedAt), desc(studentTasks.id)).limit(50).offset((page - 1) * 50),
    db.select({ total: sql<number>`count(*)` }).from(studentTasks).where(scope),
  ]);
  const tasks = rows.filter((t) => capability(seat, t.kind)).map(({ id, kind, title, status, assignedSeat, checkerSeat, updatedAt }) => ({ id, kind, title, status, assignedSeat, checkerSeat, updatedAt }));
  return { seat, tasks, page, total: Number(count?.total ?? 0) };
}

async function taskContext(db: AppDb, input: { userId: string; taskId: string; now: string }) {
  const seat = await requireStudentSeat(db, input.userId, input.now);
  const task = await db.query.studentTasks.findFirst({ where: and(eq(studentTasks.id, input.taskId), eq(studentTasks.isActive, true), or(eq(studentTasks.assignedSeat, seat.code), eq(studentTasks.checkerSeat, seat.code))) });
  if (!task) throw new Error("STUDENT_TASK_NOT_FOUND");
  if (!capability(seat, task.kind)) throw new Error("STUDENT_CAPABILITY_REQUIRED");
  return { seat, task };
}
export async function getStudentTask(db: AppDb, input: { userId: string; taskId: string; now: string }) {
  const context = await taskContext(db, input);
  const [subject, categories, history] = await Promise.all([
    getStudentSubject(db, context.task.kind, context.task.targetId, input.now),
    context.task.kind === "PLACE" ? studentCategoryChoices(db) : [],
    db.select({ version: studentTaskRevisions.version, actorSeat: studentTaskRevisions.actorSeat, eventType: studentTaskRevisions.eventType, createdAt: studentTaskRevisions.createdAt }).from(studentTaskRevisions).where(eq(studentTaskRevisions.taskId, context.task.id)).orderBy(desc(studentTaskRevisions.version)).limit(20),
  ]);
  const { createdBy: _creator, submittedBy: _submitter, checkedBy: _checker, ...task } = context.task;
  const seat = { code: context.seat.code, canApproveRegistration: context.seat.canApproveRegistration };
  return { seat, task, subject, categories, fingerprint: subject.fingerprint, sourceChanged: Boolean(context.task.targetFingerprint && context.task.targetFingerprint !== subject.fingerprint), history };
}

function revision(db: AppDb, task: Task, userId: string, seat: Seat, eventType: "SUBMIT" | "CHECK" | "REGISTRATION_ATTEST", payload: unknown, now: string) {
  return db.insert(studentTaskRevisions).select(db.select({
    id: sql<string>`${crypto.randomUUID()}`.as("id"), taskId: studentTasks.id, version: studentTasks.version,
    actorUserId: sql<string>`${userId}`.as("actor_user_id"), actorSeat: sql<Seat["code"]>`${seat.code}`.as("actor_seat"),
    eventType: sql<typeof eventType>`${eventType}`.as("event_type"), payloadJson: sql<string>`${JSON.stringify(payload)}`.as("payload_json"), createdAt: sql<string>`${now}`.as("created_at"),
  }).from(studentTasks).where(and(eq(studentTasks.id, task.id), eq(studentTasks.version, task.version + 1), eventType === "SUBMIT" ? eq(studentTasks.submittedBy, userId) : eq(studentTasks.checkedBy, userId))));
}

export async function submitStudentTask(db: AppDb, input: { userId: string; taskId: string; expectedVersion: number; targetFingerprint: string; classification: unknown; now: string }) {
  const { seat, task } = await taskContext(db, input);
  if (seat.code !== task.assignedSeat) throw new Error("STUDENT_ASSIGNEE_REQUIRED");
  const expectedVersion = z.number().int().min(0).parse(input.expectedVersion);
  const classification = classificationSchema.parse(input.classification);
  if (classification.kind !== task.kind) throw new Error("STUDENT_INPUT_INVALID");
  if (task.version !== expectedVersion) throw new Error("STUDENT_TASK_CONFLICT");
  const subject = await getStudentSubject(db, task.kind, task.targetId, input.now);
  if (subject.fingerprint !== input.targetFingerprint) throw new Error("STUDENT_SOURCE_CHANGED");
  if (classification.kind === "PLACE" && classification.categoryId && !(await studentCategoryChoices(db)).some((c) => c.id === classification.categoryId)) throw new Error("STUDENT_INPUT_INVALID");
  try {
    const [changed] = await db.batch([
      db.update(studentTasks).set({ classificationJson: JSON.stringify(classification), targetFingerprint: subject.fingerprint, status: "SUBMITTED", version: expectedVersion + 1, submittedBy: input.userId, submittedAt: input.now, checkedBy: null, checkedAt: null, reviewNote: null, updatedAt: input.now })
        .where(and(eq(studentTasks.id, task.id), eq(studentTasks.assignedSeat, seat.code), eq(studentTasks.version, expectedVersion), eq(studentTasks.isActive, true), currentCapability(input.userId, task.kind, input.now))).returning({ id: studentTasks.id }),
      revision(db, task, input.userId, seat, "SUBMIT", { classification, fingerprint: subject.fingerprint }, input.now),
    ]);
    if (changed.length !== 1) throw new Error("STUDENT_TASK_CONFLICT");
  } catch { throw new Error("STUDENT_TASK_CONFLICT"); }
  return { id: task.id, version: expectedVersion + 1 };
}

export async function reviewStudentTask(db: AppDb, input: { userId: string; taskId: string; expectedVersion: number; approveRegistration: boolean; reviewNote: string; requestChanges?: boolean; now: string }) {
  const { seat, task } = await taskContext(db, input);
  if (!mayReviewTask({ actorSeat: seat.code, assignedSeat: task.assignedSeat, checkerSeat: task.checkerSeat, actorUserId: input.userId, submittedBy: task.submittedBy })) throw new Error("STUDENT_CHECKER_REQUIRED");
  const expectedVersion = z.number().int().min(0).parse(input.expectedVersion);
  const reviewNote = z.string().trim().min(10).max(1500).parse(input.reviewNote);
  if (task.version !== expectedVersion || task.status !== "SUBMITTED") throw new Error("STUDENT_TASK_CONFLICT");
  const subject = await getStudentSubject(db, task.kind, task.targetId, input.now);
  if (subject.fingerprint !== task.targetFingerprint) throw new Error("STUDENT_SOURCE_CHANGED");
  const classification = classificationSchema.parse(JSON.parse(task.classificationJson ?? "null"));
  if (input.approveRegistration && (!seat.canApproveRegistration || input.requestChanges || classification.kind !== "PLACE" || classification.decision !== "ELIGIBLE" || classification.categoryId !== subject.categoryId || !subject.registrationReady)) throw new Error("STUDENT_REGISTRATION_NOT_READY");
  const status = input.approveRegistration ? "APPROVED" as const : input.requestChanges ? "NEEDS_INFO" as const : "VERIFIED" as const;
  const eventType = input.approveRegistration ? "REGISTRATION_ATTEST" : "CHECK";
  try {
    const [changed] = await db.batch([
      db.update(studentTasks).set({ status, version: expectedVersion + 1, checkedBy: input.userId, checkedAt: input.now, reviewNote, updatedAt: input.now })
        .where(and(eq(studentTasks.id, task.id), eq(studentTasks.checkerSeat, seat.code), ne(studentTasks.submittedBy, input.userId), eq(studentTasks.status, "SUBMITTED"), eq(studentTasks.version, expectedVersion), eq(studentTasks.isActive, true), currentCapability(input.userId, task.kind, input.now, input.approveRegistration))).returning({ id: studentTasks.id }),
      revision(db, task, input.userId, seat, eventType, { status, reviewNote, fingerprint: subject.fingerprint }, input.now),
    ]);
    if (changed.length !== 1) throw new Error("STUDENT_TASK_CONFLICT");
  } catch { throw new Error("STUDENT_TASK_CONFLICT"); }
  return { id: task.id, status };
}
