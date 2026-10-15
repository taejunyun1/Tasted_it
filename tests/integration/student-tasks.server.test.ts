import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { categories, placeReviewWorkItems, places, studentSeats, studentTasks, users } from "../../app/db/schema";
import { newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";
import { confirmLocalDiningReview } from "../../app/features/places/local-dining-review.server";
import { assignStudentTask, getStudentTask, listStudentTasks, reviewStudentTask, submitStudentTask } from "../../app/features/students/tasks.server";

const db = createDb(env.DB); const now = "2026-10-15T01:00:00.000Z";
const reason = "직접 방문하여 독립 식당의 홀 좌석과 영업 및 대표 메뉴를 확인했습니다.";
let admin: string; let a: string; let b: string; let c: string; let d: string;
async function member(role: "ADMIN" | "USER" = "USER") {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email: `${id}@example.test`, displayName: "시험 학생", role, emailVerifiedAt: now, createdAt: now, updatedAt: now }); return id;
}
beforeEach(async () => {
  await db.delete(studentTasks);
  admin = await member("ADMIN"); a = await member(); b = await member(); c = await member(); d = await member();
  for (const [code, userId] of [["A", a], ["B", b], ["C", c], ["D", d]] as const) await db.update(studentSeats).set({ userId, isActive: true }).where(eq(studentSeats.code, code));
});
async function placeTask(status: "DRAFT" | "HIDDEN" = "DRAFT", final = true) {
  const id = crypto.randomUUID(); const categoryId = crypto.randomUUID();
  await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "백반·가정식", emoji: "🍚", isActive: true, sortOrder: 0, createdAt: now, updatedAt: now });
  await db.insert(places).values({ id, slug: id, name: `동네식당${id}`, status, address: "광주광역시 동구 동명로 10", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: id, createdAt: now, updatedAt: now });
  const item = newReviewWorkItemValues({ placeId: id, sourceKind: "PLACE_SUGGESTION", now });
  await db.insert(placeReviewWorkItems).values({ ...item, selectedCategoryId: categoryId });
  await confirmLocalDiningReview(db, { workItemIds: [item.id], expectedVersions: { [item.id]: 0 }, actorUserId: admin, reason, confirmed: true, now });
  if (final) await db.update(placeReviewWorkItems).set({ stage: "FINAL_APPROVAL" }).where(eq(placeReviewWorkItems.id, item.id));
  const task = await assignStudentTask(db, { actorUserId: admin, kind: "PLACE", assignedSeat: "A", checkerSeat: "B", targetId: item.id, title: "점포 분류와 신규 등록 확인", now });
  return { id, categoryId, taskId: task.id, workItemId: item.id };
}
async function submit(f: Awaited<ReturnType<typeof placeTask>>) {
  const loaded = await getStudentTask(db, { userId: a, taskId: f.taskId, now });
  return submitStudentTask(db, { userId: a, taskId: f.taskId, expectedVersion: loaded.task.version, targetFingerprint: loaded.fingerprint, classification: { kind: "PLACE", decision: "ELIGIBLE", categoryId: f.categoryId, note: reason, evidenceUrl: "https://example.org/store" }, now });
}

describe("student task ownership and registration attestation", () => {
  it("lists and loads only assigned or designated cross-check tasks", async () => {
    const f = await placeTask();
    expect((await listStudentTasks(db, { userId: a, now })).tasks.map((t) => t.id)).toContain(f.taskId);
    expect((await listStudentTasks(db, { userId: b, now })).tasks.map((t) => t.id)).toContain(f.taskId);
    expect((await listStudentTasks(db, { userId: c, now })).tasks).toHaveLength(0);
    await expect(getStudentTask(db, { userId: c, taskId: f.taskId, now })).rejects.toThrow("STUDENT_TASK_NOT_FOUND");
    await expect(getStudentTask(db, { userId: await member(), taskId: f.taskId, now })).rejects.toThrow("STUDENT_ACCESS_DENIED");
  });
  it("saves classification and allows a different assigned student to attest only new registration", async () => {
    const f = await placeTask(); await submit(f);
    const result = await reviewStudentTask(db, { userId: b, taskId: f.taskId, expectedVersion: 1, approveRegistration: true, reviewNote: reason, now });
    expect(result.status).toBe("APPROVED");
    expect((await db.query.places.findFirst({ where: eq(places.id, f.id) }))?.status).toBe("DRAFT");
    expect((await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, f.workItemId) }))?.status).toBe("ACTIVE");
  });
  it("rejects self approval, another student's target, and repeat approval", async () => {
    const f = await placeTask(); await submit(f);
    const input = { taskId: f.taskId, expectedVersion: 1, approveRegistration: true, reviewNote: reason, now };
    await expect(reviewStudentTask(db, { ...input, userId: a })).rejects.toThrow("STUDENT_CHECKER_REQUIRED");
    await expect(reviewStudentTask(db, { ...input, userId: c })).rejects.toThrow("STUDENT_TASK_NOT_FOUND");
    await reviewStudentTask(db, { ...input, userId: b });
    await expect(reviewStudentTask(db, { ...input, userId: b })).rejects.toThrow("STUDENT_TASK_CONFLICT");
  });
  it("checks current membership and expected task version on every write", async () => {
    const f = await placeTask(); const loaded = await getStudentTask(db, { userId: a, taskId: f.taskId, now }); await submit(f);
    await expect(submitStudentTask(db, { userId: a, taskId: f.taskId, expectedVersion: 0, targetFingerprint: loaded.fingerprint, classification: { kind: "PLACE", decision: "HOLD", note: reason, evidenceUrl: "" }, now })).rejects.toThrow("STUDENT_TASK_CONFLICT");
    await db.update(studentSeats).set({ isActive: false }).where(eq(studentSeats.code, "B"));
    await expect(reviewStudentTask(db, { userId: b, taskId: f.taskId, expectedVersion: 1, approveRegistration: true, reviewNote: reason, now })).rejects.toThrow("STUDENT_ACCESS_DENIED");
  });
  it("rejects stale source evidence after address or category changes", async () => {
    const f = await placeTask(); await submit(f);
    await db.update(places).set({ address: "광주광역시 동구 다른주소 99" }).where(eq(places.id, f.id));
    await expect(reviewStudentTask(db, { userId: b, taskId: f.taskId, expectedVersion: 1, approveRegistration: true, reviewNote: reason, now })).rejects.toThrow("STUDENT_SOURCE_CHANGED");
    expect((await db.query.studentTasks.findFirst({ where: eq(studentTasks.id, f.taskId) }))?.status).toBe("SUBMITTED");
  });
  it("does not attest restoration of a hidden place or skip the existing registration pipeline", async () => {
    for (const [status, final] of [["HIDDEN", true], ["DRAFT", false]] as const) {
      const f = await placeTask(status, final); await submit(f);
      await expect(reviewStudentTask(db, { userId: b, taskId: f.taskId, expectedVersion: 1, approveRegistration: true, reviewNote: reason, now })).rejects.toThrow("STUDENT_REGISTRATION_NOT_READY");
    }
  });
  it("limits task kind capabilities and forbids public QA links to admin endpoints", async () => {
    await expect(assignStudentTask(db, { actorUserId: admin, kind: "QA", assignedSeat: "C", checkerSeat: "D", targetId: "/admin/ratings", title: "권한 우회", now })).rejects.toThrow();
    const f = await placeTask();
    await expect(assignStudentTask(db, { actorUserId: a, kind: "QA", assignedSeat: "C", checkerSeat: "D", targetId: "/places", title: "목록 시험", now })).rejects.toThrow("STUDENT_ADMIN_REQUIRED");
    await expect(assignStudentTask(db, { actorUserId: admin, kind: "PLACE", assignedSeat: "C", checkerSeat: "D", targetId: f.workItemId, title: "점포 분류", now })).rejects.toThrow("STUDENT_CAPABILITY_REQUIRED");
  });
  it("records QA and peer checks without granting registration authority", async () => {
    const task = await assignStudentTask(db, { actorUserId: admin, kind: "QA", assignedSeat: "C", checkerSeat: "D", targetId: "/places", title: "목록 검색 시험", now });
    const loaded = await getStudentTask(db, { userId: c, taskId: task.id, now });
    await submitStudentTask(db, { userId: c, taskId: task.id, expectedVersion: 0, targetFingerprint: loaded.fingerprint, classification: { kind: "QA", decision: "FAIL", note: "없는 상호를 검색했으나 결과 없음 안내를 찾지 못했습니다.", evidenceUrl: "" }, now });
    await expect(reviewStudentTask(db, { userId: d, taskId: task.id, expectedVersion: 1, approveRegistration: true, reviewNote: reason, now })).rejects.toThrow("STUDENT_REGISTRATION_NOT_READY");
    expect((await reviewStudentTask(db, { userId: d, taskId: task.id, expectedVersion: 1, approveRegistration: false, reviewNote: reason, now })).status).toBe("VERIFIED");
  });
});
