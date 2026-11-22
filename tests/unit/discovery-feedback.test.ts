import { describe, expect, it } from "vitest";
import { courseLocationMessage, resolveCourseDeviceLocation } from "../../app/features/courses/course-location-feedback";
import { readPlaceSearchContext } from "../../app/features/places/place-search-feedback";

describe("course location feedback", () => {
  it("accepts in-market coordinates but keeps out-of-market or invalid coordinates out of the search", () => {
    expect(resolveCourseDeviceLocation({ latitude: 35.1595, longitude: 126.8526 })).toEqual({ latitude: 35.1595, longitude: 126.8526 });
    expect(resolveCourseDeviceLocation({ latitude: 37.5, longitude: 127 })).toBeNull();
    expect(resolveCourseDeviceLocation({ latitude: 35.9891, longitude: 126.7102 })).toBeNull();
    expect(resolveCourseDeviceLocation({ latitude: Number.NaN, longitude: 126.8 })).toBeNull();
  });

  it("distinguishes permission, availability, timeout and browser support without claiming a new location", () => {
    const messages = (["DENIED", "UNAVAILABLE", "TIMEOUT", "UNSUPPORTED", "OUTSIDE"] as const).map((state) => courseLocationMessage(state, false));
    expect(new Set(messages).size).toBe(5);
    expect(messages.every((message) => message.includes("광주시청"))).toBe(true);
    expect(courseLocationMessage("DENIED", true)).toContain("선택한 위치");
    expect(courseLocationMessage("PENDING", false)).toContain("확인하고");
  });
});

describe("place search error recovery", () => {
  it("retains query, category, geographic scope and repeated taste filters", () => {
    const result = readPlaceSearchContext("?q=%EB%9D%BC%EB%A9%98&category=ramen&bbox=126.8,35.1,127,35.25&badge=food-ramen&badge=style-market&temp=1&place=%2Fplaces%2Fsecret");
    expect(result).toMatchObject({ query: "라멘", categorySlug: "ramen", bbox: [126.8, 35.1, 127, 35.25], badges: ["food-ramen", "style-market"], tempOnly: true });
    expect(result).not.toHaveProperty("place");
  });
});
