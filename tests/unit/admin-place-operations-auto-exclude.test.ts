import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("place review confident advance button action", () => {
  it("wires the evidence-only advance service and never publishes or calls NAVER on that path", () => {
    const route = readFileSync("app/routes/admin-place-operations.tsx", "utf8");
    const start = route.indexOf('intent === "advance-confident-review-items"');
    const publishAt = route.indexOf('intent === "publish-review-items"');
    const naverAt = route.indexOf('intent === "verify-review-items-with-naver"');

    expect(start).toBeGreaterThan(-1);
    expect(route).toContain("advanceConfidentReviewWorkItems");
    expect(publishAt).toBeGreaterThan(start);
    expect(naverAt).toBeGreaterThan(-1);
    expect(naverAt).toBeLessThan(start);
    expect(route.slice(start, publishAt)).not.toContain("publishReviewedPlaces");
    expect(route.slice(start, publishAt)).not.toContain("verifyReviewItemsWithNaver");
    expect(route.slice(start, publishAt)).not.toContain("createNaverLocalSearchAdapter");
  });
});

describe("place review automatic non-food exclusion action", () => {
  it("uses the automatic exclusion service only for source review", () => {
    const route = readFileSync("app/routes/admin-place-operations.tsx", "utf8");

    expect(route).toContain('intent === "auto-exclude-non-food-review-items"');
    expect(route).toContain("autoExcludeNonFoodReviewItems");
    expect(route).toContain("checkReviewRequest");
    expect(route).toMatch(/form\s*\.getAll\("autoWorkItem"\)/);
  });

  it("returns automatic-exclusion failures as an actionable response instead of escaping the route", () => {
    const route = readFileSync("app/routes/admin-place-operations.tsx", "utf8");

    expect(route).toContain("reviewErrorMessage");
    expect(route).toContain("reviewCaughtError");
    expect(route).toContain("autoExcludeNonFoodReviewItems");
    expect(route).toContain("status: 400");
  });
});
