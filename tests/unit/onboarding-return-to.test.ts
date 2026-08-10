import { describe, expect, it } from "vitest";

import { safeOnboardingReturnTo } from "../../app/features/onboarding/return-to";

describe("onboarding public returnTo allowlist", () => {
  it("canonicalizes places data requests and preserves only supported public filters", () => {
    expect(safeOnboardingReturnTo(
      "/places.data?category=ramen-detail&q=%EB%9D%BC%EB%A9%B4&bbox=126.8%2C35%2C127%2C35.3&badge=food-ramen&unknown=private&badge=style-market&_routes=routes%2Fplace-list",
    )).toBe(
      "/places?category=ramen-detail&q=%EB%9D%BC%EB%A9%B4&bbox=126.8%2C35%2C127%2C35.3&badge=food-ramen&badge=style-market",
    );
  });

  it.each([
    "/onboarding/taste",
    "/onboarding/taste?returnTo=%2Fplaces",
    "/admin",
    "/admin/candidates",
    "/auth/google",
    "/logout",
    "/courses",
    "/unknown/public-looking-path",
    "https://evil.example/places",
    "//evil.example/places",
    "/\\evil.example/places",
    "/%5Cevil.example/places",
    "/places/../places?category=ramen-detail",
    "/places/%2e%2e/places?category=ramen-detail",
    "/%2570laces.data?category=ramen-detail",
    "/places%253Fcategory%253Dramen-detail",
    "/places?category=ramen-detail#private-fragment",
  ])("falls back non-public or non-canonical returnTo %s", (returnTo) => {
    expect(safeOnboardingReturnTo(returnTo)).toBe("/places");
  });
});
