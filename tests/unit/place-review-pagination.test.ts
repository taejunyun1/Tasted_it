import { describe, expect, it } from "vitest";
import { buildPlaceReviewNextStepHref, buildPlaceReviewPageHref, parsePlaceReviewQuery } from "../../app/features/places/place-review-pagination";

describe("place review pagination", () => {
  it("bounds page and page size", () => {
    expect(parsePlaceReviewQuery(new URL("https://example.test/?step=2&page=-3&pageSize=500"))).toMatchObject({
      step: 2,
      page: 1,
      pageSize: 25,
      status: "pending",
    });
  });

  it("keeps supported filters only", () => {
    expect(parsePlaceReviewQuery(new URL("https://example.test/?step=4&status=hold&region=GWANGJU&q=%EA%B5%AD%EB%B0%A5"))).toMatchObject({
      step: 4,
      status: "hold",
      region: "GWANGJU",
      query: "국밥",
    });
  });

  it("preserves filters when it builds a target page link", () => {
    expect(buildPlaceReviewPageHref({
      step: 3,
      page: 1,
      pageSize: 50,
      status: "attention",
      region: "JEONNAM",
      query: "김밥",
    }, 2)).toBe("?flow=review&step=3&page=2&pageSize=50&status=attention&region=JEONNAM&q=%EA%B9%80%EB%B0%A5");
  });

  it("moves NAVER verification to category confirmation without retaining a stale page", () => {
    expect(buildPlaceReviewNextStepHref({
      step: 2,
      page: 4,
      pageSize: 50,
      status: "pending",
      region: "GWANGJU",
      query: "국밥",
    })).toBe("?flow=review&step=3&page=1&pageSize=50&status=pending&region=GWANGJU&q=%EA%B5%AD%EB%B0%A5");
  });
});
