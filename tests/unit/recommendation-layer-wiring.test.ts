import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const candidates = readFileSync("app/features/places/recommendation-candidates.server.ts", "utf8");
const home = readFileSync("app/features/places/home-curation.ts", "utf8");
const discovery = readFileSync("app/features/places/place-discovery.ts", "utf8");
const learning = readFileSync("app/features/members/taste-learning.server.ts", "utf8");

describe("recommendation layer production wiring", () => {
  it("홈 품질과 현재 비추천 후보가 공통 적격성 판정을 사용한다", () => {
    expect(home).toContain("evaluateAppEligibility({");
    expect(candidates).toContain("evaluateAppEligibility({");
    expect(candidates).not.toContain("filter((place) => !disliked.has(place.id))");
  });

  it("취향 학습 감점이 행동 가치 표를 통해 계산된다", () => {
    expect(learning).toContain("tastePenaltyForFeedback({");
    expect(learning).not.toMatch(/negativeFoodBadgeIds\s*\)\s*;?/);
  });

  it("목록 랭킹은 내부 DIRECT를 계산하고 공개 경계에서만 FAMILIAR로 바꾼다", () => {
    expect(discovery).toContain("const matchKind: RecommendationMatchKind = matchedTasteSignal");
    expect(discovery).toContain('? "DIRECT" : adjacentTasteSignal ? "ADJACENT" : "EXPLORATION"');
    expect(discovery).toContain("discoveryMode: publicDiscoveryMatchKind(matchKind)");
  });
});
