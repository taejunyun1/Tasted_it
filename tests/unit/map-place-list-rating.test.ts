import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MapPlaceList } from "../../app/components/map/MapPlaceList";
import { PUBLIC_RATING_FALLBACK_COPY } from "../../app/features/places/place-discovery";
import type { PlaceSummary } from "../../app/features/places/place.types";

const snapshotPlace: PlaceSummary = {
  id: "map-list-snapshot",
  slug: "map-list-snapshot",
  name: "스냅샷 국밥",
  address: "광주광역시",
  neighborhood: "동명동",
  latitude: 35.15,
  longitude: 126.92,
  heroImageUrl: null,
  primaryCategory: { slug: "gukbap", name: "국밥", emoji: "🍲" },
  positive: 1,
  negative: 0,
  ratingScore: 41,
  ratingSampleCount: 8,
};

function renderList(places: PlaceSummary[]) {
  return renderToStaticMarkup(createElement(MapPlaceList, {
    places,
    groups: [],
    level: "PLACE",
    onSelect: vi.fn(),
    onGroupSelect: vi.fn(),
  }));
}

describe("MapPlaceList public rating", () => {
  it("prints the snapshot summary instead of a live currentVotes Bayesian score", () => {
    const html = renderList([snapshotPlace]);
    expect(html).toContain("추천 41% · 8명 평가");
    expect(html).not.toContain("평가 대기");
    expect(html).not.toContain(">75%<");
    expect(html).not.toContain(">67%<");
  });

  it("prints fallback copy when no snapshot is attached", () => {
    const html = renderList([{ ...snapshotPlace, ratingScore: undefined, ratingSampleCount: undefined }]);
    expect(html).toContain(PUBLIC_RATING_FALLBACK_COPY);
    expect(html).not.toContain("평가 대기");
  });

  it("does not call calculateRating on the explorer list", () => {
    const source = readFileSync("app/components/map/MapPlaceList.tsx", "utf8");
    expect(source).toContain("formatPublicRatingSummary");
    expect(source).not.toContain("calculateRating");
  });
});
