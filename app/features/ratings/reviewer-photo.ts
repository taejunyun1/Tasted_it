export const MAX_REVIEWER_PHOTO_COUNT = 5;
export const MAX_REVIEWER_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_REVIEWER_PHOTO_TOTAL_BYTES = 25 * 1024 * 1024;

export type ReviewerPhotoValidationCode =
  | "PHOTO_COUNT_EXCEEDED"
  | "PHOTO_EMPTY"
  | "PHOTO_FIELD_INVALID"
  | "PHOTO_FILE_TOO_LARGE"
  | "PHOTO_FORMAT_INVALID"
  | "PHOTO_TOTAL_TOO_LARGE";

export class ReviewerPhotoValidationError extends Error {
  constructor(readonly code: ReviewerPhotoValidationCode) {
    super(code);
  }
}

export type ValidatedReviewerPhoto = {
  id: string;
  bytes: Uint8Array;
  contentType: "image/jpeg";
  byteSize: number;
  position: number;
};

function isFile(value: FormDataEntryValue): value is File {
  return typeof value !== "string" && typeof value.arrayBuffer === "function";
}

function hasJpegMagicBytes(bytes: Uint8Array) {
  return bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes.at(-2) === 0xff
    && bytes.at(-1) === 0xd9;
}

export async function parseReviewerPhotoFiles(form: FormData): Promise<ValidatedReviewerPhoto[]> {
  const fileEntries = Array.from(form.entries()).filter(
    (entry): entry is [string, File] => isFile(entry[1]),
  );
  if (fileEntries.some(([field]) => field !== "photos")) {
    throw new ReviewerPhotoValidationError("PHOTO_FIELD_INVALID");
  }

  const files = fileEntries.map(([, file]) => file);
  if (files.length > MAX_REVIEWER_PHOTO_COUNT) {
    throw new ReviewerPhotoValidationError("PHOTO_COUNT_EXCEEDED");
  }

  let totalBytes = 0;
  for (const file of files) {
    if (file.size === 0) throw new ReviewerPhotoValidationError("PHOTO_EMPTY");
    if (file.size > MAX_REVIEWER_PHOTO_BYTES) {
      throw new ReviewerPhotoValidationError("PHOTO_FILE_TOO_LARGE");
    }
    totalBytes += file.size;
    if (totalBytes > MAX_REVIEWER_PHOTO_TOTAL_BYTES) {
      throw new ReviewerPhotoValidationError("PHOTO_TOTAL_TOO_LARGE");
    }
    if (file.type.toLowerCase() !== "image/jpeg") {
      throw new ReviewerPhotoValidationError("PHOTO_FORMAT_INVALID");
    }
  }

  return Promise.all(files.map(async (file, position) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasJpegMagicBytes(bytes)) {
      throw new ReviewerPhotoValidationError("PHOTO_FORMAT_INVALID");
    }
    return {
      id: crypto.randomUUID(),
      bytes,
      contentType: "image/jpeg" as const,
      byteSize: bytes.byteLength,
      position,
    };
  }));
}
