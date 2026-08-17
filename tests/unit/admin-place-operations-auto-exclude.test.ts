import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
