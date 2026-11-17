import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import {
  deletePublishedReviewerVisitPhotos,
  deleteReviewerPhotoObjectsForUser,
  enqueueReviewerPhotoDeletion,
  recoverPendingReviewerPhotoCleanup,
} from "../../app/features/ratings/reviewer-photo-deletion.server";
import { getReviewerPhotoObjectKey } from "../../app/features/ratings/reviewer-photo.server";
import { withdrawAccount } from "../../app/features/auth/account.server";
import { getReviewerPhotoPreview } from "../../app/features/ratings/reviewer-photo-access.server";

async function seedStoredVisit(_db: unknown, bucket: typeof env.REVIEW_PHOTOS, input: ReturnType<typeof reviewInput> & { photos: ReturnType<typeof photo>[] }) {
  await env.DB.prepare("INSERT INTO reviewer_visit_reviews(id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,published_at,created_at,updated_at) VALUES(?,?,?,?,?,'[]',?,?,?,?)")
    .bind(input.id,input.placeId,input.reviewerUserId,input.categoryId,input.evaluation,input.photos.length,input.now,input.now,input.now).run();
  for(const item of input.photos) {
    const objectKey=getReviewerPhotoObjectKey(input.id,item.id);
    await bucket.put(objectKey,item.bytes,{httpMetadata:{contentType:item.contentType}});
    await env.DB.prepare("INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,created_at,updated_at) VALUES(?,?,?,'image/jpeg',?,?,?,?)")
      .bind(item.id,input.id,objectKey,item.byteSize,item.position,input.now,input.now).run();
  }
}

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

async function authorizeOwnerDeletion() {
  await env.DB.prepare("UPDATE users SET email='withdrawn.'||id||'@invalid.local' WHERE id=?").bind(reviewerUserId).run();
}

describe("reviewer photo deletion boundary", () => {
  it("deletes only one review's exact photo metadata and objects, and is idempotent", async () => {
    await authorizeOwnerDeletion();
    const db = createDb(env.DB);
    await seedStoredVisit(db, env.REVIEW_PHOTOS, { ...reviewInput("delete-one-review"), photos: [photo("delete-one-photo")] });
    await seedStoredVisit(db, env.REVIEW_PHOTOS, { ...reviewInput("keep-one-review"), photos: [photo("keep-one-photo")] });

    await expect(deletePublishedReviewerVisitPhotos(db, env.REVIEW_PHOTOS, "delete-one-review")).resolves.toEqual({ deleted: 1 });
    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey("delete-one-review", "delete-one-photo"))).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_photos WHERE id = 'delete-one-photo'").first()).resolves.toBeNull();
    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey("keep-one-review", "keep-one-photo"))).resolves.toBeTruthy();
    await expect(deletePublishedReviewerVisitPhotos(db, env.REVIEW_PHOTOS, "delete-one-review")).resolves.toEqual({ deleted: 0 });
  });

  it("treats a missing object as deleted and then removes its exact metadata", async () => {
    await authorizeOwnerDeletion();
    const db = createDb(env.DB);
    await seedStoredVisit(db, env.REVIEW_PHOTOS, { ...reviewInput("missing-object-review"), photos: [photo("missing-object-photo")] });
    await env.REVIEW_PHOTOS.delete(getReviewerPhotoObjectKey("missing-object-review", "missing-object-photo"));

    await expect(deletePublishedReviewerVisitPhotos(db, env.REVIEW_PHOTOS, "missing-object-review")).resolves.toEqual({ deleted: 1 });
    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_photos WHERE id = 'missing-object-photo'").first()).resolves.toBeNull();
  });

  it("does not delete metadata after a partial object delete failure, so retry can recover", async () => {
    await authorizeOwnerDeletion();
    const db = createDb(env.DB);
    await seedStoredVisit(db, env.REVIEW_PHOTOS, {
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
    await authorizeOwnerDeletion();
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
    await seedStoredVisit(db, env.REVIEW_PHOTOS, {
      ...reviewInput("other-review"),
      reviewerUserId: otherUserId,
      photos: [photo("other-photo")],
    });

    await expect(deleteReviewerPhotoObjectsForUser(db, env.REVIEW_PHOTOS, reviewerUserId)).resolves.toEqual({ deleted: 101 });
    await expect(env.DB.prepare("SELECT count(*) AS count FROM reviewer_visit_photos WHERE review_id LIKE 'delete-page-review-%'").first<{ count: number }>()).resolves.toEqual({ count: 0 });
    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey("other-review", "other-photo"))).resolves.toBeTruthy();
  });
  it("keeps a durable DELETE plan after failure and retries even while the review still exists", async () => {
    await authorizeOwnerDeletion();
    const db=createDb(env.DB);
    await seedStoredVisit(db,env.REVIEW_PHOTOS,{...reviewInput('durable-delete-review'),photos:[photo('durable-delete-photo')]});
    await enqueueReviewerPhotoDeletion(db,{reviewId:'durable-delete-review',now});
    const failingStore={delete:async()=>{throw new Error('R2_UNAVAILABLE');}};
    expect(await recoverPendingReviewerPhotoCleanup(db,failingStore,{now})).toEqual({deleted:0,pending:1,failed:1});
    expect(await env.DB.prepare("SELECT purpose,attempt_count AS attempts FROM reviewer_photo_cleanup_jobs WHERE review_id='durable-delete-review'").first()).toEqual({purpose:'DELETE',attempts:1});
    expect(await recoverPendingReviewerPhotoCleanup(db,env.REVIEW_PHOTOS,{now:'2026-08-13T02:00:00.000Z'})).toEqual({deleted:1,pending:0,failed:0});
    expect(await env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey('durable-delete-review','durable-delete-photo'))).toBeNull();
    expect(await env.DB.prepare("SELECT photo_count AS photoCount FROM reviewer_visit_reviews WHERE id='durable-delete-review'").first()).toEqual({photoCount:0});
    expect(await env.DB.prepare("SELECT review_id FROM reviewer_photo_cleanup_jobs WHERE review_id='durable-delete-review'").first()).toBeNull();
  });

  it("cleans unreferenced ORPHAN keys without deleting a pending review's committed photo", async () => {
    const db=createDb(env.DB);
    await seedStoredVisit(db,env.REVIEW_PHOTOS,{...reviewInput('orphan-review'),photos:[photo('committed-photo')]});
    await env.DB.prepare("UPDATE reviewer_visit_reviews SET status='PENDING' WHERE id='orphan-review'").run();
    const committedKey=getReviewerPhotoObjectKey('orphan-review','committed-photo');
    const orphanKey=getReviewerPhotoObjectKey('orphan-review','orphan-photo');
    await env.REVIEW_PHOTOS.put(orphanKey,new Uint8Array([1,2]));
    await env.DB.prepare("INSERT INTO reviewer_photo_cleanup_jobs(review_id,purpose,object_keys_json,next_attempt_at,created_at,updated_at) VALUES(?,'ORPHAN',?,?,?,?)")
      .bind('orphan-review',JSON.stringify([committedKey,orphanKey]),now,now,now).run();
    expect(await recoverPendingReviewerPhotoCleanup(db,env.REVIEW_PHOTOS,{now})).toEqual({deleted:1,pending:0,failed:0});
    expect(await env.REVIEW_PHOTOS.head(orphanKey)).toBeNull();
    expect(await env.REVIEW_PHOTOS.head(committedKey)).toBeTruthy();
    expect(await env.DB.prepare("SELECT id FROM reviewer_visit_photos WHERE id='committed-photo'").first()).toBeTruthy();
  });

  it("hides a withdrawn account before R2 deletion and retains a retry plan after failure", async () => {
    const db=createDb(env.DB);
    await seedStoredVisit(db,env.REVIEW_PHOTOS,{...reviewInput('withdrawal-review'),photos:[photo('withdrawal-photo')]});
    const failingStore={delete:async()=>{throw new Error('R2_UNAVAILABLE');}};
    await expect(withdrawAccount(db,{userId:reviewerUserId,now:new Date(now),bucket:failingStore})).resolves.toEqual({userId:reviewerUserId});
    expect(await getReviewerPhotoPreview(db,{photoId:'withdrawal-photo',actorUserId:reviewerUserId})).toBeNull();
    expect(await env.DB.prepare("SELECT status FROM reviewer_profiles WHERE user_id=?").bind(reviewerUserId).first()).toEqual({status:'SUSPENDED'});
    expect(await env.DB.prepare("SELECT purpose FROM reviewer_photo_cleanup_jobs WHERE review_id='withdrawal-review'").first()).toEqual({purpose:'DELETE'});
    expect(await env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey('withdrawal-review','withdrawal-photo'))).toBeTruthy();
    expect(await recoverPendingReviewerPhotoCleanup(db,env.REVIEW_PHOTOS,{now:'2099-01-01T00:00:00.000Z'})).toEqual({deleted:1,pending:0,failed:0});
    expect(await env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey('withdrawal-review','withdrawal-photo'))).toBeNull();
  });

});
