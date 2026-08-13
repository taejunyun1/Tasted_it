import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getReviewerPhotoObjectKey } from "../../app/features/ratings/reviewer-photo.server";
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
    env.DB.prepare("INSERT INTO reviewer_visit_reviews (id, place_id, reviewer_user_id, category_id, evaluation, badges_json, photo_count, version, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'RECOMMEND', '[]', 1, 1, ?, ?, ?)")
      .bind(reviewId, placeId, reviewerId, categoryId, now, now, now),
    env.DB.prepare("INSERT INTO reviewer_visit_photos (id, review_id, object_key, content_type, byte_size, position, created_at, updated_at) VALUES (?, ?, ?, 'image/jpeg', 4, 0, ?, ?)")
      .bind(photoId, reviewId, objectKey, now, now),
  ]);
  await env.REVIEW_PHOTOS.put(objectKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return objectKey;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM reviewer_visit_photos; DELETE FROM reviewer_visit_reviews");
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
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=86400");
    expect(response.headers.get("etag")).toBeTruthy();
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0xd9]);
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

  it("returns a safe 503 when R2 cannot read an otherwise public photo", async () => {
    await seedPublishedPhoto("temporary-read-failure");
    const get = vi.spyOn(env.REVIEW_PHOTOS, "get").mockRejectedValueOnce(new Error("R2_UNAVAILABLE"));
    try {
      const response = await loader({
        request: new Request("https://retaste.test/review-photos/temporary-read-failure"),
        params: { photoId: "temporary-read-failure" },
      } as never);

      expect(response.status).toBe(503);
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
