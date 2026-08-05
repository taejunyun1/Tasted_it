import { describe, expect, it } from "vitest";

import { isDormantAt, validateReviewerApplication } from "../../app/features/reviewers/reviewer-policy";

const valid = {
  statement: "광주 골목 식당을 직접 방문하고 음식의 간과 재료, 가격 대비 만족도, 재방문 의사를 함께 기록합니다. 광고보다 일관된 기준과 솔직한 근거를 중요하게 생각합니다. 같은 기준으로 여러 번 방문해 계절과 시간대에 따른 차이도 기록하겠습니다.",
  occupation: "지역 콘텐츠 기획자",
  tasteDirection: "국물 요리와 오래된 동네 식당을 좋아합니다.",
  regionCode: "GWANGJU" as const,
  specialtySlugs: ["korean"],
};

describe("reviewer policy", () => {
  it("accepts a complete application", () => {
    expect(validateReviewerApplication(valid)).toEqual({});
  });

  it("requires a 100 to 1000 character statement", () => {
    expect(validateReviewerApplication({ ...valid, statement: "짧은 의견" }).statement).toBeDefined();
    expect(validateReviewerApplication({ ...valid, statement: "가".repeat(1001) }).statement).toBeDefined();
  });

  it("requires one to three specialties", () => {
    expect(validateReviewerApplication({ ...valid, specialtySlugs: [] }).specialtySlugs).toBeDefined();
    expect(validateReviewerApplication({ ...valid, specialtySlugs: ["a", "b", "c", "d"] }).specialtySlugs).toBeDefined();
  });

  it("marks exactly 90 inactive days as dormant", () => {
    expect(isDormantAt("2026-05-07T00:00:00.000Z", "2026-08-05T00:00:00.000Z")).toBe(true);
    expect(isDormantAt("2026-05-08T00:00:00.000Z", "2026-08-05T00:00:00.000Z")).toBe(false);
  });
});
