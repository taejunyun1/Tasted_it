import { env, withEnv } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { commitStudentAdminOperation, prepareStudentAdminOperation } from "../../app/features/students/admin-commands.server";
import { commitReviewerAdmin, prepareReviewerAdmin } from "../../app/features/reviewers/reviewer-admin.server";
import { listPublishedPlaceReviewPhotos } from "../../app/features/ratings/reviewer-visit.server";
import { getReviewerPhotoObjectKey } from "../../app/features/ratings/reviewer-photo.server";
import { action as acceptInvite } from "../../app/routes/student-join";
import { loader as loadStudent } from "../../app/routes/student-index";
import { action as applyReviewer } from "../../app/routes/reviewer-apply";
import { action as submitReview, loader as loadReview } from "../../app/routes/reviewer-ratings";
import { action as moderateReview, loader as loadModeration } from "../../app/routes/admin-reviewer-visits";
import { loader as readPhoto } from "../../app/routes/reviewer-photo";

const cleanupAnchors = [
  ...["revision", "status", "lease_id", "lease_expires_at", "last_error"]
    .map((column) => "ALTER TABLE reviewer_photo_cleanup_jobs ADD COLUMN " + column + " "),
  "CREATE INDEX reviewer_photo_cleanup_status_idx ON reviewer_photo_cleanup_jobs(",
  "CREATE TABLE reviewer_photo_cleanup_guards (",
];

// Locally generated 18×12 JPEG with a solid color and no external content.
const jpegBase64 = [
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcp",
  "LDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy",
  "MjIyMjIyMjIyMjIyMjL/wAARCAAMABIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA",
  "AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6",
  "Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG",
  "x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA",
  "AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5",
  "OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPE",
  "xcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwClRRRXQcAUUUUAf//Z",
].join("");
const jpeg = Uint8Array.from(atob(jpegBase64), (character) => character.charCodeAt(0));

const omitted = new Set(["0053", "0054", "0055", "0056", "0059", "0060"]);
const origin = "https://retaste.test";

function request(path: string, session?: string, body?: FormData | URLSearchParams) {
  return new Request(origin + path, {
    method: body ? "POST" : "GET",
    headers: { Origin: origin, ...(session ? { Cookie: `retaste_session=${session}` } : {}) },
    body,
  });
}

it("runs two student photo reviews through approval and withdrawal on the photo-cleanup-only schema", async () => {
  const database = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  const baseline = env.TEST_MIGRATIONS.filter(({ name }) => {
    const version = name.slice(0, 4);
    return version <= "0062" && !omitted.has(version);
  });
  expect(baseline).toHaveLength(56);
  await applyD1Migrations(database, baseline);
  // Exercise the photo schema in isolation without marking 0055 as applied.
  const migration = env.TEST_MIGRATIONS.find(({ name }) => name === "0055_admin_privacy_operations.sql");
  expect(migration).toBeDefined();
  const cleanupQueries = cleanupAnchors.map((anchor) => {
    const queries = migration!.queries.filter((query) => query.trimStart().startsWith(anchor));
    expect(queries, anchor).toHaveLength(1);
    return queries[0]!;
  });
  expect(cleanupQueries).toHaveLength(7);
  for (const statement of cleanupQueries) await database.prepare(statement).run();
  await expect(database.prepare("SELECT id FROM privacy_requests LIMIT 0").all()).rejects.toThrow();

  const stamp = new Date();
  const now = stamp.toISOString();
  const expiry = new Date(stamp.getTime() + 600_000).toISOString();
  const seatExpiry = new Date(stamp.getTime() + 86_400_000).toISOString();
  await database.prepare("UPDATE student_seats SET expires_at=? WHERE code IN ('C','D')").bind(seatExpiry).run();
  const placeId = crypto.randomUUID();
  const categoryId = crypto.randomUUID();
  const categorySlug = `synthetic-pilot-${categoryId}`;
  await database.batch([
    database.prepare("INSERT INTO categories(id,slug,name,emoji,sort_order,is_active,created_at,updated_at) VALUES(?,?,?,'🍜',999,1,?,?)")
      .bind(categoryId, categorySlug, "라멘", now, now),
    database.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED','광주','동명동',35.149,126.923,'합성 라멘',?,?)")
      .bind(placeId, placeId, "합성 라멘", now, now),
  ]);

  async function user(role: "ADMIN" | "USER", label: string) {
    const id = crypto.randomUUID();
    const session = crypto.randomUUID();
    await database.batch([
      database.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .bind(id, `${id}@example.test`, label, role, now, now, now),
      database.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)")
        .bind(session, id, expiry, now),
    ]);
    return { id, session };
  }

  const admin = await user("ADMIN", "합성 관리자");
  await database.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)")
    .bind(admin.session, admin.id, now, expiry).run();
  const caller = { actorUserId: admin.id, sessionId: admin.session, now };
  const students = [
    { ...await user("USER", "합성 학생 C"), seat: "C" as const },
    { ...await user("USER", "합성 학생 D"), seat: "D" as const },
  ];

  const isolatedBindings = {
    DB: database,
    REVIEW_PHOTOS: env.REVIEW_PHOTOS,
    STUDENT_INVITE_COOKIE_SECRET: env.STUDENT_INVITE_COOKIE_SECRET,
    STUDENT_WORKSPACE_ENABLED: "true",
    REVIEW_PHOTO_UPLOAD_ENABLED: "false",
    STUDENT_REVIEWER_PHOTO_PILOT_SEATS: "C,D",
  };

  await withEnv(isolatedBindings, async () => {
    const applicationIds: string[] = [];
    for (const student of students) {
      const preview = await prepareStudentAdminOperation(database, { ...caller, command: { change: "ISSUE_INVITE", seatCode: student.seat } });
      const issued = await commitStudentAdminOperation(database, { ...caller, operationId: preview.operationId });
      expect(issued.invitation?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const accepted = await acceptInvite({ request: request("/student/join", student.session, new URLSearchParams({
        intent: "accept",
        token: issued.invitation!.token,
      })) } as never);
      expect(accepted).toBeInstanceOf(Response);
      expect((accepted as Response).headers.get("location")).toBe("/student");

      const before = await loadStudent({ request: request("/student", student.session) } as never);
      expect(before).toMatchObject({ data: { canSubmitVisitReview: false } });

      const fields = new URLSearchParams({
        statement: "광주 골목 식당을 직접 방문하고 재료와 가격 대비 만족도, 재방문 의사를 기록합니다. 광고보다 일관된 기준과 솔직한 근거를 중요하게 생각합니다. 여러 번 방문해 계절과 시간대에 따른 차이를 기록하겠습니다.",
        occupation: "합성 학생",
        tasteDirection: "국물 요리와 동네 식당을 좋아합니다.",
        regionCode: "GWANGJU",
        specialtySlugs: categorySlug,
      });
      const application = await applyReviewer({ request: request("/reviewer/apply", student.session, fields) } as never);
      expect(application).toMatchObject({ ok: true, applicationId: expect.any(String) });
      applicationIds.push((application as { applicationId: string }).applicationId);
    }

    const preview = await prepareReviewerAdmin(database, {
      ...caller, change: "OVERRIDE_APPROVE", targetIds: applicationIds, reason: "합성 작업공간 리뷰어 검증",
    });
    expect(preview.operationId).toBeTruthy();
    const approved = await commitReviewerAdmin(database, { ...caller, operationId: preview.operationId! });
    expect(approved.result).toMatchObject({ requestedCount: 2, appliedCount: 2, skippedCount: 0 });

    const visits: Array<{ id: string; photoId: string; session: string; objectKey: string }> = [];
    for (const student of students) {
      const overview = await loadStudent({ request: request("/student", student.session) } as never);
      expect(overview).toMatchObject({ data: { canSubmitVisitReview: true, seat: { code: student.seat } } });
      const formData = await loadReview({ request: request("/reviewer/ratings", student.session) } as never);
      expect(formData).toMatchObject({ canSubmit: true, photoUploadEnabled: true });

      const form = new FormData();
      for (const [k, v] of Object.entries({
        intent: "publish-review", visitedOn: now.slice(0,10), visitNote: "합성 현장 식사 방문",
        disclosure: "NONE", placeId, categoryId, categoryName: "라멘", evaluation: "RECOMMEND",
        golden: "0", goldenReason: "",
        photoMetadata: JSON.stringify([{
          position: 0, takenOn: now.slice(0, 10), rightsBasis: "OWN_WORK", rightsNote: "",
          caption: "합성 이미지", privacyChecked: true,
        }]),
      })) form.set(k, v);
      form.set("photos", new File([jpeg], "synthetic.jpg", { type: "image/jpeg" }));
      const posted = await submitReview({ request: request("/reviewer/ratings", student.session, form) } as never);
      expect(posted.status, await posted.clone().text()).toBe(303);
      const location = new URL(posted.headers.get("location")!, origin);
      expect(location.searchParams.get("notice")).toBe("review-with-photos-submitted");
      const id = location.searchParams.get("submitted")!;
      expect(await database.prepare("SELECT status, photo_count, version FROM reviewer_visit_reviews WHERE id=?")
        .bind(id).first()).toMatchObject({ status: "PENDING", photo_count: 1, version: 1 });
      const photoId = await database.prepare("SELECT id FROM reviewer_visit_photos WHERE review_id=?")
        .bind(id).first<string>("id");
      expect(photoId).toBeTruthy();
      const pending = await readPhoto({ request: request(`/review-photos/${photoId}`), params: { photoId } } as never);
      expect(pending.status).toBe(404);
      const ownerPreview = await readPhoto({
        request: request("/review-photos/" + photoId + "?preview=1", student.session), params: { photoId },
      } as never);
      expect(ownerPreview.status).toBe(200);
      visits.push({ id, photoId: photoId!, session: student.session, objectKey: getReviewerPhotoObjectKey(id, photoId!) });
    }

    const queue = await loadModeration({ request: request("/admin/reviewer-visits", admin.session) } as never);
    expect(new Set(queue.reviews.map((row) => row.id))).toEqual(new Set(visits.map((visit) => visit.id)));
    for (const visit of visits) {
      const result = await moderateReview({ request: request("/admin/reviewer-visits", admin.session, new URLSearchParams({
        reviewId: visit.id, expectedVersion: "1", status: "APPROVED", reason: "합성 방문 검수 확인",
        visitVerified: "on", rightsVerified: "on", privacyVerified: "on", placeVerified: "on",
      })) } as never);
      expect(result, result instanceof Response ? await result.clone().text() : "").toEqual({ ok: true });
      expect(await database.prepare("SELECT status, version FROM reviewer_visit_reviews WHERE id=?").bind(visit.id).first())
        .toMatchObject({ status: "APPROVED", version: 2 });
      const published = await readPhoto({ request: request(`/review-photos/${visit.photoId}`), params: { photoId: visit.photoId } } as never);
      expect(published.status).toBe(200);
      expect(new Uint8Array(await published.arrayBuffer())).toEqual(jpeg);
    }
    expect(await listPublishedPlaceReviewPhotos(createDb(database), placeId)).toHaveLength(2);

    for (const visit of visits) {
      const withdrawn = await submitReview({ request: request("/reviewer/ratings", visit.session, new URLSearchParams({
        intent: "withdraw-review", reviewId: visit.id, expectedVersion: "2", reason: "합성 리뷰 종료",
      })) } as never);
      expect(withdrawn.status, await withdrawn.clone().text()).toBe(303);
      expect(withdrawn.headers.get("location")).toContain("notice=review-withdrawn");
      const hidden = await readPhoto({ request: request(`/review-photos/${visit.photoId}`), params: { photoId: visit.photoId } } as never);
      expect(hidden.status).toBe(404);
      expect(await database.prepare("SELECT status, photo_count, version FROM reviewer_visit_reviews WHERE id=?")
        .bind(visit.id).first()).toMatchObject({ status: "WITHDRAWN", photo_count: 0, version: 3 });
      expect(await env.REVIEW_PHOTOS.head(visit.objectKey)).toBeNull();
    }
    expect(await listPublishedPlaceReviewPhotos(createDb(database), placeId)).toHaveLength(0);
    expect(await database.prepare("SELECT count(*) AS n FROM reviewer_photo_cleanup_jobs").first("n")).toBe(0);
    expect(await database.prepare("SELECT count(*) AS n FROM reviewer_photo_cleanup_guards").first("n")).toBe(0);
  });
});
