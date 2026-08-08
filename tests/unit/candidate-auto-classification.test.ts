import { describe, expect, it } from "vitest";

import {
  classifyCandidate,
  extractNeighborhood,
} from "../../app/features/candidates/category-suggestion";

describe("classifyCandidate", () => {
  it("classifies a Korean soup restaurant with high confidence", () => {
    expect(classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: "한식",
      businessName: "일품 양평해장국 광주무등산점",
      address: "광주광역시 동구 증심사길 25 (운림동)",
    })).toMatchObject({
      categorySlug: "gukbap-detail",
      confidence: "HIGH",
      neighborhood: "운림동",
    });
  });

  it("detects conflicting cuisine signals", () => {
    expect(classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: "한식",
      businessName: "스시 하루",
      address: "광주광역시 동구 동명동 1",
    })).toMatchObject({
      categorySlug: "sushi-sashimi",
      confidence: "CONFLICT",
    });
  });

  it("uses a specific name signal as medium confidence without a subtype", () => {
    expect(classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: null,
      businessName: "멘야 하루",
      address: "광주광역시 북구 용봉동 10",
    })).toMatchObject({
      categorySlug: "ramen-detail",
      confidence: "MEDIUM",
    });
  });

  it("uses only the source default with low confidence", () => {
    expect(classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: null,
      businessName: "맛있는집",
      address: "광주광역시 서구 치평동 1",
    })).toMatchObject({
      categorySlug: "home-meal",
      confidence: "LOW",
    });
  });

  it("normalizes 육계장 and never suggests gimbap", () => {
    const result = classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: "기타",
      businessName: "콩물동부육계장",
    });

    expect(result).toMatchObject({ categorySlug: "stew" });
    expect(result.reasons.join(" ")).toContain("육계장");
  });

  it.each(["전주해장국", "서울설렁탕", "장터순대국", "나주곰탕", "원조돼지국밥"])(
    "classifies the soup-family business %s as gukbap",
    (businessName) => {
      expect(classifyCandidate({
        sourceType: "GENERAL_RESTAURANT",
        businessSubtype: "한식",
        businessName,
      })).toMatchObject({ categorySlug: "gukbap-detail", confidence: "HIGH" });
    },
  );

  it("prioritizes chicken food context over a pub venue signal", () => {
    expect(classifyCandidate({
      sourceType: "ENTERTAINMENT_BAR",
      businessSubtype: "호프/통닭",
      businessName: "왕가네 치킨호프",
    })).toMatchObject({ categorySlug: "chicken", confidence: "HIGH" });
  });

  it("keeps mixed takoyaki and burger signals in manual conflict", () => {
    const result = classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: "한식",
      businessName: "다마수제타코야끼앤버거",
    });

    expect(result.confidence).toBe("CONFLICT");
    expect(result.candidateSlugs).toEqual(expect.arrayContaining(["japanese-rice", "burger"]));
    expect(result.reasons.join(" ")).toContain("타코야끼");
    expect(result.reasons.join(" ")).toContain("버거");
  });

  it.each([
    "연어마을",
    "바다장어명가",
    "킹크랩하우스",
    "대게나라",
    "랍스터랩",
    "전복마을",
    "굴세상",
    "꼬막정식",
    "조개구이",
    "낙지천국",
    "주꾸미볶음",
    "문어상회",
    "오징어마을",
    "아귀찜",
    "생선구이",
    "고등어식당",
    "갈치조림",
    "복어집",
    "물회명가",
    "해물탕",
  ])("classifies seafood business %s as seafood", (businessName) => {
    expect(classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: "한식",
      businessName,
    })).toMatchObject({ categorySlug: "seafood-dish", confidence: "HIGH" });
  });

  it("prioritizes a specific seafood name over a generic grill signal", () => {
    const result = classifyCandidate({
      sourceType: "GENERAL_RESTAURANT",
      businessSubtype: "한식",
      businessName: "풍천장어구이",
    });

    expect(result).toMatchObject({ categorySlug: "seafood-dish", confidence: "HIGH" });
    expect(result.confidence).not.toBe("CONFLICT");
  });

  it.each(["라이브카페", "별밤 라이브바", "7080 음악주점"])(
    "classifies live entertainment venue %s as a pub",
    (businessName) => {
      expect(classifyCandidate({
        sourceType: "ENTERTAINMENT_BAR",
        businessSubtype: "유흥주점영업",
        businessName,
      })).toMatchObject({ categorySlug: "pub", confidence: "HIGH" });
    },
  );

  it.each(["사과농장", "망고상회", "딸기마켓", "복숭아직판장"])(
    "does not infer a restaurant category from fruit-only name %s",
    (businessName) => {
      expect(classifyCandidate({
        sourceType: "GENERAL_RESTAURANT",
        businessSubtype: null,
        businessName,
      })).toMatchObject({ categorySlug: "home-meal", confidence: "LOW" });
    },
  );

  it.each(["자연어울림카페", "굴뚝카페"])(
    "does not treat a partial seafood syllable in %s as seafood",
    (businessName) => {
      expect(classifyCandidate({ sourceType: "REST_CAFE", businessName }).categorySlug).toBe("cafe");
    },
  );
});

describe("extractNeighborhood", () => {
  it("prefers a parenthesized legal neighborhood", () => {
    expect(extractNeighborhood("광주광역시 동구 증심사길 25 (운림동)")).toBe("운림동");
  });

  it("extracts dong, eup and myeon address tokens", () => {
    expect(extractNeighborhood("광주광역시 동구 동명동 10")).toBe("동명동");
    expect(extractNeighborhood("전라남도 담양군 담양읍 중앙로 1")).toBe("담양읍");
    expect(extractNeighborhood("전라남도 화순군 화순면 중앙로 1")).toBe("화순면");
  });

  it("extracts a ri address token", () => {
    expect(extractNeighborhood("전라남도 담양군 담양읍 학동리 12")).toBe("학동리");
  });
});
