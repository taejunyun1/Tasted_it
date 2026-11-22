import { describe, expect, it } from "vitest";
import { shouldOpenPlaceDetailSheet } from "../../app/features/places/place-detail-sheet";
import {
  recommendationRequestPath,
  safePlaceDetailRequestPath,
  safePlaceDetailSearchPath,
} from "../../app/components/places/PlaceCard";

describe("shouldOpenPlaceDetailSheet", () => {
  it("intercepts an ordinary mobile click", () => {
    expect(shouldOpenPlaceDetailSheet({ mobile: true, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
  });

  it.each([
    { mobile: false }, { button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true },
  ])("keeps native link behavior for %o", (input) => {
    expect(shouldOpenPlaceDetailSheet({ mobile: true, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...input })).toBe(false);
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

describe("safePlaceDetailSearchPath", () => {
  it("accepts a map slug and preserves the list's complete recommendation proof", () => {
    const proof = "/places/sample?sourceRail=TRUSTED&discoveryMode=QUALITY&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f";
    expect(safePlaceDetailSearchPath("sample")).toBe("/places/sample");
    expect(safePlaceDetailSearchPath("국밥")).toBe(`/places/${encodeURIComponent("국밥")}`);
    expect(safePlaceDetailSearchPath(encodeURIComponent("국밥"))).toBe(`/places/${encodeURIComponent("국밥")}`);
    expect(safePlaceDetailSearchPath(proof)).toBe(proof);
  });

  it.each([null, "", "..", "../login", "sample%2Fescape", "sample%", "sample?other=1", "https://evil.example/places/sample", "//evil.example/places/sample"])("rejects invalid place input %s", (input) => {
    expect(safePlaceDetailSearchPath(input)).toBeNull();
  });
});
