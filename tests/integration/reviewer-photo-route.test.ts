import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getReviewerPhotoObjectKey } from "../../app/features/ratings/reviewer-photo.server";
import { createDb } from "../../app/db/client.server";
import { createUserSession, getOptionalUser } from "../../app/features/auth/session.server";
import { requireActiveReviewer } from "../../app/features/ratings/reviewer-moderation.server";
import { getReviewerPhotoPreview } from "../../app/features/ratings/reviewer-photo-access.server";
import { loader } from "../../app/routes/reviewer-photo";

const now = "2026-08-13T00:00:00.000Z";
const placeId = "public-photo-place";
const categoryId = "public-photo-category";
const reviewerId = "public-photo-reviewer";

async function seedPublishedPhoto(photoId: string, reviewId = `review-${photoId}`) {
  const objectKey = getReviewerPhotoObjectKey(reviewId, photoId);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id, email, display_name, role, created_at, updated_at) VALUES (?, ?, '공개 사진 리뷰어', 'REVIEWER', ?, ?)")
      .bind(reviewerId, `${reviewerId}@example.com`, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO categories (id, slug, name, emoji, sort_order, is_active, created_at, updated_at) VALUES (?, 'public-photo-ramen', '라멘', '🍜', 999, 1, ?, ?)")
      .bind(categoryId, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at) VALUES (?, 'public-photo-place', '공개 사진 라멘', 'PUBLISHED', '광주', '동명동', 35.149, 126.923, '공개 사진 라멘', ?, ?)")
      .bind(placeId, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO reviewer_profiles (user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,created_at,updated_at) VALUES (?,?,'ACTIVE','테스터','균형','GWANGJU','[]',?,?,?,?)").bind(reviewerId,reviewerId,now,now,now,now),
    env.DB.prepare("UPDATE users SET role='REVIEWER',email=? WHERE id=?").bind(`${reviewerId}@example.com`,reviewerId),
    env.DB.prepare("UPDATE reviewer_profiles SET status='ACTIVE' WHERE user_id=?").bind(reviewerId),
    env.DB.prepare("INSERT INTO reviewer_visit_reviews (id, place_id, reviewer_user_id, category_id, evaluation, badges_json, photo_count, version, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'RECOMMEND', '[]', 1, 1, ?, ?, ?)")
      .bind(reviewId, placeId, reviewerId, categoryId, now, now, now),
    env.DB.prepare("INSERT INTO reviewer_visit_photos (id, review_id, object_key, content_type, byte_size, position, created_at, updated_at) VALUES (?, ?, ?, 'image/jpeg', 4, 0, ?, ?)")
      .bind(photoId, reviewId, objectKey, now, now),
  ]);
  await env.DB.batch([
    env.DB.prepare("UPDATE reviewer_visit_reviews SET status='APPROVED',is_current=1,content_version=1,approved_content_version=1,visited_on='2026-08-12',visit_note='방문 근거',disclosure='NONE',reviewed_by='test-admin',reviewed_at=?,rule_version='cst-reviewer-publication-v1' WHERE id=?").bind(now,reviewId),
    env.DB.prepare("UPDATE reviewer_visit_photos SET content_version=1,taken_on='2026-08-12',rights_basis='OWN_WORK',caption='직접 촬영한 음식',privacy_checked=1 WHERE id=?").bind(photoId),
  ]);
  await env.REVIEW_PHOTOS.put(objectKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return objectKey;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM reviewer_visit_photos; DELETE FROM reviewer_visit_reviews");
  await env.DB.prepare("UPDATE places SET status = 'PUBLISHED' WHERE id = ?").bind(placeId).run();
});

describe("reviewer photo resource route", () => {
  it("serves a published JPEG through an opaque id with bounded public headers", async () => {
    await seedPublishedPhoto("public-photo-1");
    const response = await loader({
      request: new Request("https://retaste.test/review-photos/public-photo-1"),
      params: { photoId: "public-photo-1" },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("etag")).toBeTruthy();
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it.each(["PENDING", "CHANGES_REQUESTED", "REJECTED", "WITHDRAWN", "LEGACY_UNREVIEWED"])("hides %s reviews before reading R2", async (status) => {
    const photoId = `state-${status}`;
    await seedPublishedPhoto(photoId);
    await env.DB.prepare("UPDATE reviewer_visit_reviews SET status = ? WHERE id = ?").bind(status, `review-${photoId}`).run();
    const get = vi.spyOn(env.REVIEW_PHOTOS, "get");
    try {
      for (const method of ["GET", "HEAD"]) {
        const response = await loader({ request: new Request(`https://retaste.test/review-photos/${photoId}`, { method }), params: { photoId } } as never);
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("vary")).toBe("Cookie");
      }
      expect(get).not.toHaveBeenCalled();
    } finally { get.mockRestore(); }
  });

  it("hides a photo when its place is no longer published", async () => {
    await seedPublishedPhoto("hidden-place-photo");
    await env.DB.prepare("UPDATE places SET status = 'HIDDEN' WHERE id = ?").bind(placeId).run();
    const get = vi.spyOn(env.REVIEW_PHOTOS, "get");
    try {
      const response = await loader({ request: new Request("https://retaste.test/review-photos/hidden-place-photo"), params: { photoId: "hidden-place-photo" } } as never);
      expect(response.status).toBe(404);
      expect(get).not.toHaveBeenCalled();
    } finally { get.mockRestore(); }
  });

  it("returns headers without a body for HEAD", async () => {
    await seedPublishedPhoto("public-photo-head");
    const response = await loader({
      request: new Request("https://retaste.test/review-photos/public-photo-head", { method: "HEAD" }),
      params: { photoId: "public-photo-head" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
  });

  it("does not expose unknown, orphaned, or missing R2 photos", async () => {
    const unknown = await loader({ request: new Request("https://retaste.test/review-photos/unknown"), params: { photoId: "unknown" } } as never);
    expect(unknown.status).toBe(404);

    await env.DB.prepare("INSERT INTO reviewer_visit_photos (id, review_id, object_key, content_type, byte_size, position, created_at, updated_at) VALUES ('orphan-photo', 'missing-review', 'reviews/missing/orphan.jpg', 'image/jpeg', 4, 0, ?, ?)")
      .bind(now, now).run().catch(() => undefined);
    const orphan = await loader({ request: new Request("https://retaste.test/review-photos/orphan-photo"), params: { photoId: "orphan-photo" } } as never);
    expect(orphan.status).toBe(404);

    await seedPublishedPhoto("missing-object");
    await env.REVIEW_PHOTOS.delete(getReviewerPhotoObjectKey("review-missing-object", "missing-object"));
    const missing = await loader({ request: new Request("https://retaste.test/review-photos/missing-object"), params: { photoId: "missing-object" } } as never);
    expect(missing.status).toBe(404);
  });

  it("rejects outdated photo versions and dormant reviewers", async () => {
    await seedPublishedPhoto("outdated-version");
    await env.DB.prepare("UPDATE reviewer_visit_photos SET content_version=2 WHERE id='outdated-version'").run();
    expect((await loader({ request: new Request("https://retaste.test/review-photos/outdated-version"), params: { photoId: "outdated-version" } } as never)).status).toBe(404);
    await env.DB.prepare("UPDATE reviewer_visit_reviews SET is_current=0 WHERE id='review-outdated-version'").run();
    await seedPublishedPhoto("dormant-photo");
    await env.DB.prepare("UPDATE reviewer_profiles SET status='DORMANT' WHERE user_id=?").bind(reviewerId).run();
    expect((await loader({ request: new Request("https://retaste.test/review-photos/dormant-photo"), params: { photoId: "dormant-photo" } } as never)).status).toBe(404);
  });

  it("allows private owner/admin previews but rejects other or withdrawn actors", async () => {
    const peerReviewerId = "preview-peer-reviewer";
    const previewUrl = "https://retaste.test/review-photos/private-preview?preview=1";
    const params = { photoId: "private-preview" };
    await seedPublishedPhoto("private-preview");
    await env.DB.prepare("UPDATE reviewer_visit_reviews SET status='PENDING' WHERE id='review-private-preview'").run();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO users(id,email,display_name,role,created_at,updated_at) VALUES ('preview-admin','preview-admin@example.com','관리자','ADMIN',?,?)").bind(now,now),
      env.DB.prepare("INSERT OR IGNORE INTO users(id,email,display_name,role,created_at,updated_at) VALUES ('preview-other','preview-other@example.com','다른 회원','USER',?,?)").bind(now,now),
      env.DB.prepare("INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES (?, ?, '다른 리뷰어', 'REVIEWER', ?, ?)")
        .bind(peerReviewerId, `${peerReviewerId}@example.com`, now, now),
      env.DB.prepare("INSERT INTO reviewer_profiles (user_id, slug, status, occupation, taste_direction, region_code, specialty_slugs, last_activity_at, approved_at, created_at, updated_at) VALUES (?, ?, 'ACTIVE', '테스터', '균형', 'GWANGJU', '[]', ?, ?, ?, ?)")
        .bind(peerReviewerId, peerReviewerId, now, now, now, now),
    ]);
    const db = createDb(env.DB);
    expect(await getReviewerPhotoPreview(db,{ photoId:'private-preview',actorUserId:reviewerId })).toMatchObject({id:'private-preview'});
    const cookie = await createUserSession({ userId: reviewerId, now: new Date(), requestUrl: previewUrl });
    const ownerPreview = await loader({ request: new Request(previewUrl, { headers: { Cookie: cookie.split(";")[0] } }), params } as never);
    expect(ownerPreview.status).toBe(200);
    expect(ownerPreview.headers.get('cache-control')).toBe('private, no-store');
    expect(await getReviewerPhotoPreview(db,{ photoId:'private-preview',actorUserId:'preview-admin' })).toMatchObject({id:'private-preview'});
    expect(await getReviewerPhotoPreview(db,{ photoId:'private-preview',actorUserId:'preview-other' })).toBeNull();
    expect(await getReviewerPhotoPreview(db,{ photoId:'private-preview',actorUserId:'missing-actor' })).toBeNull();
    await requireActiveReviewer(db, peerReviewerId);
    const peerCookie = await createUserSession({ userId: peerReviewerId, now: new Date(), requestUrl: previewUrl });
    const peerHeaders = { Cookie: peerCookie.split(";")[0] };
    expect(await getOptionalUser(new Request(previewUrl, { headers: peerHeaders })))
      .toMatchObject({ id: peerReviewerId, role: "REVIEWER" });

    const get = vi.spyOn(env.REVIEW_PHOTOS, "get");
    try {
      for (const method of ["GET", "HEAD"]) {
        const request = new Request(previewUrl, { method, headers: peerHeaders });
        const response = await loader({ request, params } as never);
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("vary")).toBe("Cookie");
        expect(response.body).toBeNull();
      }
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
    await env.DB.prepare("UPDATE users SET email=? WHERE id=?").bind(`withdrawn.${reviewerId}@invalid.local`,reviewerId).run();
    expect(await getReviewerPhotoPreview(db,{ photoId:'private-preview',actorUserId:reviewerId })).toBeNull();
    const anonymousPreview = await loader({ request: new Request(previewUrl), params } as never);
    expect(anonymousPreview.status).toBe(404);
  });

  it("returns a safe 503 when R2 cannot read an otherwise public photo", async () => {
    await seedPublishedPhoto("temporary-read-failure");
    const get = vi.spyOn(env.REVIEW_PHOTOS, "get").mockRejectedValueOnce(new Error("R2_UNAVAILABLE"));
    try {
      const response = await loader({
        request: new Request("https://retaste.test/review-photos/temporary-read-failure"),
        params: { photoId: "temporary-read-failure" },
      } as never);

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toBe("Cookie");
      await expect(response.text()).resolves.toBe("");
    } finally {
      get.mockRestore();
    }
  });

  it("rejects unsafe ids and non-read methods", async () => {
    const unsafe = await loader({ request: new Request("https://retaste.test/review-photos/..%2Fsecret"), params: { photoId: "../secret" } } as never);
    expect(unsafe.status).toBe(404);
    const method = await loader({ request: new Request("https://retaste.test/review-photos/public-photo-1", { method: "POST" }), params: { photoId: "public-photo-1" } } as never);
    expect(method.status).toBe(405);
  });
});
