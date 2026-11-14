import { describe, expect, it } from "vitest";
import { supplementalPhotoKey, tempPhotoSupplementEntrySchema } from "../../app/features/temp-catalog/temp-photo-supplement";

const entry = { sourceId: "temp100-024", name: "합성 음식점", address: "광주 합성로 24", sourcePageUrl: "https://m.search.naver.com/search.naver?query=synthetic", imageUrl: "https://ldb-phinf.pstatic.net/example.jpg", sha256: "a".repeat(64), contentType: "image/jpeg", checkedAt: "2026-11-14T00:00:00Z", rightsStatus: "UNVERIFIED", attribution: "네이버 공개 사진" };
describe("TEMP photo supplement boundary", () => {
  it("accepts truthful NAVER provenance and rejects foreign/proxy hosts and invented licenses", () => {
    expect(tempPhotoSupplementEntrySchema.safeParse(entry).success).toBe(true);
    expect(tempPhotoSupplementEntrySchema.safeParse({ ...entry, sourcePageUrl: "https://m.blog.naver.com/example/1", imageUrl: "https://search.pstatic.net/common/?src=http%3A%2F%2Fblogfiles.naver.net%2Fexample.jpg" }).success).toBe(true);
    expect(tempPhotoSupplementEntrySchema.safeParse({ ...entry, imageUrl: "https://mblogthumb-phinf.pstatic.net/example.jpg?type=w800" }).success).toBe(true);
    expect(tempPhotoSupplementEntrySchema.safeParse({ ...entry, sourcePageUrl: "https://m.search.naver.com.attacker.test/" }).success).toBe(false);
    expect(tempPhotoSupplementEntrySchema.safeParse({ ...entry, imageUrl: "https://search.pstatic.net/common/?src=https%3A%2F%2Fattacker.test%2Fx.jpg" }).success).toBe(false);
    expect(tempPhotoSupplementEntrySchema.safeParse({ ...entry, imageUrl: "https://search.pstatic.net/common/?src=http%3A%2F%2Fblogfiles.naver.net.attacker.test%2Fx.jpg" }).success).toBe(false);
    expect(tempPhotoSupplementEntrySchema.safeParse({ ...entry, imageUrl: "http://ldb-phinf.pstatic.net/example.jpg" }).success).toBe(false);
    expect(tempPhotoSupplementEntrySchema.safeParse({ ...entry, rightsStatus: "PERMITTED", licenseType: "KOGL-1" }).success).toBe(false);
  });
  it("derives only the isolated supplemental object prefix", () => {
    const parsed = tempPhotoSupplementEntrySchema.parse(entry);
    expect(supplementalPhotoKey("temp100-652f4d261db7795b", parsed)).toBe(`temp100-naver/temp100-652f4d261db7795b/temp100-024-${entry.sha256}.jpg`);
    expect(() => supplementalPhotoKey("../reviewer", parsed)).toThrow("TEMP_PHOTO_BATCH_INVALID");
  });
});
