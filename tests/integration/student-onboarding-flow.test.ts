import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { accountTokens, categories, places, placeReviewWorkItems, reviewerVisitReviews, studentInvitations, studentSeats, studentTaskRevisions, studentTasks, users } from "../../app/db/schema";
import { action as signup } from "../../app/routes/signup";
import { action as verifyEmail } from "../../app/routes/verify-email";
import { action as login } from "../../app/routes/login";
import { action as manageStudents } from "../../app/routes/admin-students";
import { action as acceptInvite } from "../../app/routes/student-join";
import { action as changeTask, loader as loadTask } from "../../app/routes/student-task";
import { createUserSession } from "../../app/features/auth/session.server";
import { newReviewWorkItemValues } from "../../app/features/places/place-review-work-items.server";
import { confirmLocalDiningReview } from "../../app/features/places/local-dining-review.server";

// Runs only in the isolated Workers test pool. No live D1 or email is used.
const db = createDb(env.DB);
const origin = "https://retaste.test";
const password = "synthetic-student-password-123";
const mail: Array<{ to: string[]; html: string }> = [];
let mailBindings: { key: string | undefined; from: string | undefined };

function request(path: string, cookie?: string, fields?: Record<string, string>) {
  return new Request(`${origin}${path}`, {
    ...(fields ? { method: "POST", body: new URLSearchParams(fields) } : {}),
    headers: { Origin: origin, ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
}

beforeEach(async () => {
  await db.delete(studentTaskRevisions); await db.delete(studentTasks); await db.delete(studentInvitations);
  await db.update(studentSeats).set({ userId: null, isActive: true, expiresAt: "2099-01-01T00:00:00.000Z" });
  mail.length = 0;
  mailBindings = { key: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL };
  env.RESEND_API_KEY = "synthetic-test-key";
  env.RESEND_FROM_EMAIL = "test@example.test";
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== "https://api.resend.com/emails") throw new Error("UNEXPECTED_EXTERNAL_REQUEST");
    mail.push(JSON.parse(String(init?.body)));
    return Response.json({ id: crypto.randomUUID() });
  }));
});

afterEach(() => {
  env.RESEND_API_KEY = mailBindings.key as string;
  env.RESEND_FROM_EMAIL = mailBindings.from as string;
  vi.unstubAllGlobals();
});

async function registerAndLogin(code: string) {
  const email = `student-${code.toLowerCase()}-${crypto.randomUUID()}@example.test`;
  expect(await signup({ request: request("/signup", undefined, { displayName: `시험 학생 ${code}`, email, password, ageConfirmed: "yes" }) } as never)).toMatchObject({ ok: true });
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  expect(user).toMatchObject({ role: "USER", emailVerifiedAt: null });
  expect(user?.passwordHash).not.toBe(password);
  const fields = { email, password, returnTo: "/student/join" };
  expect(await login({ request: request("/login", undefined, fields) } as never)).toMatchObject({ init: { status: 400 } });
  const message = mail.find((m) => m.to.includes(email));
  const link = new URL(message!.html.match(/href="([^"]+)"/)![1]!);
  expect(link.origin).toBe(origin);
  expect(link.pathname).toBe("/verify-email");
  expect(link.search).toBe("");
  expect(link.hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);
  const token = link.hash.slice(1);
  const tokens = await db.select().from(accountTokens).where(eq(accountTokens.userId, user!.id));
  expect(tokens[0]?.tokenHash).not.toBe(token);
  expect(await verifyEmail({ request: request("/verify-email", undefined, { token }) } as never)).toEqual({ ok: true });
  expect(await verifyEmail({ request: request("/verify-email", undefined, { token }) } as never)).toEqual({ ok: false });
  const signedIn = await login({ request: request("/login", undefined, fields) } as never);
  expect(signedIn).toBeInstanceOf(Response);
  const response = signedIn as Response;
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/student/join");
  const setCookie = response.headers.get("Set-Cookie")!;
  expect(setCookie).toContain("HttpOnly"); expect(setCookie).toContain("Secure");
  return { userId: user!.id, cookie: setCookie.split(";")[0]! };
}

describe("signup through independent student cross-check", () => {
  it("registers and verifies four personal accounts, accepts test invitations once, and completes place/review/QA work", async () => {
    const now = new Date().toISOString();
    const adminId = crypto.randomUUID();
    await db.insert(users).values({ id: adminId, email: `${adminId}@example.test`, displayName: "시험 관리자", role: "ADMIN", emailVerifiedAt: now, createdAt: now, updatedAt: now });
    const adminCookie = (await createUserSession({ userId: adminId, now: new Date(), requestUrl: origin })).split(";")[0]!;
    const members: Record<string, Awaited<ReturnType<typeof registerAndLogin>>> = {};
    let consumedToken = "";
    for (const code of ["A", "B", "C", "D"]) {
      const member = await registerAndLogin(code); members[code] = member;
      const issued = await manageStudents({ request: request("/admin/students", adminCookie, { intent: "invite", seatCode: code }) } as never);
      expect(issued).toMatchObject({ data: { invite: { seatCode: code } } });
      const invite = (issued as { data: { invite: { url: string } } }).data.invite.url;
      const token = new URL(invite).hash.slice(1); consumedToken = token;
      const accepted = await acceptInvite({ request: request("/student/join", member.cookie, { intent: "accept", token }) } as never);
      expect(accepted).toBeInstanceOf(Response);
      expect((accepted as Response).headers.get("Location")).toBe("/student");
      expect(await acceptInvite({ request: request("/student/join", member.cookie, { intent: "accept", token }) } as never)).toMatchObject({ init: { status: 400 } });
    }
    expect(mail).toHaveLength(4);
    expect(await acceptInvite({ request: request("/student/join", members.A!.cookie, { intent: "accept", token: consumedToken }) } as never)).toMatchObject({ init: { status: 400 } });
    await expect(manageStudents({ request: request("/admin/students", members.A!.cookie, { intent: "invite", seatCode: "A" }) } as never)).rejects.toMatchObject({ status: 403 });

    const categoryId = crypto.randomUUID(); const placeId = crypto.randomUUID();
    await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "백반·가정식", emoji: "🍚", isActive: true, sortOrder: 0, createdAt: now, updatedAt: now });
    await db.insert(places).values({ id: placeId, slug: placeId, name: "합성 검수용 식당", status: "DRAFT", address: "광주광역시 동구 동명로 10", neighborhood: "동명동", latitude: 35.15, longitude: 126.92, searchText: "시험", createdAt: now, updatedAt: now });
    const item = newReviewWorkItemValues({ placeId, sourceKind: "PLACE_SUGGESTION", now });
    await db.insert(placeReviewWorkItems).values({ ...item, selectedCategoryId: categoryId });
    await confirmLocalDiningReview(db, { workItemIds: [item.id], expectedVersions: { [item.id]: 0 }, actorUserId: adminId, reason: "합성 자료의 독립 운영과 매장 좌석 및 메뉴를 확인했습니다.", confirmed: true, now });
    await db.update(placeReviewWorkItems).set({ stage: "FINAL_APPROVAL" }).where(eq(placeReviewWorkItems.id, item.id));
    const originalPlace = await db.query.places.findFirst({ where: eq(places.id, placeId) });
    const originalItem = await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, item.id) });

    for (const kind of ["PLACE", "REVIEW", "QA"] as const) {
      let targetId = item.id;
      let reviewId = "";
      if (kind === "REVIEW") {
        await db.update(places).set({ status: "PUBLISHED" }).where(eq(places.id, placeId));
        reviewId = crypto.randomUUID(); targetId = reviewId;
        await db.insert(reviewerVisitReviews).values({ id: reviewId, placeId, reviewerUserId: members.B!.userId, categoryId, evaluation: "NOT_RECOMMEND", badgesJson: "[]", photoCount: 0, version: 1, publishedAt: now, createdAt: now, updatedAt: now });
      }
      if (kind === "QA") targetId = "/places";
      const sourceReview = reviewId ? await db.query.reviewerVisitReviews.findFirst({ where: eq(reviewerVisitReviews.id, reviewId) }) : null;
      const assignee = kind === "PLACE" ? "A" : "C"; const checker = kind === "PLACE" ? "B" : "D";
      const assigned = await manageStudents({ request: request("/admin/students", adminCookie, { intent: "assign", kind, assignedSeat: assignee, checkerSeat: checker, targetId, title: `합성 ${kind} 분류 시험`, targetIds: "[]" }) } as never);
      expect(assigned).toMatchObject({ data: { message: "작업을 배정했습니다." } });
      const task = await db.query.studentTasks.findFirst({ where: eq(studentTasks.targetId, targetId) });
      const taskId = task!.id; const path = `/student/tasks/${taskId}`;
      const detail = await loadTask({ request: request(path, members[assignee]!.cookie), params: { taskId } } as never);
      const fingerprint = (detail as { data: { fingerprint: string } }).data.fingerprint;
      const fields = { intent: "submit", version: "0", fingerprint, kind, decision: kind === "PLACE" ? "ELIGIBLE" : kind === "REVIEW" ? "NEEDS_INFO" : "PASS", ...(kind === "PLACE" ? { categoryId } : {}), note: "합성 자료의 분류와 근거를 확인한 테스트 기록입니다.", evidenceUrl: "" };
      expect(await changeTask({ request: request(path, members[assignee]!.cookie, fields), params: { taskId } } as never)).toMatchObject({ data: { message: "기록을 저장했습니다." } });
      const crossCheck = { intent: kind === "PLACE" ? "attest" : "check", version: "1", reviewNote: "다른 시험 계정으로 원천 근거와 분류 결과를 독립 확인했습니다." };
      expect(await changeTask({ request: request(path, members[assignee]!.cookie, crossCheck), params: { taskId } } as never)).toMatchObject({ init: { status: 403 } });
      await expect(loadTask({ request: request(path, members[kind === "PLACE" ? "C" : "A"]!.cookie), params: { taskId } } as never)).rejects.toMatchObject({ status: 404 });
      expect(await changeTask({ request: request(path, members[checker]!.cookie, crossCheck), params: { taskId } } as never)).toMatchObject({ data: { message: "기록을 저장했습니다." } });
      expect(await changeTask({ request: request(path, members[checker]!.cookie, crossCheck), params: { taskId } } as never)).toMatchObject({ init: { status: 409 } });
      const saved = await db.query.studentTasks.findFirst({ where: eq(studentTasks.id, taskId) });
      expect(saved).toMatchObject({ status: kind === "PLACE" ? "APPROVED" : "VERIFIED", version: 2, submittedBy: members[assignee]!.userId, checkedBy: members[checker]!.userId });
      const history = await db.select().from(studentTaskRevisions).where(eq(studentTaskRevisions.taskId, taskId));
      expect(history.map((r) => r.actorUserId)).toEqual([members[assignee]!.userId, members[checker]!.userId]);
      expect(history.map((r) => r.eventType)).toEqual(["SUBMIT", kind === "PLACE" ? "REGISTRATION_ATTEST" : "CHECK"]);
      if (kind === "PLACE") {
        expect(await db.query.places.findFirst({ where: eq(places.id, placeId) })).toEqual(originalPlace);
        expect(await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, item.id) })).toEqual(originalItem);
      }
      if (sourceReview) expect(await db.query.reviewerVisitReviews.findFirst({ where: eq(reviewerVisitReviews.id, reviewId) })).toEqual(sourceReview);
    }
    expect((await db.select().from(studentSeats)).filter((s) => s.userId)).toHaveLength(4);
    expect((await db.select().from(studentInvitations)).every((i) => i.consumedAt && !i.revokedAt)).toBe(true);
  }, 30_000);

  it("rejects missing age confirmation without creating an account or sending mail", async () => {
    const email = `underage-${crypto.randomUUID()}@example.test`;
    expect(await signup({ request: request("/signup", undefined, { displayName: "시험 학생", email, password }) } as never)).toMatchObject({ init: { status: 400 } });
    expect(await db.query.users.findFirst({ where: eq(users.email, email) })).toBeUndefined();
    expect(mail).toHaveLength(0);
  });
});
