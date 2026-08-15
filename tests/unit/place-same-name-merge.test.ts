import { describe, expect, it } from "vitest";

import { buildSafeSameNameMergeGroups } from "../../app/features/places/place-same-name-merge.server";

describe("safe same-name place merge groups", () => {
  it("groups only same-name rows at the same address and picks one canonical target", () => {
    const groups = buildSafeSameNameMergeGroups([
      { id: "older", name: "담소헌", address: "광주 동구 동명로 10", latitude: 35.15, longitude: 126.92, status: "HIDDEN", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "newer", name: "담소헌", address: "광주동구 동명로 10", latitude: 35.1501, longitude: 126.9201, status: "HIDDEN", createdAt: "2026-02-01T00:00:00.000Z" },
      { id: "other-branch", name: "담소헌", address: "광주 서구 상무대로 20", latitude: 35.16, longitude: 126.93, status: "HIDDEN", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({ label: "담소헌", targetPlaceId: "older", sourcePlaceIds: ["newer"], count: 2 }),
    ]);
  });

  it("allows a coordinate match within 100m when addresses differ in formatting", () => {
    const groups = buildSafeSameNameMergeGroups([
      { id: "a", name: "동네식당", address: "광주 동구 충장로 10", latitude: 35.146, longitude: 126.919, status: "HIDDEN", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", name: "동네식당", address: "광주광역시 동구 충장로10 1층", latitude: 35.1463, longitude: 126.9193, status: "HIDDEN", createdAt: "2026-02-01T00:00:00.000Z" },
    ]);

    expect(groups[0]).toMatchObject({ targetPlaceId: "a", sourcePlaceIds: ["b"] });
  });

  it("never proposes a merge for national, regional, or local franchises", () => {
    const groups = buildSafeSameNameMergeGroups([
      { id: "a", name: "파리바게뜨 동명점", address: "광주 동구 동명로 10", latitude: 35.15, longitude: 126.92, status: "HIDDEN", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", name: "파리 바게뜨 동명점", address: "광주 동구 동명로10", latitude: 35.1501, longitude: 126.9201, status: "HIDDEN", createdAt: "2026-02-01T00:00:00.000Z" },
    ]);

    expect(groups).toEqual([]);
  });
});
