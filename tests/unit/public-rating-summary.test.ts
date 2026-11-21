import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { MapPlaceDetail } from "../../app/components/map/MapPlaceDetail";
import { PlaceCard } from "../../app/components/places/PlaceCard";
import { formatPublicRatingSummary } from "../../app/features/places/place-discovery";
import type { PlaceSummary } from "../../app/features/places/place.types";
import { publicRatingFromPlace, ratingCalculationLabel, reviewerWeightExplanation } from "../../app/features/ratings/public-rating";

const place: PlaceSummary = { id: "rating-view", slug: "rating-view", name: "합성 장소", address: "합성 주소", neighborhood: "합성", latitude: 35, longitude: 126, heroImageUrl: null, primaryCategory: { slug: "ramen", name: "라멘", emoji: "" }, positive: 99, negative: 1, ratingScore: 83, ratingSampleCount: 8, userRatingScore: 83, userRatingSampleCount: 8, reviewerRatingSampleCount: 0, ratingIsStale: false, ratingComputedAt: "2026-11-18T02:00:00.000Z" };

describe("public rating display", () => {
  it.each([
    [place, "추천 83% · 8명 평가", "공개 결과 계산"],
    [{ ...place, ratingScore: null, ratingSampleCount: 7, ratingIsStale: true, ratingComputedAt: null }, "표본 수집 중 · 7/8", "미계산"],
    [{ ...place, ratingScore: 99, ratingSampleCount: 12, ratingIsStale: true }, "추천 지표 계산 대기 · 12명 평가", "이전 계산"],
  ])("renders the same authoritative summary in the card and map, including pending inputs", (input, summary, calculation) => {
    expect(formatPublicRatingSummary(input)).toBe(summary);
    for (const component of [
      createElement(PlaceCard, { place: input }),
      createElement(MapPlaceDetail, { place: input, onBack() {}, onOpenDetail() {} }),
    ]) {
      const html = renderToStaticMarkup(createElement(MemoryRouter, null, component));
      expect(html).toContain(summary);
      expect(html).toContain(calculation);
      if (input.ratingIsStale) expect(html).not.toContain("99%");
    }
  });

  it("never derives a current score or calculation time from live counts", () => {
    const rating = publicRatingFromPlace({ positive: 11, negative: 1 });
    expect(rating).toMatchObject({ overallScore: null, overallSampleCount: 12, computedAt: null, isStale: true });
    expect(ratingCalculationLabel({ ratingComputedAt: "invalid" })).toBe("미계산");
    expect(ratingCalculationLabel(place)).toContain("2026. 11. 18.");
  });

  it("explains the reviewer cap only in the presence of general reactions", () => {
    expect(reviewerWeightExplanation(0)).toContain("함께 있을 때만");
    expect(reviewerWeightExplanation(8)).toContain("함께 있어");
  });
});
