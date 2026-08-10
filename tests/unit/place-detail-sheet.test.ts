import { describe, expect, it } from "vitest";
import { shouldOpenPlaceDetailSheet } from "../../app/features/places/place-detail-sheet";
import {
  recommendationRequestPath,
  safePlaceDetailRequestPath,
} from "../../app/components/places/PlaceCard";

describe("shouldOpenPlaceDetailSheet", () => {
  it("intercepts an ordinary mobile click", () => {
    expect(shouldOpenPlaceDetailSheet({ mobile: true, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
  });

  it("keeps desktop and modified link navigation intact", () => {
    expect(shouldOpenPlaceDetailSheet({ mobile: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(false);
    expect(shouldOpenPlaceDetailSheet({ mobile: true, button: 0, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(false);
  });

  it("accepts only queryless direct paths or complete allowlisted recommendation paths", () => {
    const requestId = "7b3c9a17-8064-4d2e-8cf7-857dfc78b86f";
    const recommendationPath = `/places/sample-dongmyeong-ramen?sourceRail=PERSONAL&discoveryMode=EXPLORATION&recommendationRequestId=${requestId}`;

    expect(safePlaceDetailRequestPath("/places/sample-dongmyeong-ramen")).toBe("/places/sample-dongmyeong-ramen");
    expect(safePlaceDetailRequestPath(recommendationPath)).toBe(recommendationPath);
    expect(safePlaceDetailRequestPath("https://evil.example/places/sample-dongmyeong-ramen")).toBeNull();
    expect(safePlaceDetailRequestPath("//evil.example/places/sample-dongmyeong-ramen")).toBeNull();
    expect(safePlaceDetailRequestPath("/places/sample-dongmyeong-ramen?sourceRail=PERSONAL&discoveryMode=EXPLORATION")).toBeNull();
    expect(safePlaceDetailRequestPath(`/places/sample-dongmyeong-ramen?sourceRail=MAP&discoveryMode=EXPLORATION&recommendationRequestId=${requestId}`)).toBeNull();
    expect(safePlaceDetailRequestPath(`${recommendationPath}&returnTo=https%3A%2F%2Fevil.example`)).toBeNull();
    expect(safePlaceDetailRequestPath(`/places/sample%2Fescape?sourceRail=PERSONAL&discoveryMode=EXPLORATION&recommendationRequestId=${requestId}`)).toBeNull();
    expect(safePlaceDetailRequestPath("/places/ignored/../sample-dongmyeong-ramen")).toBeNull();
  });

  it("refuses to append a request id to an injected or non-recommendation path", () => {
    const requestId = "7b3c9a17-8064-4d2e-8cf7-857dfc78b86f";

    expect(() => recommendationRequestPath("https://evil.example/places/sample?sourceRail=PERSONAL&discoveryMode=EXPLORATION", requestId))
      .toThrow("RECOMMENDATION_PATH_NOT_ALLOWED");
    expect(() => recommendationRequestPath("/places/sample", requestId))
      .toThrow("RECOMMENDATION_PATH_NOT_ALLOWED");
  });
});
