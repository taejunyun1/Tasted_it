import { describe, expect, it } from "vitest";

import { selectTasteSignals } from "../../app/features/members/taste-signals";

describe("selectTasteSignals", () => {
  it("값이 높은 순으로 최대 세 개의 실제 취향 신호를 고른다", () => {
    expect(selectTasteSignals({
      status: "VISIBLE",
      placeCount: 7,
      dimensions: [
        { key: "식감", value: 3.8 },
        { key: "감칠맛", value: 4.42 },
        { key: "향신료", value: 2.9 },
        { key: "국물 농도", value: 4.1 },
      ],
    })).toMatchObject({
      status: "VISIBLE",
      signals: [
        { key: "감칠맛", value: 4.42, label: "감칠맛 4.4" },
        { key: "국물 농도", value: 4.1, label: "국물 농도 4.1" },
        { key: "식감", value: 3.8, label: "식감 3.8" },
      ],
    });
  });

  it("학습 중에는 추정 취향 대신 진행 상태만 반환한다", () => {
    expect(selectTasteSignals({ status: "LEARNING", placeCount: 3, dimensions: [] })).toEqual({
      status: "LEARNING",
      placeCount: 3,
      requiredPlaceCount: 5,
      signals: [],
    });
  });
});
