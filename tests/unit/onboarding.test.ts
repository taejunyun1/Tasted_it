import { describe, expect, it } from "vitest";

import {
  onboardingProgress,
  toggleOnboardingBadge,
} from "../../app/features/onboarding/onboarding";

describe("toggleOnboardingBadge", () => {
  it("allows at most five FOOD badges", () => {
    const selected = ["food-gukbap", "food-naengmyeon", "food-tteokbokki", "food-ramen", "food-sushi"];
    expect(toggleOnboardingBadge({ selected, badgeId: "food-pasta", maximum: 5 }))
      .toEqual({ selected, limitReached: true });
  });

  it("allows deselection without hitting the limit", () => {
    expect(toggleOnboardingBadge({ selected: ["style-old-school"], badgeId: "style-old-school", maximum: 3 }))
      .toEqual({ selected: [], limitReached: false });
  });
});

describe("onboardingProgress", () => {
  it("maps every onboarding step to its one-based progress", () => {
    expect(onboardingProgress("LOCATION")).toBe(1);
    expect(onboardingProgress("FOOD")).toBe(2);
    expect(onboardingProgress("STYLE")).toBe(3);
    expect(onboardingProgress("PREVIEW")).toBe(4);
  });
});
