import {
  MAX_REVIEWER_PHOTO_BYTES,
  MAX_REVIEWER_PHOTO_COUNT,
  MAX_REVIEWER_PHOTO_TOTAL_BYTES,
  type ReviewerPhotoValidationCode,
} from "./reviewer-photo";

/**
 * Source files are checked before decoding. This deliberately allows a little
 * more headroom than the final JPEG limit, while preventing a camera original
 * from exhausting a phone before the browser can downscale it.
 */
export const MAX_REVIEWER_SOURCE_PHOTO_BYTES = 12 * 1024 * 1024;
export const MAX_REVIEWER_SOURCE_PHOTO_TOTAL_BYTES = 36 * 1024 * 1024;
const MAX_REVIEWER_PHOTO_DIMENSION = 2000;

type ImageBitmapLike = Pick<ImageBitmap, "width" | "height" | "close">;
type ImageBitmapResizeOptions = {
  resizeWidth: number;
  resizeQuality: "high";
};
type CanvasContextLike = { drawImage(image: ImageBitmapLike, dx: number, dy: number, dw: number, dh: number): void };
type CanvasLike = {
  getContext(contextId: "2d"): CanvasContextLike | null;
  toBlob(callback: BlobCallback, type?: string, quality?: number): void;
  width: number;
  height: number;
};

export type ReviewerPhotoPreparationDependencies = {
  createImageBitmap(file: File, options: ImageBitmapResizeOptions): Promise<ImageBitmapLike>;
  createCanvas(): CanvasLike;
};

export type PreparedReviewerPhoto = { file: File; position: number };
export type ReviewerPhotoPreview = { previewUrl: string };
export type ReviewerPhotoPreparationCode = ReviewerPhotoValidationCode | "PHOTO_DECODE_FAILED" | "PHOTO_SOURCE_TOO_LARGE";

export class ReviewerPhotoPreparationError extends Error {
  constructor(readonly code: ReviewerPhotoPreparationCode) {
    super(code);
  }
}

export function reviewerPhotoErrorMessage(code: string) {
  const messages: Record<string, string> = {
    PHOTO_COUNT_EXCEEDED: "사진은 최대 5장까지 올릴 수 있어요.",
    PHOTO_EMPTY: "비어 있는 사진은 올릴 수 없어요.",
    PHOTO_FILE_TOO_LARGE: "사진 용량이 너무 커요.",
    PHOTO_SOURCE_TOO_LARGE: "원본 사진 용량이 너무 커요. 12MB 이하 사진으로 다시 선택해 주세요.",
    PHOTO_TOTAL_TOO_LARGE: "사진 전체 용량이 너무 커요.",
    PHOTO_FORMAT_INVALID: "이 사진 형식은 지원하지 않아요. JPEG·PNG·WebP로 다시 선택해 주세요.",
    PHOTO_DECODE_FAILED: "이 사진을 준비하지 못했어요. 다른 사진으로 다시 선택해 주세요.",
    PHOTO_STORAGE_FAILED: "사진 업로드에 실패했어요. 다시 시도해 주세요.",
    PHOTO_CLEANUP_FAILED: "사진 업로드를 정리하지 못했어요. 잠시 후 다시 시도해 주세요.",
    REVIEW_PHOTO_UPLOAD_DISABLED: "사진 업로드를 잠시 준비 중이에요.",
    REVIEW_SUBMISSION_INVALID: "리뷰 내용을 다시 확인해 주세요.",
  };
  return messages[code] ?? "리뷰를 발행하지 못했어요. 입력 내용을 확인해 주세요.";
}

/**
 * Browser preview URLs are intentionally short-lived: selected photos are not
 * stored until review publication. Call this only for previews that are no
 * longer rendered, or when the review flow unmounts.
 */
export function releaseReviewerPhotoPreviews(
  photos: readonly ReviewerPhotoPreview[],
  revoke: (previewUrl: string) => void = (previewUrl) => URL.revokeObjectURL(previewUrl),
) {
  photos.forEach((photo) => revoke(photo.previewUrl));
}

function defaultDependencies(): ReviewerPhotoPreparationDependencies {
  return {
    createImageBitmap: (file, options) => globalThis.createImageBitmap(file, options),
    createCanvas: () => document.createElement("canvas") as unknown as CanvasLike,
  };
}

function canvasToBlob(canvas: CanvasLike) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new ReviewerPhotoPreparationError("PHOTO_DECODE_FAILED")), "image/jpeg", 0.85);
  });
}

export async function prepareReviewerPhotoFiles(
  sourceFiles: File[],
  dependencies: ReviewerPhotoPreparationDependencies = defaultDependencies(),
): Promise<PreparedReviewerPhoto[]> {
  if (sourceFiles.length > MAX_REVIEWER_PHOTO_COUNT) {
    throw new ReviewerPhotoPreparationError("PHOTO_COUNT_EXCEEDED");
  }

  const sourceTotalBytes = sourceFiles.reduce((total, source) => total + source.size, 0);
  if (sourceFiles.some((source) => source.size === 0)) {
    throw new ReviewerPhotoPreparationError("PHOTO_EMPTY");
  }
  if (sourceFiles.some((source) => source.size > MAX_REVIEWER_SOURCE_PHOTO_BYTES) || sourceTotalBytes > MAX_REVIEWER_SOURCE_PHOTO_TOTAL_BYTES) {
    throw new ReviewerPhotoPreparationError("PHOTO_SOURCE_TOO_LARGE");
  }

  let totalBytes = 0;
  const prepared: PreparedReviewerPhoto[] = [];
  for (const [position, source] of sourceFiles.entries()) {
    let bitmap: ImageBitmapLike;
    try {
      bitmap = await dependencies.createImageBitmap(source, {
        resizeWidth: MAX_REVIEWER_PHOTO_DIMENSION,
        resizeQuality: "high",
      });
    } catch {
      throw new ReviewerPhotoPreparationError("PHOTO_FORMAT_INVALID");
    }
    try {
      const scale = Math.min(1, MAX_REVIEWER_PHOTO_DIMENSION / Math.max(bitmap.width, bitmap.height));
      const canvas = dependencies.createCanvas();
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new ReviewerPhotoPreparationError("PHOTO_DECODE_FAILED");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas);
      const file = new File([blob], `review-photo-${position + 1}.jpg`, { type: "image/jpeg" });
      if (file.size === 0) throw new ReviewerPhotoPreparationError("PHOTO_EMPTY");
      if (file.size > MAX_REVIEWER_PHOTO_BYTES) throw new ReviewerPhotoPreparationError("PHOTO_FILE_TOO_LARGE");
      totalBytes += file.size;
      if (totalBytes > MAX_REVIEWER_PHOTO_TOTAL_BYTES) throw new ReviewerPhotoPreparationError("PHOTO_TOTAL_TOO_LARGE");
      prepared.push({ file, position });
    } finally {
      bitmap.close();
    }
  }
  return prepared;
}
