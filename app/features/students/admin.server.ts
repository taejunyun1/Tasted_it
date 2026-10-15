import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
    db.select({ id: reviewerVisitReviews.id, name: places.name }).from(reviewerVisitReviews).innerJoin(places, eq(places.id, reviewerVisitReviews.placeId)).where(eq(places.status, "PUBLISHED")).orderBy(desc(reviewerVisitReviews.publishedAt)).limit(50),
    db.select().from(studentTasks).orderBy(desc(studentTasks.updatedAt), desc(studentTasks.id)).limit(50).offset((taskPage - 1) * 50),
    db.select({ total: sql<number>`count(*)` }).from(studentTasks),
  ]);
  return { seats: seats.map(({ userId, ...s }) => ({ ...s, connected: Boolean(userId) })), invitations, queue, query, reviews, tasks: tasks.map(({ submittedBy: _s, checkedBy: _c, createdBy: _a, ...t }) => t), taskPage, taskTotal: Number(count?.total ?? 0) };
}

export async function assignStudentQueueBatch(db: AppDb, input: { actorUserId: string; assignedSeat: string; checkerSeat: string; targetIds: string[]; now: string }) {
  await requireStudentAdmin(db, input.actorUserId);
  const { assignedSeat, checkerSeat, targetIds } = z.object({ assignedSeat: seatCodeSchema, checkerSeat: seatCodeSchema, targetIds: z.array(z.string().min(1).max(512)).min(1).max(25) }).refine((v) => v.assignedSeat !== v.checkerSeat).parse(input);
  const ids = [...new Set(targetIds)];
  const seats = await db.select().from(studentSeats).where(inArray(studentSeats.code, [assignedSeat, checkerSeat]));
  if (seats.length !== 2 || seats.some((s) => !s.isActive || !s.canClassifyPlaces || s.expiresAt <= input.now)) throw new Error("STUDENT_CAPABILITY_REQUIRED");
  const rows = await db.select({ id: placeReviewWorkItems.id, licenseName: businessLicenses.businessName, placeName: places.name }).from(placeReviewWorkItems)
    .leftJoin(businessLicenses, eq(businessLicenses.id, placeReviewWorkItems.businessLicenseId)).leftJoin(places, eq(places.id, placeReviewWorkItems.placeId))
    .where(and(inArray(placeReviewWorkItems.id, ids), eq(placeReviewWorkItems.status, "ACTIVE")));
  if (rows.length !== ids.length) throw new Error("STUDENT_SOURCE_CHANGED");
  const statements = [];
  for (let i = 0; i < rows.length; i += 5) statements.push(db.insert(studentTasks).values(rows.slice(i, i + 5).map((r) => ({ id: crypto.randomUUID(), kind: "PLACE" as const, targetId: r.id, title: `${r.licenseName ?? r.placeName ?? "점포"} 분류`.slice(0, 120), assignedSeat, checkerSeat, createdBy: input.actorUserId, createdAt: input.now, updatedAt: input.now }))).onConflictDoNothing().returning({ id: studentTasks.id }));
  const results = await db.batch([statements[0]!, ...statements.slice(1)]);
  const assigned = results.reduce((n, r) => n + r.length, 0);
  await studentAudit(db, input.actorUserId, "STUDENT_QUEUE_ASSIGNED", assignedSeat, { assigned, skipped: ids.length - assigned, targetIds: ids, checkerSeat }, input.now);
  return { assigned, skipped: ids.length - assigned };
}

export async function cancelStudentTask(db: AppDb, input: { actorUserId: string; taskId: string; now: string }) {
  await requireStudentAdmin(db, input.actorUserId);
  const taskId = z.string().min(1).max(128).parse(input.taskId);
  await db.update(studentTasks).set({ isActive: false, updatedAt: input.now }).where(eq(studentTasks.id, taskId));
  await studentAudit(db, input.actorUserId, "STUDENT_TASK_CANCELLED", taskId, { isActive: false }, input.now);
}
