import type { ValidatedReviewerPhoto } from "./reviewer-photo";

export type PhotoObjectStore = {
  put(
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: "image/jpeg" } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
};

export type StoredReviewerPhoto = Omit<ValidatedReviewerPhoto, "bytes"> & {
  objectKey: string;
};

export type ReviewerPhotoStorageCode = "PHOTO_STORAGE_FAILED" | "PHOTO_CLEANUP_FAILED";

export class ReviewerPhotoStorageError extends Error {
  constructor(readonly code: ReviewerPhotoStorageCode) {
    super(code);
  }
}

function assertKeySegment(value: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ReviewerPhotoStorageError("PHOTO_STORAGE_FAILED");
}

export function getReviewerPhotoObjectKey(reviewId: string, photoId: string) {
  assertKeySegment(reviewId);
  assertKeySegment(photoId);
  return `reviews/${reviewId}/${photoId}.jpg`;
}

export async function deleteReviewerPhotoObjects(bucket: Pick<PhotoObjectStore, "delete">, keys: string[]): Promise<void> {
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length === 0) return;
  try {
    await bucket.delete(uniqueKeys);
  } catch {
    throw new ReviewerPhotoStorageError("PHOTO_CLEANUP_FAILED");
  }
}

function assertPhotoPositions(photos: ValidatedReviewerPhoto[]) {
  const positions = new Set<number>();
  const ids = new Set<string>();
  for (const photo of photos) {
    if (!Number.isInteger(photo.position) || photo.position < 0 || photo.position > 4 || positions.has(photo.position) || ids.has(photo.id)) {
      throw new ReviewerPhotoStorageError("PHOTO_STORAGE_FAILED");
    }
    positions.add(photo.position);
    ids.add(photo.id);
  }
}

/** Validates every object-key component before a caller records cleanup work. */
export function assertReviewerPhotoStorageInput(input: { reviewId: string; photos: ValidatedReviewerPhoto[] }) {
  assertKeySegment(input.reviewId);
  assertPhotoPositions(input.photos);
  input.photos.forEach((photo) => getReviewerPhotoObjectKey(input.reviewId, photo.id));
}

export async function storeReviewerPhotos(
  bucket: PhotoObjectStore,
  input: { reviewId: string; photos: ValidatedReviewerPhoto[] },
): Promise<StoredReviewerPhoto[]> {
  assertReviewerPhotoStorageInput(input);
  const stored: StoredReviewerPhoto[] = [];
  try {
    for (const photo of input.photos) {
      const objectKey = getReviewerPhotoObjectKey(input.reviewId, photo.id);
      await bucket.put(objectKey, photo.bytes, {
        httpMetadata: { contentType: photo.contentType },
      });
      stored.push({
        id: photo.id,
        objectKey,
        contentType: photo.contentType,
        byteSize: photo.byteSize,
        position: photo.position,
      });
    }
    return stored;
  } catch (error) {
    if (error instanceof ReviewerPhotoStorageError) throw error;
    try {
      await deleteReviewerPhotoObjects(bucket, stored.map((photo) => photo.objectKey));
    } catch {
      throw new ReviewerPhotoStorageError("PHOTO_CLEANUP_FAILED");
    }
    throw new ReviewerPhotoStorageError("PHOTO_STORAGE_FAILED");
  }
}
