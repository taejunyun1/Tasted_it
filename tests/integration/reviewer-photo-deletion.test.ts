import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import {
  deletePublishedReviewerVisitPhotos,
  deleteReviewerPhotoObjectsForUser,
} from "../../app/features/ratings/reviewer-photo-deletion.server";
import { getReviewerPhotoObjectKey } from "../../app/features/ratings/reviewer-photo.server";
import { publishReviewerVisitWithPhotos } from "../../app/features/ratings/reviewer-visit.server";

const now = "2026-08-13T00:00:00.000Z";
const categoryId = "photo-delete-category";
const placeId = "photo-delete-place";
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

function reviewInput(id: string) {
  return {
    id,
    reviewerUserId,
    placeId,
    categoryId,
    categoryName: "라멘" as const,
    evaluation: "RECOMMEND" as const,
    badges: [] as string[],
    golden: false,
    goldenReason: null,
    now,
  };
}

beforeEach(async () => {
  reviewerUserId = `photo-delete-reviewer-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id, email, display_name, role, created_at, updated_at) VALUES (?, ?, '삭제 리뷰어', 'REVIEWER', ?, ?)")
      .bind(reviewerUserId, `${reviewerUserId}@example.com`, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO reviewer_profiles (user_id, slug, status, occupation, taste_direction, region_code, specialty_slugs, last_activity_at, approved_at, created_at, updated_at) VALUES (?, ?, 'ACTIVE', '테스터', '균형', 'GWANGJU', '[]', ?, ?, ?, ?)")
      .bind(reviewerUserId, reviewerUserId, now, now, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO categories (id, slug, name, emoji, sort_order, is_active, created_at, updated_at) VALUES (?, 'photo-delete-ramen', '라멘', '🍜', 999, 1, ?, ?)")
      .bind(categoryId, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at) VALUES (?, 'photo-delete-place', '사진 삭제 라멘', 'PUBLISHED', '광주', '동명동', 35.149, 126.923, '사진 삭제 라멘', ?, ?)")
      .bind(placeId, now, now),
  ]);
});

describe("reviewer photo deletion boundary", () => {
  it("deletes only one review's exact photo metadata and objects, and is idempotent", async () => {
    const db = createDb(env.DB);
    await publishReviewerVisitWithPhotos(db, env.REVIEW_PHOTOS, { ...reviewInput("delete-one-review"), photos: [photo("delete-one-photo")] });
    await publishReviewerVisitWithPhotos(db, env.REVIEW_PHOTOS, { ...reviewInput("keep-one-review"), photos: [photo("keep-one-photo")] });

    await expect(deletePublishedReviewerVisitPhotos(db, env.REVIEW_PHOTOS, "delete-one-review")).resolves.toEqual({ deleted: 1 });
    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey("delete-one-review", "delete-one-photo"))).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_photos WHERE id = 'delete-one-photo'").first()).resolves.toBeNull();
    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey("keep-one-review", "keep-one-photo"))).resolves.toBeTruthy();
    await expect(deletePublishedReviewerVisitPhotos(db, env.REVIEW_PHOTOS, "delete-one-review")).resolves.toEqual({ deleted: 0 });
  });

  it("treats a missing object as deleted and then removes its exact metadata", async () => {
    const db = createDb(env.DB);
    await publishReviewerVisitWithPhotos(db, env.REVIEW_PHOTOS, { ...reviewInput("missing-object-review"), photos: [photo("missing-object-photo")] });
    await env.REVIEW_PHOTOS.delete(getReviewerPhotoObjectKey("missing-object-review", "missing-object-photo"));

    await expect(deletePublishedReviewerVisitPhotos(db, env.REVIEW_PHOTOS, "missing-object-review")).resolves.toEqual({ deleted: 1 });
    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_photos WHERE id = 'missing-object-photo'").first()).resolves.toBeNull();
  });

  it("does not delete metadata after a partial object delete failure, so retry can recover", async () => {
    const db = createDb(env.DB);
    await publishReviewerVisitWithPhotos(db, env.REVIEW_PHOTOS, {
      ...reviewInput("retry-review"),
      photos: [photo("retry-photo-1"), photo("retry-photo-2", 1)],
    });
    const failingStore = {
      delete: async (keys: string | string[]) => {
        const [firstKey] = Array.isArray(keys) ? keys : [keys];
        await env.REVIEW_PHOTOS.delete(firstKey);
        throw new Error("R2_DELETE_FAILED");
      },
    };

    await expect(deletePublishedReviewerVisitPhotos(db, failingStore, "retry-review")).rejects.toThrow("PHOTO_CLEANUP_FAILED");
    await expect(env.DB.prepare("SELECT count(*) AS count FROM reviewer_visit_photos WHERE review_id = 'retry-review'").first<{ count: number }>()).resolves.toEqual({ count: 2 });
    await expect(deletePublishedReviewerVisitPhotos(db, env.REVIEW_PHOTOS, "retry-review")).resolves.toEqual({ deleted: 2 });
  });

  it("deletes a reviewer's rows in bounded pages without bucket listing or touching another reviewer", async () => {
    const db = createDb(env.DB);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const photos = Array.from({ length: 101 }, (_, index) => ({
      reviewId: `delete-page-review-${index}`,
      photoId: `delete-page-photo-${index}`,
    }));
    const statements = photos.flatMap((item) => {
      const objectKey = getReviewerPhotoObjectKey(item.reviewId, item.photoId);
      return [
        env.DB.prepare("INSERT INTO reviewer_visit_reviews (id, place_id, reviewer_user_id, category_id, evaluation, badges_json, photo_count, version, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'RECOMMEND', '[]', 1, 1, ?, ?, ?)")
          .bind(item.reviewId, placeId, reviewerUserId, categoryId, now, now, now),
        env.DB.prepare("INSERT INTO reviewer_visit_photos (id, review_id, object_key, content_type, byte_size, position, created_at, updated_at) VALUES (?, ?, ?, 'image/jpeg', 4, 0, ?, ?)")
          .bind(item.photoId, item.reviewId, objectKey, now, now),
      ];
    });
    for (let index = 0; index < statements.length; index += 40) {
      await env.DB.batch(statements.slice(index, index + 40));
    }
    await Promise.all(photos.map((item) => env.REVIEW_PHOTOS.put(
      getReviewerPhotoObjectKey(item.reviewId, item.photoId),
      jpeg,
      { httpMetadata: { contentType: "image/jpeg" } },
    )));

    const otherUserId = `photo-delete-other-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES (?, ?, '다른 리뷰어', 'REVIEWER', ?, ?)")
        .bind(otherUserId, `${otherUserId}@example.com`, now, now),
      env.DB.prepare("INSERT INTO reviewer_profiles (user_id, slug, status, occupation, taste_direction, region_code, specialty_slugs, last_activity_at, approved_at, created_at, updated_at) VALUES (?, ?, 'ACTIVE', '테스터', '균형', 'GWANGJU', '[]', ?, ?, ?, ?)")
        .bind(otherUserId, otherUserId, now, now, now, now),
    ]);
    await publishReviewerVisitWithPhotos(db, env.REVIEW_PHOTOS, {
      ...reviewInput("other-review"),
      reviewerUserId: otherUserId,
      photos: [photo("other-photo")],
    });

    await expect(deleteReviewerPhotoObjectsForUser(db, env.REVIEW_PHOTOS, reviewerUserId)).resolves.toEqual({ deleted: 101 });
    await expect(env.DB.prepare("SELECT count(*) AS count FROM reviewer_visit_photos WHERE review_id LIKE 'delete-page-review-%'").first<{ count: number }>()).resolves.toEqual({ count: 0 });
    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey("other-review", "other-photo"))).resolves.toBeTruthy();
  });
});
