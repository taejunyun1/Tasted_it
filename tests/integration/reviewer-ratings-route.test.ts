import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { MAX_REVIEWER_RATING_REQUEST_BYTES } from "../../app/features/ratings/reviewer-visit-publish.server";
import { getReviewerPhotoObjectKey } from "../../app/features/ratings/reviewer-photo.server";
import { publishReviewerRatingRequest } from "../../app/features/ratings/reviewer-visit-publish.server";

const now = "2026-08-13T00:00:00.000Z";

async function seedReviewerRouteData(prefix: string) {
  const reviewerId = `${prefix}-reviewer-${crypto.randomUUID()}`;
  const sessionId = `${prefix}-session-${crypto.randomUUID()}`;
  const categoryId = `${prefix}-category-${crypto.randomUUID()}`;
  const placeId = `${prefix}-place-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES (?, ?, '리뷰어', 'REVIEWER', ?, ?)")
      .bind(reviewerId, `${reviewerId}@example.com`, now, now),
    env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, '2099-01-01T00:00:00.000Z', ?)")
      .bind(sessionId, reviewerId, now),
    env.DB.prepare("INSERT INTO reviewer_profiles (user_id, slug, status, occupation, taste_direction, region_code, specialty_slugs, last_activity_at, approved_at, created_at, updated_at) VALUES (?, ?, 'ACTIVE', '테스터', '균형', 'GWANGJU', '[]', ?, ?, ?, ?)")
      .bind(reviewerId, `${prefix}-${crypto.randomUUID()}`, now, now, now, now),
    env.DB.prepare("INSERT INTO categories (id, slug, name, emoji, sort_order, is_active, created_at, updated_at) VALUES (?, ?, '라멘', '🍜', 999, 1, ?, ?)")
      .bind(categoryId, `${prefix}-${crypto.randomUUID()}`, now, now),
    env.DB.prepare("INSERT INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at) VALUES (?, ?, '발행 경로 라멘', 'PUBLISHED', '광주', '동명동', 35.149, 126.923, '발행 경로 라멘', ?, ?)")
      .bind(placeId, `${prefix}-${crypto.randomUUID()}`, now, now),
  ]);
  return { reviewerId, sessionId, categoryId, placeId };
}

function reviewPhotoForm(input: { placeId: string; categoryId: string }, withPhoto = true) {
  const form = new FormData();
  form.set("intent", "publish-review");
  form.set("placeId", input.placeId);
  form.set("categoryId", input.categoryId);
  form.set("categoryName", "라멘");
  form.set("evaluation", "RECOMMEND");
  form.set("golden", "0");
  form.set("goldenReason", "");
  if (withPhoto) form.append("photos", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "camera.jpg", { type: "image/jpeg" }));
  return form;
}

describe("reviewer ratings publish action", () => {
  it("stores selected photos and redirects with an allowlisted success notice", async () => {
    const seeded = await seedReviewerRouteData("reviewer-route-photo");
    const response = await publishReviewerRatingRequest(new Request("https://retaste.test/reviewer/ratings", {
      method: "POST",
      headers: { Cookie: `retaste_session=${seeded.sessionId}`, Origin: "https://retaste.test" },
      body: reviewPhotoForm(seeded),
    }), { db: createDb(env.DB), photoBucket: env.REVIEW_PHOTOS, photoUploadEnabled: true, reviewerUserId: seeded.reviewerId, now });

    expect(response.headers.get("location")).toMatch(/^\/reviewer\/ratings\?published=[A-Za-z0-9-]+&notice=review-with-photos-published$/);
    const review = await env.DB.prepare("SELECT id, photo_count AS photoCount FROM reviewer_visit_reviews WHERE reviewer_user_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(seeded.reviewerId).first<{ id: string; photoCount: number }>();
    expect(review).toMatchObject({ photoCount: 1 });
    const photo = await env.DB.prepare("SELECT id FROM reviewer_visit_photos WHERE review_id = ?")
      .bind(review!.id).first<{ id: string }>();
    expect(photo?.id).toBeTruthy();
    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(review!.id, photo!.id))).resolves.toBeTruthy();
  });

  it("rejects cross-origin publish requests without writing a review", async () => {
    const seeded = await seedReviewerRouteData("reviewer-route-origin");
    const response = await publishReviewerRatingRequest(new Request("https://retaste.test/reviewer/ratings", {
      method: "POST",
      headers: { Cookie: `retaste_session=${seeded.sessionId}`, Origin: "https://elsewhere.invalid" },
      body: reviewPhotoForm(seeded, false),
    }), { db: createDb(env.DB), photoBucket: env.REVIEW_PHOTOS, photoUploadEnabled: true, reviewerUserId: seeded.reviewerId, now });

    expect(response.status).toBe(403);
    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_reviews WHERE reviewer_user_id = ?")
      .bind(seeded.reviewerId).first()).resolves.toBeNull();
  });

  it("rejects an origin-less publish request without writing a review", async () => {
    const seeded = await seedReviewerRouteData("reviewer-route-missing-origin");
    const response = await publishReviewerRatingRequest(new Request("https://retaste.test/reviewer/ratings", {
      method: "POST",
      headers: { Cookie: `retaste_session=${seeded.sessionId}` },
      body: reviewPhotoForm(seeded, false),
    }), { db: createDb(env.DB), photoBucket: env.REVIEW_PHOTOS, photoUploadEnabled: true, reviewerUserId: seeded.reviewerId, now });

    expect(response.status).toBe(403);
    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_reviews WHERE reviewer_user_id = ?")
      .bind(seeded.reviewerId).first()).resolves.toBeNull();
  });

  it("rejects an oversized multipart request before it is parsed", async () => {
    const seeded = await seedReviewerRouteData("reviewer-route-content-length");
    const response = await publishReviewerRatingRequest(new Request("https://retaste.test/reviewer/ratings", {
      method: "POST",
      headers: {
        Cookie: `retaste_session=${seeded.sessionId}`,
        Origin: "https://retaste.test",
        "Content-Length": String(MAX_REVIEWER_RATING_REQUEST_BYTES + 1),
      },
      body: reviewPhotoForm(seeded, false),
    }), { db: createDb(env.DB), photoBucket: env.REVIEW_PHOTOS, photoUploadEnabled: true, reviewerUserId: seeded.reviewerId, now });

    expect(response.status).toBe(413);
    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_reviews WHERE reviewer_user_id = ?")
      .bind(seeded.reviewerId).first()).resolves.toBeNull();
  });
});
