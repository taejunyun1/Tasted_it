import { describe, expect, it } from "vitest";
import { allowsCourseCandidate, timeFitScore } from "../../app/features/courses/course-context-v2";

describe("course context v2", () => {
  it("rejects known-closed places while penalizing unknown hours", () => {
    expect(allowsCourseCandidate({ primaryCategorySlug: "grill", secondaryCategorySlugs: [], traits: [], availability: "CLOSED" })).toBe(false);
    expect(timeFitScore("OPEN", "dinner", { auto: false })).toBe(1);
    expect(timeFitScore("UNKNOWN", "dinner", { auto: false })).toBe(0.45);
    expect(timeFitScore("UNKNOWN", "dinner", { auto: true })).toBeCloseTo(0.36);
  });
});
