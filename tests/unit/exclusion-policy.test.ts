import { describe, expect, it } from "vitest";

import { classifyAutomaticExclusion } from "../../app/features/candidates/exclusion-policy";

describe("classifyAutomaticExclusion", () => {
  it.each([
    { businessName: "황제 룸싸롱", businessSubtype: "유흥주점영업" },
    { businessName: "로얄룸살롱", businessSubtype: "일반음식점" },
    { businessName: "상호 없는 유흥업소", businessSubtype: "유흥주점영업" },
    { businessName: "7080 별밤 라이브바", businessSubtype: "일반음식점" },
    { businessName: "황금 카바레", businessSubtype: "경양식" },
    { businessName: "청춘 캬바레", businessSubtype: "기타" },
    { businessName: "그랜드 라이브클럽", businessSubtype: "일반음식점" },
    { businessName: "시니어 콜라텍", businessSubtype: "일반음식점" },
    { businessName: "오페라 가라오케", businessSubtype: "일반음식점" },
    { businessName: "동네 단란주점", businessSubtype: "단란주점영업" },
    { businessName: "관광호텔 별관", businessSubtype: "무도유흥주점업" },
    { businessName: "첨단문화홀", businessSubtype: "고고(디스코)클럽" },
    { businessName: "청춘회관", businessSubtype: "카바레" },
    { businessName: "별밤뮤직타운", businessSubtype: "노래연습장업" },
    { businessName: "월드노래방", businessSubtype: "일반음식점" },
  ])("excludes adult entertainment candidate $businessName", (candidate) => {
    expect(classifyAutomaticExclusion(candidate)).toMatchObject({
      reason: "ADULT_ENTERTAINMENT",
      exclusionCategory: "ADULT_ENTERTAINMENT",
      confidence: 1,
    });
  });

  it.each([
    { businessName: "별밤 라이브카페", businessSubtype: "일반음식점" },
    { businessName: "왕가네 치킨호프", businessSubtype: "호프/통닭" },
    { businessName: "동명동 와인바", businessSubtype: "경양식" },
    { businessName: "문화전당 펍", businessSubtype: "경양식" },
  ])("keeps food-serving bar candidate $businessName", (candidate) => {
    expect(classifyAutomaticExclusion(candidate)).toBeNull();
  });

  it("records subtype substring evidence accurately", () => {
    expect(classifyAutomaticExclusion({
      businessName: "상호 없는 업소",
      businessSubtype: "일반음식점/유흥주점영업",
    })).toMatchObject({
      matchedRule: "SUBTYPE_ADULT_BAR",
      matchMethod: "SUBTYPE_CONTAINS",
    });
  });

  it("returns chain matching evidence for a high-confidence franchise", () => {
    expect(classifyAutomaticExclusion({
      businessName: "스타벅스 광주봉선DT점",
      businessSubtype: "휴게음식점",
    })).toMatchObject({
      reason: "CHAIN_STORE",
      matchedRule: "STARBUCKS",
      matchedBrand: "스타벅스",
      matchMethod: "BRAND_PREFIX",
      confidence: 0.95,
    });
  });
});
