import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  assertReviewerPhotoStorageInput,
  ReviewerPhotoStorageError,
  deleteReviewerPhotoObjects,
  getReviewerPhotoObjectKey,
  storeReviewerPhotos,
  type PhotoObjectStore,
} from "../../app/features/ratings/reviewer-photo.server";

const reviewerId = "review-123";

function storedPhoto(id: string, position = 0) {
  return {
    id,
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    contentType: "image/jpeg" as const,
    byteSize: 4,
    position,
  };
}

beforeEach(async () => {
  await env.REVIEW_PHOTOS.delete([
    getReviewerPhotoObjectKey(reviewerId, "photo-1"),
    getReviewerPhotoObjectKey(reviewerId, "photo-2"),
  ]);
});

describe("reviewer photo R2 adapter", () => {
  it("stores opaque JPEG objects without source filenames", async () => {
    const stored = await storeReviewerPhotos(env.REVIEW_PHOTOS, {
      reviewId: reviewerId,
      photos: [storedPhoto("photo-1")],
    });

    expect(stored).toEqual([expect.objectContaining({
      id: "photo-1",
      objectKey: "reviews/review-123/photo-1.jpg",
      contentType: "image/jpeg",
      byteSize: 4,
      position: 0,
    })]);
    const object = await env.REVIEW_PHOTOS.get(stored[0].objectKey);
    expect(object?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await object!.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it("removes already stored objects when a later put fails", async () => {
    const inserted: string[] = [];
    const backingStore: PhotoObjectStore = {
      put: async (key, value, options) => {
        if (key.endsWith("photo-2.jpg")) throw new Error("R2_WRITE_FAILED");
        inserted.push(key);
        await env.REVIEW_PHOTOS.put(key, value, options);
        return null;
      },
      delete: async (keys) => {
        await env.REVIEW_PHOTOS.delete(keys);
      },
    };

    await expect(storeReviewerPhotos(backingStore, {
      reviewId: reviewerId,
      photos: [storedPhoto("photo-1"), storedPhoto("photo-2", 1)],
    })).rejects.toMatchObject<Partial<ReviewerPhotoStorageError>>({ code: "PHOTO_STORAGE_FAILED" });

    expect(inserted).toEqual([getReviewerPhotoObjectKey(reviewerId, "photo-1")]);
    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewerId, "photo-1"))).resolves.toBeNull();
  });

  it("deletes exact keys idempotently", async () => {
    const key = getReviewerPhotoObjectKey(reviewerId, "photo-1");
    await env.REVIEW_PHOTOS.put(key, storedPhoto("photo-1").bytes);

    await expect(deleteReviewerPhotoObjects(env.REVIEW_PHOTOS, [key, key])).resolves.toBeUndefined();
    await expect(deleteReviewerPhotoObjects(env.REVIEW_PHOTOS, [key])).resolves.toBeUndefined();
    await expect(env.REVIEW_PHOTOS.head(key)).resolves.toBeNull();
  });

  it("rejects duplicate storage positions before writing any object", async () => {
    await expect(storeReviewerPhotos(env.REVIEW_PHOTOS, {
      reviewId: reviewerId,
      photos: [storedPhoto("photo-1", 0), storedPhoto("photo-2", 0)],
    })).rejects.toMatchObject<Partial<ReviewerPhotoStorageError>>({ code: "PHOTO_STORAGE_FAILED" });

    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewerId, "photo-1"))).resolves.toBeNull();
  });

  it("rejects duplicate photo ids before writing an ambiguous cleanup key", async () => {
    await expect(storeReviewerPhotos(env.REVIEW_PHOTOS, {
      reviewId: reviewerId,
      photos: [storedPhoto("photo-1", 0), storedPhoto("photo-1", 1)],
    })).rejects.toMatchObject<Partial<ReviewerPhotoStorageError>>({ code: "PHOTO_STORAGE_FAILED" });

    await expect(env.REVIEW_PHOTOS.head(getReviewerPhotoObjectKey(reviewerId, "photo-1"))).resolves.toBeNull();
  });

  it("rejects duplicate ids before a publisher can create a cleanup job", () => {
    expect(() => assertReviewerPhotoStorageInput({
      reviewId: reviewerId,
      photos: [storedPhoto("photo-1", 0), storedPhoto("photo-1", 1)],
    })).toThrow("PHOTO_STORAGE_FAILED");
  });
});
