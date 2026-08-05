import { describe, expect, it } from "vitest";

import { classifyPlaceDuplicate, normalizePlaceIdentity } from "../../app/features/places/place-duplicate-policy";

describe("place duplicate policy", () => {
  it("normalizes spacing, punctuation, phone, and address", () => {
    expect(normalizePlaceIdentity({ name: "  카페, 봄! ", address: "광주 동구  동명로 1", phone: "062-123-4567" }))
      .toEqual({ name: "카페봄", address: "광주동구동명로1", phone: "0621234567" });
  });

  it("uses exact source id before phone and geographic signals", () => {
    expect(classifyPlaceDuplicate({ sourceManagementNo: "A-1", name: "완전 다른 곳", address: "다른 주소", latitude: 35, longitude: 126 }, { sourceManagementNo: "A-1", name: "기존", address: "광주", latitude: 34, longitude: 127 })).toMatchObject({ level: "EXACT" });
  });

  it("classifies same phone within 100m as high and similar name within 100m as medium", () => {
    const existing = { name: "동명 라멘", address: "광주 동구 동명동", phone: "062-111-2222", latitude: 35.149, longitude: 126.923 };
    expect(classifyPlaceDuplicate({ ...existing, name: "다른 상호", latitude: 35.1492 }, existing)).toMatchObject({ level: "HIGH" });
    expect(classifyPlaceDuplicate({ ...existing, phone: null, name: "동명라멘 본점", latitude: 35.1492 }, existing)).toMatchObject({ level: "MEDIUM" });
    expect(classifyPlaceDuplicate({ ...existing, phone: null, name: "동명라멘 본점", latitude: 35.16 }, existing)).toEqual({ level: "NONE", distanceMeters: expect.any(Number), reasons: [] });
  });
});
