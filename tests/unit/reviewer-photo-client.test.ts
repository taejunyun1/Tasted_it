import { describe, expect, it, vi } from "vitest";

import {
  ReviewerPhotoPreparationError,
  MAX_REVIEWER_SOURCE_PHOTO_BYTES,
  prepareReviewerPhotoFiles,
  releaseReviewerPhotoPreviews,
  reviewerPhotoErrorMessage,
  type ReviewerPhotoPreparationDependencies,
} from "../../app/features/ratings/reviewer-photo.client";

function jpegBytes() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
}

function photoDependencies(outputBytes = jpegBytes()): ReviewerPhotoPreparationDependencies {
  return {
    createImageBitmap: vi.fn(async () => ({ width: 4000, height: 2000, close: vi.fn() })),
    createCanvas: vi.fn(() => ({
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback) => callback(new Blob([outputBytes], { type: "image/jpeg" })),
    })),
  };
}

describe("prepareReviewerPhotoFiles", () => {
  it("re-encodes selected images to a bounded JPEG without source metadata", async () => {
    const result = await prepareReviewerPhotoFiles([
      new File([new Uint8Array([1, 2, 3, 4])], "camera-source.png", { type: "image/png" }),
    ], photoDependencies());

    expect(result).toHaveLength(1);
    expect(result[0].file.name).toBe("review-photo-1.jpg");
    expect(result[0].file.type).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await result[0].file.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it("rejects an undecodable source and bounds photo count", async () => {
    await expect(prepareReviewerPhotoFiles([new File(["not-an-image"], "bad.heic", { type: "image/heic" })], {
      ...photoDependencies(),
      createImageBitmap: async () => { throw new Error("DECODE_FAILED"); },
    })).rejects.toMatchObject<Partial<ReviewerPhotoPreparationError>>({ code: "PHOTO_FORMAT_INVALID" });

    await expect(prepareReviewerPhotoFiles(Array.from({ length: 6 }, () => new File([jpegBytes()], "one.jpg", { type: "image/jpeg" })), photoDependencies()))
      .rejects.toMatchObject<Partial<ReviewerPhotoPreparationError>>({ code: "PHOTO_COUNT_EXCEEDED" });
  });

  it("rejects an oversized source before browser image decoding", async () => {
    const source = new File([jpegBytes()], "large-camera.jpg", { type: "image/jpeg" });
    Object.defineProperty(source, "size", { value: MAX_REVIEWER_SOURCE_PHOTO_BYTES + 1 });
    const dependencies = photoDependencies();

    await expect(prepareReviewerPhotoFiles([source], dependencies))
      .rejects.toMatchObject<Partial<ReviewerPhotoPreparationError>>({ code: "PHOTO_SOURCE_TOO_LARGE" });
    expect(dependencies.createImageBitmap).not.toHaveBeenCalled();
  });

  it("asks the browser decoder to resize source images before drawing a preview", async () => {
    const dependencies = photoDependencies();
    await prepareReviewerPhotoFiles([new File([jpegBytes()], "camera.jpg", { type: "image/jpeg" })], dependencies);

    expect(dependencies.createImageBitmap).toHaveBeenCalledWith(expect.any(File), {
      resizeWidth: 2000,
      resizeQuality: "high",
    });
  });

  it("preserves a portrait source ratio while bounding the final canvas", async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback) => callback(new Blob([jpegBytes()], { type: "image/jpeg" })),
    };
    await prepareReviewerPhotoFiles([new File([jpegBytes()], "portrait.jpg", { type: "image/jpeg" })], {
      createImageBitmap: async () => ({ width: 1500, height: 3000, close: vi.fn() }),
      createCanvas: () => canvas,
    });

    expect(canvas).toMatchObject({ width: 1000, height: 2000 });
  });

  it("maps safe photo errors to actionable Korean copy", () => {
    expect(reviewerPhotoErrorMessage("PHOTO_FORMAT_INVALID")).toBe("이 사진 형식은 지원하지 않아요. JPEG·PNG·WebP로 다시 선택해 주세요.");
    expect(reviewerPhotoErrorMessage("PHOTO_STORAGE_FAILED")).toBe("사진 업로드에 실패했어요. 다시 시도해 주세요.");
  });

  it("releases only the preview URLs that are discarded", () => {
    const revoke = vi.fn();
    releaseReviewerPhotoPreviews([{ previewUrl: "blob:discarded" }], revoke);

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:discarded");
  });
});
