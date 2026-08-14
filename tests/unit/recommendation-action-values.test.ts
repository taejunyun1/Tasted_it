import { describe, expect, it } from "vitest";

import {
  actionValue,
  canonicalRecommendationMatchKind,
  publicDiscoveryMatchKind,
  tastePenaltyForFeedback,
} from "../../app/features/places/recommendation-action-values";

describe("recommendation action values", () => {
  it("메뉴 불만 또는 이유 없는 비추천만 음식 취향을 감점한다", () => {
    expect(tastePenaltyForFeedback({ value: -1, reason: "MENU" })).toBe(.18);
    expect(tastePenaltyForFeedback({ value: -1, reason: null })).toBe(.18);
    expect(tastePenaltyForFeedback({ value: -1, reason: "DISTANCE" })).toBe(0);
    expect(tastePenaltyForFeedback({ value: -1, reason: "ALREADY_VISITED" })).toBe(0);
    expect(tastePenaltyForFeedback({ value: 1, reason: null })).toBe(0);
  });

  it("상세 열람은 추천 순위 입력으로 쓰지 않는다", () => {
    expect(actionValue("DETAIL_OPENED").rankingInput).toBe(false);
  });

  it("기존 FAMILIAR 이름을 공통 DIRECT 취향 일치로 해석한다", () => {
    expect(canonicalRecommendationMatchKind("FAMILIAR")).toBe("DIRECT");
    expect(canonicalRecommendationMatchKind("ADJACENT")).toBe("ADJACENT");
    expect(canonicalRecommendationMatchKind("EXPLORATION")).toBe("EXPLORATION");
  });

  it("내부 DIRECT를 기존 목록 공개 계약의 FAMILIAR로만 변환한다", () => {
    expect(publicDiscoveryMatchKind("DIRECT")).toBe("FAMILIAR");
    expect(publicDiscoveryMatchKind("ADJACENT")).toBe("ADJACENT");
    expect(publicDiscoveryMatchKind("EXPLORATION")).toBe("EXPLORATION");
  });
});
