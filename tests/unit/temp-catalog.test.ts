import { describe, expect, it } from "vitest";
import { identityKey, photoObjectKey, tempEntrySchema, verifiedCoordinates } from "../../app/features/temp-catalog/temp-catalog";
import { assertNoImageMetadata } from "../../scripts/build-temp100-public.mjs";

describe("TEMP public boundary", () => {
  it("matches normalized identity while refusing fake coordinates", () => {
    expect(identityKey({ name: "식 당", address: "광주광역시 동구 길 1" })).toBe(identityKey({ name: "식당", address: "광주 동구 길 1" }));
    expect(identityKey({ name: "식당", address: "전남광주통합특별시 여수시 길 1" })).toBe(identityKey({ name: "식당", address: "전라남도 여수시 길 1" }));
    expect(verifiedCoordinates(0, 0)).toBe(false);
    expect(verifiedCoordinates(35.1, 126.9)).toBe(true);
  });
  it("rejects unapproved external hosts, embedded ratings and arbitrary photo paths", () => {
    const entry = { sourceId: "temp100-001", name: "합성 식당", address: "광주 동구 길 1", region: "광주 동구", cuisine: "한식", summary: "합성 테스트용 독자 설명입니다.", sourceUrl: "https://tour.gwangju.go.kr/example", sourceTitle: "공식 소개", checkedAt: "2026-11-14T00:00:00Z", evaluation: { kind: "OFFICIAL_CURATION", provider: "공식 관광", sourceUrl: "https://tour.gwangju.go.kr/example" }, photo: null };
    expect(tempEntrySchema.safeParse(entry).success).toBe(true);
    expect(tempEntrySchema.safeParse({ ...entry, sourceUrl: "https://unapproved.example/photo" }).success).toBe(false);
    expect(tempEntrySchema.safeParse({ ...entry, internalScore: 5 }).success).toBe(false);
    expect(photoObjectKey("../review-photos", { ...entry, photo: { sha256: "a".repeat(64), contentType: "image/jpeg", licenseType: "KOGL-1", licenseUrl: "https://www.kogl.or.kr/info/license.do", attribution: "합성", creator: "합성", evidenceUrl: "https://www.yeosu.go.kr/example" } } as never)).toBe(null);
  });
  it("rejects private JPEG metadata before upload planning", () => {
    expect(() => assertNoImageMetadata(Buffer.from([255, 216, 255, 225, 0, 8, 69, 120, 105, 102, 0, 0]), "image/jpeg")).toThrow("TEMP_IMAGE_PRIVATE_METADATA");
    expect(() => assertNoImageMetadata(Buffer.from("not an image"), "image/jpeg")).toThrow("TEMP_IMAGE_SIGNATURE_INVALID");
  });
});
