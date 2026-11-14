import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../../db/client.server";
import { businessLicenses, places, placeReviewWorkItems, reviewerVisitReviews, studentInvitations, studentSeats, studentTasks } from "../../db/schema";
import { parsePlaceReviewQuery } from "../places/place-review-pagination";
import { listPlaceReviewWorkItems } from "../places/place-review-query.server";
import { requireStudentAdmin, studentAudit } from "./invitations.server";
import { seatCodeSchema } from "./policy";

export async function studentAdminData(db: AppDb, actorUserId: string, url: URL) {
  await requireStudentAdmin(db, actorUserId);
  const query = { ...parsePlaceReviewQuery(url), pageSize: 25 as const };
  const taskPage = z.coerce.number().int().min(1).max(10_000).parse(url.searchParams.get("taskPage") ?? 1);
  const [seats, invitations, queue, reviews, tasks, [count]] = await Promise.all([
    db.select().from(studentSeats),
    db.select({ seatCode: studentInvitations.seatCode, expiresAt: studentInvitations.expiresAt, consumedAt: studentInvitations.consumedAt, revokedAt: studentInvitations.revokedAt }).from(studentInvitations).orderBy(desc(studentInvitations.createdAt)).limit(20),
    listPlaceReviewWorkItems(db, query),
    db.select({ id: reviewerVisitReviews.id, name: places.name }).from(reviewerVisitReviews).innerJoin(places, eq(places.id, reviewerVisitReviews.placeId)).where(and(eq(places.status, "PUBLISHED"), notExists(db.select({ id: studentTasks.id }).from(studentTasks).where(and(eq(studentTasks.kind, "REVIEW"), eq(studentTasks.targetId, reviewerVisitReviews.id), eq(studentTasks.isActive, true)))))).orderBy(desc(reviewerVisitReviews.publishedAt)).limit(50),
    db.select().from(studentTasks).orderBy(desc(studentTasks.updatedAt), desc(studentTasks.id)).limit(50).offset((taskPage - 1) * 50),
    db.select({ total: sql<number>`count(*)` }).from(studentTasks),
  ]);
  return { asOf: new Date().toISOString(), seats: seats.map(({ userId, ...s }) => ({ ...s, connected: Boolean(userId) })), invitations, queue, query, reviews, tasks: tasks.map(({ submittedBy: _s, checkedBy: _c, createdBy: _a, ...t }) => t), taskPage, taskTotal: Number(count?.total ?? 0) };
}

export async function assignStudentQueueBatch(db: AppDb, input: { actorUserId: string; assignedSeat: string; checkerSeat: string; targetIds: string[]; now: string }) {
  await requireStudentAdmin(db, input.actorUserId);
  const { assignedSeat, checkerSeat, targetIds } = z.object({ assignedSeat: seatCodeSchema, checkerSeat: seatCodeSchema, targetIds: z.array(z.string().min(1).max(512)).min(1).max(25) }).refine((v) => v.assignedSeat !== v.checkerSeat).parse(input);
  const ids = [...new Set(targetIds)];
  const seats = await db.select().from(studentSeats).where(inArray(studentSeats.code, [assignedSeat, checkerSeat]));
  if (seats.length !== 2 || seats.some((s) => !s.isActive || !s.canClassifyPlaces || s.expiresAt <= input.now)) throw new Error("STUDENT_CAPABILITY_REQUIRED");
  const rows = await db.select({ id: placeReviewWorkItems.id, version: placeReviewWorkItems.stageVersion, licenseName: businessLicenses.businessName, placeName: places.name }).from(placeReviewWorkItems)
    .leftJoin(businessLicenses, eq(businessLicenses.id, placeReviewWorkItems.businessLicenseId)).leftJoin(places, eq(places.id, placeReviewWorkItems.placeId))
    .where(and(inArray(placeReviewWorkItems.id, ids), eq(placeReviewWorkItems.status, "ACTIVE")));
  if (rows.length !== ids.length) throw new Error("STUDENT_SOURCE_CHANGED");
  const statements = [];
  const assignedSnapshot = seats.find(s => s.code === assignedSeat)!, checker = seats.find(s => s.code === checkerSeat)!;
  for (const r of rows) statements.push(db.insert(studentTasks).select(sql`SELECT ${crypto.randomUUID()},'PLACE',${r.id},${`${r.licenseName ?? r.placeName ?? "점포"} 분류`.slice(0,120)},s.code,${checkerSeat},1,'OPEN',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,${input.actorUserId},${input.now},${input.now} FROM student_seats s WHERE s.code=${assignedSeat} AND s.version=${assignedSnapshot.version} AND s.is_active=1 AND s.expires_at>${input.now} AND EXISTS(SELECT 1 FROM student_seats c WHERE c.code=${checkerSeat} AND c.version=${checker.version} AND c.is_active=1 AND c.expires_at>${input.now}) AND EXISTS(SELECT 1 FROM place_review_work_items w WHERE w.id=${r.id} AND w.stage_version=${r.version} AND w.status='ACTIVE')`).onConflictDoNothing().returning({id:studentTasks.id}));
  const results = await db.batch([statements[0]!, ...statements.slice(1)]);
  const assigned = results.reduce((n, r) => n + r.length, 0);
  await studentAudit(db, input.actorUserId, "STUDENT_QUEUE_ASSIGNED", assignedSeat, { assigned, skipped: ids.length - assigned, targetIds: ids, checkerSeat }, input.now);
  return { assigned, skipped: ids.length - assigned };
}

export async function cancelStudentTask(db: AppDb, input: { actorUserId: string; taskId: string; now: string }) {
  await requireStudentAdmin(db, input.actorUserId);
  const taskId = z.string().min(1).max(128).parse(input.taskId);
  const task = await db.query.studentTasks.findFirst({ where: and(eq(studentTasks.id, taskId), eq(studentTasks.isActive, true)) });
  if (!task) throw new Error("STUDENT_TASK_NOT_FOUND");
  const changed = await db.update(studentTasks).set({ isActive: false, version: task.version + 1, updatedAt: input.now }).where(and(eq(studentTasks.id, taskId), eq(studentTasks.version, task.version), eq(studentTasks.isActive, true))).returning({ id: studentTasks.id });
  if (changed.length !== 1) throw new Error("STUDENT_TASK_CONFLICT");
  await studentAudit(db, input.actorUserId, "STUDENT_TASK_CANCELLED", taskId, { isActive: false }, input.now);
}
