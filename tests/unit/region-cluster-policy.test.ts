import { describe, expect, it } from "vitest";

import {
  buildRegionClusters,
  buildRegionGroups,
  extractDistrict,
  extractNeighborhood,
  getRegionClusterLevel,
} from "../../app/features/maps/region-cluster-policy";
import type { PlaceSummary } from "../../app/features/places/place.types";

function place(
  id: string,
  address: string,
  neighborhood: string,
  latitude: number,
  longitude: number,
): PlaceSummary {
  return {
    id,
    slug: id,
    name: `장소 ${id}`,
    address,
    neighborhood,
    latitude,
    longitude,
    heroImageUrl: null,
    primaryCategory: { slug: "korean", name: "한식", emoji: "🍚" },
    positive: 0,
    negative: 0,
  };
}

describe("region cluster policy", () => {
  it("selects the administrative level from the map zoom", () => {
    expect(getRegionClusterLevel(12)).toBe("DISTRICT");
    expect(getRegionClusterLevel(13)).toBe("NEIGHBORHOOD");
    expect(getRegionClusterLevel(14)).toBe("NEIGHBORHOOD");
    expect(getRegionClusterLevel(15)).toBe("PLACE");
  });

  it("extracts Gwangju districts and Jeonnam cities or counties", () => {
    expect(extractDistrict("광주광역시 북구 용봉로 1")).toBe("북구");
    expect(extractDistrict("전라남도 담양군 담양읍 중앙로 1")).toBe("담양군");
    expect(extractDistrict("전남 여수시 여서1로 25 (여서동)")).toBe("여수시");
  });

  it("prefers stored neighborhoods and falls back to legal address tokens", () => {
    expect(
      extractNeighborhood(place("a", "광주광역시 서구 상무대로 1", "상무지구", 35.1, 126.8)),
    ).toBe("상무지구");
    expect(
      extractNeighborhood(place("b", "전남 여수시 여서1로 25 (여서동)", "", 34.7, 127.7)),
    ).toBe("여서동");
    expect(
      extractNeighborhood(place("c", "전라남도 담양군 담양읍 중앙로 1", "", 35.3, 126.9)),
    ).toBe("담양읍");
  });

  it("aggregates district places with stable ids, centers, bounds, and counts", () => {
    const places = [
      place("a", "광주광역시 북구 용봉로 1", "용봉동", 35.1, 126.8),
      place("b", "광주광역시 북구 동문대로 2", "두암동", 35.3, 127),
      place("c", "전라남도 담양군 담양읍 중앙로 1", "담양읍", 35.4, 126.9),
    ];

    const clusters = buildRegionClusters(places, 12);

    expect(clusters).toHaveLength(2);
    expect(clusters.find((cluster) => cluster.id === "DISTRICT:북구")).toMatchObject({
      id: "DISTRICT:북구",
      level: "DISTRICT",
      label: "북구",
      count: 2,
      latitude: 35.2,
      longitude: 126.9,
      bounds: [126.8, 35.1, 127, 35.3],
      placeIds: ["a", "b"],
      fallback: false,
    });
    expect(clusters.find((cluster) => cluster.id === "DISTRICT:담양군")).toMatchObject({
      id: "DISTRICT:담양군",
      count: 1,
    });
  });

  it("keeps same-name neighborhoods separate across districts", () => {
    const clusters = buildRegionClusters(
      [
        place("a", "광주광역시 북구 중앙동 1", "중앙동", 35.1, 126.8),
        place("b", "전라남도 목포시 중앙동 2", "중앙동", 34.8, 126.4),
      ],
      13,
    );

    expect(clusters.map((cluster) => cluster.id)).toEqual([
      "NEIGHBORHOOD:북구:중앙동",
      "NEIGHBORHOOD:목포시:중앙동",
    ]);
  });

  it("uses honest coordinate fallback labels when the address is incomplete", () => {
    const clusters = buildRegionClusters(
      [
        place("a", "주소 미상", "", 35.1501, 126.8501),
        place("b", "", "", 35.1502, 126.8502),
      ],
      12,
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ label: "주변 2곳", count: 2, fallback: true });
  });

  it("returns no aggregate markers at place zoom and sorted list groups otherwise", () => {
    const places = [
      place("a", "전라남도 담양군 담양읍 중앙로 1", "담양읍", 35.4, 126.9),
      place("b", "광주광역시 북구 용봉로 1", "용봉동", 35.1, 126.8),
    ];

    expect(buildRegionClusters(places, 15)).toEqual([]);
    expect(buildRegionGroups(places, 12).map((group) => group.label)).toEqual(["담양군", "북구"]);
    expect(buildRegionGroups(places, 15)).toEqual([]);
  });
});
