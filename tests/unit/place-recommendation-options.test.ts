import { describe, expect, it } from "vitest";

import {
  buildRecommendationChips,
  buildRecommendationTitle,
  parseRecommendationSelection,
} from "../../app/features/places/place-recommendation-options";

describe("place recommendation options", () => {
  it("keeps only known recommendation badges and limits selection to two", () => {
    expect(parseRecommendationSelection(["food-gukbap", "style-old-school", "unknown", "food-naengmyeon"]))
      .toEqual(["food-gukbap", "style-old-school"]);
  });

  it("mixes three user tastes, two seasonal choices, two discoveries, and one general choice", () => {
    const chips = buildRecommendationChips({
      userBadges: ["food-gukbap", "style-old-school", "taste-spicy", "food-naengmyeon"],
      month: 8,
    });

    expect(chips).toHaveLength(8);
    expect(chips.slice(0, 3).map((chip) => chip.id)).toEqual(["food-gukbap", "style-old-school", "taste-spicy"]);
    expect(chips.filter((chip) => chip.kind === "SEASONAL")).toHaveLength(2);
    expect(chips.filter((chip) => chip.kind === "DISCOVERY")).toHaveLength(2);
    expect(chips.filter((chip) => chip.kind === "GENERAL")).toHaveLength(1);
  });

  it("builds deterministic titles without an LLM", () => {
    expect(buildRecommendationTitle(["food-naengmyeon"], 8)).toBe("오늘은 시원하게");
    expect(buildRecommendationTitle(["food-naengmyeon", "style-old-school"], 8)).toBe("오래된 여름의 맛");
    expect(buildRecommendationTitle(["food-gukbap", "style-old-school"], 1)).toBe("오래된 집에서 뜨끈하게");
    expect(buildRecommendationTitle(["discovery-new-taste"], 8)).toBe("평소와 다른 한 끼");
  });
});

