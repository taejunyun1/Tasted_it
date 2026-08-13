import { describe, expect, it } from "vitest";

import {
  MAX_REVIEWER_PHOTO_BYTES,
  MAX_REVIEWER_PHOTO_TOTAL_BYTES,
  ReviewerPhotoValidationError,
  parseReviewerPhotoFiles,
} from "../../app/features/ratings/reviewer-photo";

function jpegBytes(extraBytes = 0) {
  return new Uint8Array([0xff, 0xd8, ...new Uint8Array(extraBytes), 0xff, 0xd9]);
}

function photo(bytes = jpegBytes(), type = "image/jpeg", name = "review.jpg") {
  return new File([bytes], name, { type });
}

function formWithPhotos(files: File[]) {
  const form = new FormData();
  files.forEach((file) => form.append("photos", file));
  return form;
}

async function expectCode(form: FormData, code: string) {
  await expect(parseReviewerPhotoFiles(form)).rejects.toMatchObject<Partial<ReviewerPhotoValidationError>>({ code });
}

describe("parseReviewerPhotoFiles", () => {
  it("accepts zero through five valid JPEG files in selection order", async () => {
    await expect(parseReviewerPhotoFiles(formWithPhotos([]))).resolves.toEqual([]);

    const parsed = await parseReviewerPhotoFiles(formWithPhotos([
      photo(jpegBytes(), "image/jpeg", "first.jpg"),
      photo(jpegBytes(), "image/jpeg", "second.jpg"),
      photo(jpegBytes(), "image/jpeg", "third.jpg"),
      photo(jpegBytes(), "image/jpeg", "fourth.jpg"),
      photo(jpegBytes(), "image/jpeg", "fifth.jpg"),
    ]));

    expect(parsed).toHaveLength(5);
    expect(parsed.map((item) => item.position)).toEqual([0, 1, 2, 3, 4]);
    expect(parsed.every((item) => item.contentType === "image/jpeg" && item.byteSize === 4)).toBe(true);
    expect(new Set(parsed.map((item) => item.id)).size).toBe(5);
  });

  it("rejects a sixth file before reading it", async () => {
    await expectCode(formWithPhotos(Array.from({ length: 6 }, () => photo())), "PHOTO_COUNT_EXCEEDED");
  });

  it("rejects non-JPEG content and MIME spoofing", async () => {
    await expectCode(formWithPhotos([photo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png")]), "PHOTO_FORMAT_INVALID");
    await expectCode(formWithPhotos([photo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/jpeg")]), "PHOTO_FORMAT_INVALID");
  });

  it("rejects zero byte, individual size, and total size violations", async () => {
    await expectCode(formWithPhotos([photo(new Uint8Array())]), "PHOTO_EMPTY");
    await expectCode(formWithPhotos([photo(jpegBytes(MAX_REVIEWER_PHOTO_BYTES))]), "PHOTO_FILE_TOO_LARGE");

    const oversizedTotal = Array.from(
      { length: 5 },
      () => photo(jpegBytes(Math.ceil(MAX_REVIEWER_PHOTO_TOTAL_BYTES / 5))),
    );
    await expectCode(formWithPhotos(oversizedTotal), "PHOTO_TOTAL_TOO_LARGE");
  });

  it("rejects a file attached under an unknown multipart field", async () => {
    const form = formWithPhotos([photo()]);
    form.append("photo", photo());
    await expectCode(form, "PHOTO_FIELD_INVALID");
  });
});
