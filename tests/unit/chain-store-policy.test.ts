import { describe, expect, it } from "vitest";

import {
  classifyChainStore,
  matchChainStore,
  normalizeChainStoreName,
  stripBranchSuffix,
} from "../../app/features/candidates/chain-store-policy";

describe("classifyChainStore", () => {
  it("classifies an official brand prefix as a national chain", () => {
    expect(classifyChainStore("스타벅스 광주봉선DT점")).toMatchObject({
      chainStatus: "NATIONAL_CHAIN",
      chainName: "스타벅스",
      matchMethod: "BRAND_PREFIX",
      confidence: 0.95,
    });
  });

  it("classifies a known alias prefix", () => {
    expect(classifyChainStore("메가커피 충장점")).toMatchObject({
      chainName: "메가MGC커피",
      matchMethod: "ALIAS_PREFIX",
      confidence: 0.9,
    });
  });

  it("does not use contains matching for a short brand", () => {
    expect(classifyChainStore("동네설빙연구소")).toBeNull();
  });

  it("keeps an allowlisted local brand", () => {
    expect(classifyChainStore("광주로컬허용점")).toMatchObject({
      chainStatus: "LOCAL_CHAIN",
      confidence: 1,
    });
  });

  it("normalizes legal forms and strips a branch suffix", () => {
    expect(normalizeChainStoreName("(주) 메가MGC커피·광주점")).toBe("메가mgc커피광주점");
    expect(stripBranchSuffix("메가MGC커피 광주충장로DT점")).toBe("메가MGC커피 광주충장로");
  });
});

describe("matchChainStore", () => {
  it.each([
    "파리바게뜨 광주점",
    "파리바게트 중흥점",
    "파리베게뜨 수완점",
    "파리베게트 전남대점",
  ])("matches Paris Baguette variant %s", (businessName) => {
    expect(matchChainStore(businessName)).toMatchObject({ chainId: "PARIS_BAGUETTE", chainName: "파리바게뜨" });
  });

  it.each(["뚜레쥬르 동명점", "뜌레쥬르 광주역점", "뚜레쥬르 여수무선점", "뚜레쥬르광주첨단점"])(
    "matches Tous les Jours variant %s",
    (businessName) => {
      expect(matchChainStore(businessName)).toMatchObject({ chainId: "TOUS_LES_JOURS", chainName: "뚜레쥬르" });
    },
  );

  it.each(["파리의 바게트", "동네브레드", "시장꽈배기", "우리동네빵집"])(
    "does not infer an unlisted chain from %s",
    (businessName) => {
      expect(matchChainStore(businessName)).toBeNull();
    },
  );
});
