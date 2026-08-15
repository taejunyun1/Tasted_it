import { describe, expect, it } from "vitest";

import { groupPlacesByNormalizedName } from "../../app/features/places/place-name-groups";

describe("place name groups", () => {
  it("groups only identical normalized names and never treats the group as a merge decision", () => {
    const groups = groupPlacesByNormalizedName([
      { id: "a", name: "파리바게뜨 동명점", address: "광주 동구 동명로 1" },
      { id: "b", name: "파리 바게뜨·동명점", address: "광주 서구 상무로 2" },
      { id: "c", name: "파리바게뜨 충장점", address: "광주 동구 충장로 3" },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({ normalizedName: "파리바게뜨동명점", placeIds: ["a", "b"], count: 2 }),
    ]);
  });
});
