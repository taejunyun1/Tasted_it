import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { getReviewerPhotoObjectKey } from "../../app/features/ratings/reviewer-photo.server";
import {
  listPublishedPlaceReviewPhotos,
  listReviewerVisitHistory,
  publishReviewerVisitWithPhotos,
} from "../../app/features/ratings/reviewer-visit.server";

const now = "2026-08-13T00:00:00.000Z";
const categoryId = "photo-publish-category";
const placeId = "photo-publish-place";
let reviewerUserId = "";

function photo(id: string, position = 0) {
  return {
    id,
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    contentType: "image/jpeg" as const,
    byteSize: 4,
    position,
  };
}

function reviewInput(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    reviewerUserId,
    placeId,
    categoryId,
    categoryName: "라멘" as const,
    evaluation: "RECOMMEND" as const,
    badges: [] as string[],
    golden: false,
    goldenReason: null,
    now,
    ...overrides,
  };
}

beforeEach(async () => {
  reviewerUserId = `photo-publish-reviewer-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id, email, display_name, role, created_at, updated_at) VALUES (?, ?, '사진 리뷰어', 'REVIEWER', ?, ?)")
      .bind(reviewerUserId, `${reviewerUserId}@example.com`, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO reviewer_profiles (user_id, slug, status, occupation, taste_direction, region_code, specialty_slugs, last_activity_at, approved_at, created_at, updated_at) VALUES (?, ?, 'ACTIVE', '테스터', '균형', 'GWANGJU', '[]', ?, ?, ?, ?)")
      .bind(reviewerUserId, reviewerUserId, now, now, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO categories (id, slug, name, emoji, sort_order, is_active, created_at, updated_at) VALUES (?, 'photo-publish-ramen', '라멘', '🍜', 999, 1, ?, ?)")
      .bind(categoryId, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at) VALUES (?, 'photo-publish-place', '사진 발행 라멘', 'PUBLISHED', '광주', '동명동', 35.149, 126.923, '사진 라멘', ?, ?)")
      .bind(placeId, now, now),
  ]);
});

describe("publishReviewerVisitWithPhotos", () => {
  it("publishes review and photo metadata together after durable R2 storage", async () => {
    const reviewId = "photo-publish-success";
    const result = await publishReviewerVisitWithPhotos(createDb(env.DB), env.REVIEW_PHOTOS, {
      ...reviewInput({ id: reviewId }),
      photos: [photo("photo-publish-1")],
    });

    expect(result.review).toMatchObject({ id: reviewId, photoCount: 1 });
    expect(result.photos).toEqual([{ id: "photo-publish-1", url: "/review-photos/photo-publish-1" }]);
    await expect(env.DB.prepare("SELECT review_id AS reviewId, position FROM reviewer_visit_photos WHERE id = ?")
      .bind("photo-publish-1").first()).resolves.toEqual({ reviewId, position: 0 });
    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewId, "photo-publish-1"))).resolves.toBeTruthy();
  });

  it("does not persist a review when photo storage fails", async () => {
    const reviewId = "photo-publish-storage-failure";
    const failingStore = {
      put: async () => { throw new Error("R2_DOWN"); },
      delete: async () => {},
    };

    await expect(publishReviewerVisitWithPhotos(createDb(env.DB), failingStore, {
      ...reviewInput({ id: reviewId }),
      photos: [photo("photo-storage-failure")],
    })).rejects.toThrow("PHOTO_STORAGE_FAILED");

    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_reviews WHERE id = ?").bind(reviewId).first()).resolves.toBeNull();
  });

  it("compensates stored R2 photos if the D1 publish batch fails", async () => {
    const reviewId = "photo-publish-d1-failure";
    const photoId = "photo-d1-failure";
    await env.DB.exec("CREATE TRIGGER IF NOT EXISTS reviewer_photo_publish_failure BEFORE INSERT ON reviewer_visit_photos BEGIN SELECT RAISE(FAIL, 'REVIEW_PHOTO_TEST_TRIGGER'); END");

    await expect(publishReviewerVisitWithPhotos(createDb(env.DB), env.REVIEW_PHOTOS, {
      ...reviewInput({ id: reviewId }),
      photos: [photo(photoId)],
    })).rejects.toThrow("REVIEW_PHOTO_TEST_TRIGGER");

    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_reviews WHERE id = ?").bind(reviewId).first()).resolves.toBeNull();
    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewId, photoId))).resolves.toBeNull();
    await env.DB.exec("DROP TRIGGER reviewer_photo_publish_failure");
  });

  it("requires a durable uploaded photo for Golden Pick", async () => {
    await expect(publishReviewerVisitWithPhotos(createDb(env.DB), env.REVIEW_PHOTOS, {
      ...reviewInput({
        id: "golden-no-photo",
        golden: true,
        badges: ["육수 농도 선명", "면 익힘 알맞음"],
        goldenReason: "육수와 면의 조화가 안정적이라 다시 찾고 싶은 라멘입니다.",
      }),
      photos: [],
    })).rejects.toThrow("GOLDEN_PICK_PUBLISHED_PHOTO_REQUIRED");
  });

  it("does not persist photo rows when the photo count invariant is removed", async () => {
    const reviewId = "photo-count-invariant";
    const result = await publishReviewerVisitWithPhotos(createDb(env.DB), env.REVIEW_PHOTOS, {
      ...reviewInput({ id: reviewId }),
      photos: [photo("photo-count-invariant")],
    });

    expect(result.review.photoCount).toBe(1);
    await expect(env.DB.prepare("SELECT count(*) AS count FROM reviewer_visit_photos WHERE review_id = ?")
      .bind(reviewId).first<{ count: number }>()).resolves.toEqual({ count: 1 });
  });

  it("projects only opaque public photo URLs for every viewer of a place", async () => {
    const db = createDb(env.DB);
    await publishReviewerVisitWithPhotos(db, env.REVIEW_PHOTOS, {
      ...reviewInput({ id: "public-photo-old", now: "2026-08-13T00:00:00.000Z" }),
      photos: [photo("public-photo-old-1")],
    });
    await publishReviewerVisitWithPhotos(db, env.REVIEW_PHOTOS, {
      ...reviewInput({ id: "public-photo-new", now: "2026-08-13T01:00:00.000Z" }),
      photos: [photo("public-photo-new-1"), photo("public-photo-new-2", 1)],
    });

    const photos = await listPublishedPlaceReviewPhotos(db, placeId, 12);
    expect(photos.slice(0, 3)).toEqual([
      expect.objectContaining({ id: "public-photo-new-1", url: "/review-photos/public-photo-new-1", position: 0 }),
      expect.objectContaining({ id: "public-photo-new-2", url: "/review-photos/public-photo-new-2", position: 1 }),
      expect.objectContaining({ id: "public-photo-old-1", url: "/review-photos/public-photo-old-1", position: 0 }),
    ]);
    expect(photos.some((photo) => "objectKey" in photo)).toBe(false);
  });

  it("includes only opaque photo URLs in the reviewer’s own history", async () => {
    const db = createDb(env.DB);
    await publishReviewerVisitWithPhotos(db, env.REVIEW_PHOTOS, {
      ...reviewInput({ id: "history-photo-review" }),
      photos: [photo("history-photo-1")],
    });

    const history = await listReviewerVisitHistory(db, reviewerUserId, 12);
    const review = history.find((item) => item.id === "history-photo-review");
    expect(review).toMatchObject({
      photos: [{ id: "history-photo-1", url: "/review-photos/history-photo-1" }],
    });
    expect("objectKey" in (review?.photos[0] ?? {})).toBe(false);
  });
});
