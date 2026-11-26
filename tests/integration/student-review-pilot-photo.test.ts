import { env, withEnv } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { cleanupPilotPhotos, listPublicPilotPhotos, submitPilotPhoto } from "../../app/features/ratings/student-review-pilot-photo.server";
import { action as moderatePhoto } from "../../app/routes/admin-student-review-photos";
import { action as moderateReview } from "../../app/routes/admin-reviewer-visits";
import { action as photoAction, loader as photoForm } from "../../app/routes/reviewer-pilot-photo";
import { action as submitReview, loader as reviewHistory } from "../../app/routes/reviewer-ratings";
import { loader as readPhoto } from "../../app/routes/student-review-photo";

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
const photoAdminPath = "/admin/student-review-photos";

function request(path: string, session?: string, body?: FormData | URLSearchParams, method?: string) {
  return new Request(origin + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { Origin: origin, ...(session ? { Cookie: `retaste_session=${session}` } : {}) },
    body,
  });
}

it("runs two A/B photos on the exact 56 ledger plus 0065, with private intake, verified public read, withdrawal and late writes", async () => {
  const database = env.MIGRATION_DB;
  const baseline = env.TEST_MIGRATIONS.filter(({ name }) => {
    const version = name.slice(0, 4);
    return version <= "0062" && !omitted.has(version);
  });
  const position = baseline.findIndex(({ name }) => name === "0031_remove_workers_ai.sql");
  expect(baseline).toHaveLength(56);
  expect(baseline[position + 1].name).toMatch(/^0032/);
  [baseline[position], baseline[position + 1]] = [baseline[position + 1], baseline[position]];
  await applyD1Migrations(database, baseline);
  const migration = env.TEST_MIGRATIONS.find(({ name }) => name === "0065_student_review_pilot_photos.sql");
  expect(migration).toBeDefined();
  await applyD1Migrations(database, [migration!]);
  await expect(database.prepare("SELECT revision FROM reviewer_photo_cleanup_jobs LIMIT 0").all()).rejects.toThrow();
  await expect(database.prepare("SELECT id FROM privacy_requests LIMIT 0").all()).rejects.toThrow();

  const moment = new Date();
  const now = moment.toISOString();
  const date = now.slice(0, 10);
  const future = (minutes: number) => new Date(+moment + minutes * 60_000).toISOString();
  const placeId = "student-pilot-place";
  const categoryId = "student-pilot-category";
  await database.batch([
    database.prepare("INSERT INTO categories(id,slug,name,emoji,sort_order,is_active,created_at,updated_at) VALUES(?,?,?,'🍜',999,1,?,?)")
      .bind(categoryId, categoryId, "라멘", now, now),
    database.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED','광주광역시 동구 합성길 10','동명동',35.149,126.923,'합성 라멘',?,?)")
      .bind(placeId, placeId, "합성 라멘", now, now),
    database.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,?,1)").bind(placeId, categoryId),
  ]);

  async function account(role: "ADMIN" | "REVIEWER", id: string, seat?: string) {
    const session = `session-${id}`;
    await database.batch([
      database.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .bind(id, `${id}@example.test`, id, role, now, now, now),
      database.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(session, id, future(600), now),
      ...(seat ? [
        database.prepare(`INSERT INTO reviewer_profiles
          (user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,created_at,updated_at)
          VALUES(?,?,'ACTIVE','합성 시험','균형','GWANGJU','[]',?,?,?,?)`).bind(id, id, now, now, now, now),
        database.prepare("UPDATE student_seats SET is_active=1,user_id=?,expires_at=? WHERE code=?")
          .bind(id, future(1440), seat),
      ] : []),
    ]);
    return { id, session };
  }

  const admin = await account("ADMIN", "synthetic-admin");
  const a = await account("REVIEWER", "synthetic-a", "A");
  const b = await account("REVIEWER", "synthetic-b", "B");
  const c = await account("REVIEWER", "synthetic-c", "C");
  const bucket = env.PILOT_TEST_PHOTOS;
  const pilotEnvironment = {
    ...env, DB: database, REVIEW_PHOTO_UPLOAD_ENABLED: "false",
    STUDENT_REVIEW_PILOT_PHOTOS: bucket, STUDENT_REVIEW_PILOT_SEATS: "A,B",
  };

  await withEnv(pilotEnvironment, async () => {
    const makeReview = async (session: string) => {
      const body = new FormData();
      for (const [key, value] of Object.entries({
        intent: "publish-review", visitedOn: date, visitNote: "합성 방문 기록", disclosure: "NONE",
        placeId, categoryId, categoryName: "라멘", evaluation: "RECOMMEND", golden: "0", goldenReason: "", photoMetadata: "[]",
      })) body.set(key, value);
      const response = await submitReview({ request: request("/reviewer/ratings", session, body) } as never);
      expect(response.status, await response.clone().text()).toBe(303);
      return new URL(response.headers.get("location")!, origin).searchParams.get("submitted")!;
    };
    const submitPhoto = (reviewId: string, session: string) => {
      const body = new FormData();
      for (const [key, value] of Object.entries({
        intent: "upload", expectedContentVersion: "1", caption: "직접 촬영한 합성 사진", takenOn: date,
        ownWork: "on", privacyChecked: "on",
      })) body.set(key, value);
      body.set("photos", new File([jpeg], "synthetic.jpg", { type: "image/jpeg" }));
      const path = `/reviewer/pilot-photo/${reviewId}`;
      return photoAction({ request: request(path, session, body), params: { reviewId } } as never);
    };
    const view = (photoId: string, session?: string, method = "GET") => readPhoto({
      request: request(`/student-review-photos/${photoId}${session ? "?preview=1" : ""}`, session, undefined, method),
      params: { photoId },
    } as never);
    const checks = { visitVerified: "on", placeVerified: "on", rightsVerified: "on", privacyVerified: "on" };
    const approvePhoto = (photoId: string) => moderatePhoto({ request: request(photoAdminPath, admin.session, new URLSearchParams({
      photoId, decision: "APPROVE", reason: "합성 사진 공개 검수", ...checks,
    })) } as never);
    const photoRecords = [];
    for (const reviewer of [a, b, c]) {
      const reviewId = await makeReview(reviewer.session);
      const availability = await reviewHistory({ request: request("/reviewer/ratings", reviewer.session) } as never);
      expect(availability).toMatchObject({ photoUploadEnabled: false, pilotPhotoReviewIds: reviewer === c ? [] : [reviewId] });
      const upload = await submitPhoto(reviewId, reviewer.session);
      if (reviewer === c) {
        expect(upload).toMatchObject({ init: { status: 409 } });
        continue;
      }
      expect(upload, JSON.stringify(upload)).toMatchObject({ data: { ok: true } });
      const row = await database.prepare("SELECT id,object_key AS objectKey FROM student_review_pilot_photos WHERE review_id=?")
        .bind(reviewId).first<{ id: string; objectKey: string }>();
      expect(row).not.toBeNull();
      const photoId = row!.id;
      expect((await view(photoId)).status).toBe(404);
      expect((await view(photoId, c.session)).status).toBe(404);
      expect((await view(photoId, reviewer.session)).status).toBe(200);
      if (reviewer === a) {
        const unverifiedAdmin = await approvePhoto(photoId);
        expect(unverifiedAdmin).toBeInstanceOf(Response);
        expect((unverifiedAdmin as Response).status).toBe(302);
        await database.prepare(`INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at)
          VALUES(?,?,'PASSWORD',?,?)`).bind(admin.session, admin.id, now, future(10)).run();
        expect(await approvePhoto(photoId)).toMatchObject({ init: { status: 409 } });
      }
      const approvedReview = await moderateReview({ request: request("/admin/reviewer-visits", admin.session, new URLSearchParams({
        reviewId, expectedVersion: "1", status: "APPROVED", reason: "합성 네 항목 검수", ...checks,
      })) } as never);
      expect(approvedReview).toMatchObject({ ok: true });
      expect(await approvePhoto(photoId)).toMatchObject({ data: { ok: true } });
      const response = await view(photoId);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
      const head = await view(photoId, undefined, "HEAD");
      expect(head.status).toBe(200);
      expect(head.headers.get("Content-Length")).toBe(String(jpeg.byteLength));
      expect(await head.arrayBuffer()).toHaveProperty("byteLength", 0);
      photoRecords.push({ ...row!, reviewId, reviewer });
    }

    expect(await listPublicPilotPhotos(createDb(database), placeId)).toHaveLength(2);
    await withEnv({ ...pilotEnvironment, STUDENT_REVIEW_PILOT_SEATS: undefined }, async () => {
      for (const { id, reviewId, reviewer } of photoRecords) {
        const path = `/reviewer/pilot-photo/${reviewId}`;
        const form = await photoForm({ request: request(path, reviewer.session), params: { reviewId } } as never);
        expect(form).toMatchObject({ data: { review: { mayUpload: false, photos: [{ id, status: "APPROVED" }] } } });
        const revoked = await photoAction({ request: request(path, reviewer.session, new URLSearchParams({ intent: "withdraw", photoId: id })), params: { reviewId } } as never);
        expect(revoked).toMatchObject({ data: { ok: true } });
        expect((await view(id)).status).toBe(404);
      }
    });
    const db = createDb(database);
    await expect(cleanupPilotPhotos(db, bucket, future(1))).resolves.toMatchObject({ deleted: 2, failed: 0 });

    // An R2 request with an uncertain result may land after a cleanup pass has seen no object.
    let delayedKey = "";
    const lastReview = photoRecords[0].reviewId;
    await expect(submitPilotPhoto(db, { put: async (key) => {
      delayedKey = key;
      throw new Error("synthetic ambiguous write");
    } }, {
      userId: a.id, sessionId: a.session, reviewId: lastReview, expectedContentVersion: 1,
      seats: "A", now, caption: "지연 합성 사진", takenOn: date,
      photo: { id: crypto.randomUUID(), bytes: jpeg, contentType: "image/jpeg", byteSize: jpeg.byteLength, position: 0 },
    })).rejects.toMatchObject({ status: 503 });
    const delayedId = delayedKey.split("/").at(-1)!.replace(".jpg", "");
    expect(delayedId).toMatch(/^[a-f0-9-]{36}$/);
    await expect(cleanupPilotPhotos(db, bucket, future(2))).resolves.toMatchObject({ deleted: 0, pending: 1 });
    await bucket.put(delayedKey, jpeg, {
      httpMetadata: { contentType: "image/jpeg" }, customMetadata: { studentReviewPilotPhotoId: delayedId },
    });
    expect((await view(delayedId)).status).toBe(404);
    await expect(cleanupPilotPhotos(db, bucket, future(363))).resolves.toMatchObject({ deleted: 1, failed: 0 });
    const photo = { id: crypto.randomUUID(), bytes: jpeg, contentType: "image/jpeg" as const, byteSize: jpeg.byteLength, position: 0 };
    await expect(submitPilotPhoto(db, { put: async (key, bytes, options) => {
      const stored = await bucket.put(key, bytes, options);
      await database.prepare("DELETE FROM sessions WHERE id=?").bind(a.session).run();
      return stored;
    } }, {
      userId: a.id, sessionId: a.session, reviewId: lastReview, expectedContentVersion: 1,
      seats: "A", now, caption: "세션 철회 검증", takenOn: date, photo,
    })).rejects.toMatchObject({ status: 409 });
    expect(await listPublicPilotPhotos(db, placeId)).toHaveLength(0);
    await expect(cleanupPilotPhotos(db, bucket, future(3))).resolves.toMatchObject({ deleted: 1, failed: 0 });
    expect((await bucket.list()).objects).toHaveLength(0);
    expect(await database.prepare("SELECT count(*) AS count FROM admin_audit_logs WHERE action='STUDENT_REVIEW_PILOT_PHOTO_APPROVED'").first("count")).toBe(2);
    expect(await database.prepare("SELECT count(*) AS count FROM reviewer_visit_photos").first("count")).toBe(0);
    expect(await database.prepare("SELECT count(*) AS count FROM reviewer_photo_cleanup_jobs").first("count")).toBe(0);
  });
}, 30_000);
