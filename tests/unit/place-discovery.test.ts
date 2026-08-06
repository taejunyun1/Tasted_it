import { describe, expect, it } from "vitest";

import {
  buildDiscoverySections,
  formatRatingSummary,
} from "../../app/features/places/place-discovery";
import type { PlaceSummary } from "../../app/features/places/place.types";

function place(
  id: string,
  input: Partial<PlaceSummary> & Pick<PlaceSummary, "latitude" | "longitude">,
): PlaceSummary {
  return {
    id,
    slug: id,
    name: id,
    address: `${id} address`,
    neighborhood: `${id}동`,
    heroImageUrl: null,
    primaryCategory: { slug: "gukbap", name: "국밥", emoji: "🍲" },
    positive: 0,
    negative: 0,
    ...input,
  };
}

describe("place discovery", () => {
  it("shows progress below eight votes and the Bayesian score from eight", () => {
    expect(formatRatingSummary(place("seven", { latitude: 35, longitude: 126, positive: 6, negative: 1 }))).toBe("평가 7/8");
    expect(formatRatingSummary(place("eight", { latitude: 35, longitude: 126, positive: 6, negative: 2 }))).toBe("추천 67% · 8명 평가");
  });

  it("sorts nearby by distance and service picks by score then sample count", () => {
    const places = [
      place("far", { latitude: 35.2, longitude: 126.9, positive: 8, negative: 2 }),
      place("near", { latitude: 35.001, longitude: 126.9, positive: 7, negative: 1 }),
      place("best", { latitude: 35.3, longitude: 126.9, positive: 11, negative: 1 }),
    ];
    const result = buildDiscoverySections(places, [], { latitude: 35, longitude: 126.9 }, 2);
    expect(result.nearby.map((item) => item.id)).toEqual(["near", "far"]);
    expect(result.service.map((item) => item.id)).toEqual(["best"]);
  });

  it("uses each place only once across ordered recommendation rails", () => {
    const places = [
      place("near", { latitude: 35, longitude: 126.9, positive: 8, negative: 0 }),
      place("service", { latitude: 36, longitude: 127, positive: 10, negative: 2 }),
      place("golden", { latitude: 37, longitude: 128, positive: 0, negative: 0 }),
    ];
    const result = buildDiscoverySections(
      places,
      [
        { placeId: "near", effectiveAt: "2026-08-06T01:00:00Z" },
        { placeId: "golden", effectiveAt: "2026-08-06T02:00:00Z" },
      ],
      { latitude: 35, longitude: 126.9 },
      1,
    );
    const ids = [...result.nearby, ...result.service, ...result.golden].map((item) => item.id);
    expect(ids).toEqual(["near", "service", "golden"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
