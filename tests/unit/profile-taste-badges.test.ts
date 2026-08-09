import { describe, expect, it } from "vitest";

import {
  TASTE_BADGE_CATALOG,
  buildTasteHeadline,
  buildTasteProfile,
  inferTasteBadges,
  mergeTasteBadgeScores,
} from "../../app/features/members/profile-taste-badges";

describe("profile taste badge catalog", () => {
  it("keeps stable unique ids and all three user-facing categories", () => {
    expect(new Set(TASTE_BADGE_CATALOG.map((badge) => badge.id)).size).toBe(TASTE_BADGE_CATALOG.length);
    expect(new Set(TASTE_BADGE_CATALOG.map((badge) => badge.category))).toEqual(new Set(["FOOD", "TASTE", "STYLE"]));
    expect(TASTE_BADGE_CATALOG.map((badge) => badge.label)).toEqual(expect.arrayContaining([
      "국밥러", "떡볶이러", "평냉파", "라멘러", "회러버", "베이커리헌터",
      "맵부심", "슴슴한맛", "국물파", "향신료파",
      "노포파", "로컬맛집파", "혼밥러", "가성비파", "웨이팅싫어",
    ]));
  });
});

describe("profile taste badge scoring", () => {
  it("merges multiple sources without exceeding one and preserves source evidence", () => {
    const [badge] = mergeTasteBadgeScores([
      { badgeId: "food-gukbap", score: 0.8, source: "USER" },
      { badgeId: "food-gukbap", score: 0.7, source: "INFERRED" },
    ]);
    expect(badge.score).toBeGreaterThan(0.8);
    expect(badge.score).toBeLessThanOrEqual(1);
    expect(badge.sources).toEqual(["USER", "INFERRED"]);
  });

  it("infers food and style from positive activity but ignores disliked places", () => {
    const inferred = inferTasteBadges({
      saved: [{ name: "시장 국밥", categoryName: "국밥·해장국" }],
      rated: [
        { name: "장안 기사식당", categoryName: "국밥·해장국", value: 1 },
        { name: "평양냉면", categoryName: "냉면", value: -1 },
      ],
      flavorDimensions: [],
    });
    const ids = inferred.map((badge) => badge.badgeId);
    expect(ids).toContain("food-gukbap");
    expect(ids).toContain("style-market");
    expect(ids).toContain("style-driver-restaurant");
    expect(ids).not.toContain("food-pyeongyang-naengmyeon");
    expect(inferred.every((badge) => badge.source === "INFERRED" && badge.score >= 0 && badge.score <= 1)).toBe(true);
  });

  it("maps strong flavor dimensions conservatively", () => {
    const inferred = inferTasteBadges({
      saved: [], rated: [],
      flavorDimensions: [
        { key: "국물 농도", value: 4.6 },
        { key: "향신료", value: 4.2 },
        { key: "양", value: 4.4 },
      ],
    });
    expect(inferred.map((badge) => badge.badgeId)).toEqual(expect.arrayContaining([
      "taste-broth", "taste-rich", "taste-spices", "style-large-portions",
    ]));
  });

  it("does not infer food badges from ambiguous one-syllable fragments", () => {
    const inferred = inferTasteBadges({
      saved: [{ name: "동네 포차 가게", categoryName: "주점" }],
      rated: [],
      flavorDimensions: [],
    });
    expect(inferred.map((badge) => badge.badgeId)).not.toEqual(expect.arrayContaining(["food-pho", "food-crustacean"]));
  });
});

describe("profile taste presentation", () => {
  it("creates a natural two-food headline with Korean particles", () => {
    expect(buildTasteHeadline("태준", [
      { badgeId: "food-tteokbokki", score: 0.92, sources: ["USER"] },
      { badgeId: "food-gukbap", score: 0.83, sources: ["INFERRED"] },
    ])).toBe("떡볶이와 국밥을 좋아하는 태준");
  });

  it("prefers a food and style story when style is the stronger second signal", () => {
    expect(buildTasteHeadline("민수", [
      { badgeId: "food-gukbap", score: 0.88, sources: ["INFERRED"] },
      { badgeId: "style-old-school", score: 0.86, sources: ["USER"] },
      { badgeId: "food-ramen", score: 0.42, sources: ["INFERRED"] },
    ])).toBe("오래된 식당에서 국밥을 찾는 민수");
  });

  it("shows at most seven representative badges while retaining category variety", () => {
    const profile = buildTasteProfile({
      displayName: "태준",
      stored: [
        { badgeId: "food-gukbap", score: 0.95, source: "USER" },
        { badgeId: "food-tteokbokki", score: 0.9, source: "USER" },
        { badgeId: "food-ramen", score: 0.85, source: "USER" },
        { badgeId: "food-pasta", score: 0.82, source: "USER" },
        { badgeId: "taste-spicy", score: 0.8, source: "USER" },
        { badgeId: "taste-broth", score: 0.78, source: "USER" },
        { badgeId: "style-old-school", score: 0.76, source: "USER" },
        { badgeId: "style-local", score: 0.72, source: "USER" },
      ],
      inferred: [],
    });
    expect(profile.badges).toHaveLength(7);
    expect(new Set(profile.badges.map((badge) => badge.category))).toEqual(new Set(["FOOD", "TASTE", "STYLE"]));
  });
});
