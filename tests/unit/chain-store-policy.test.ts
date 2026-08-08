import { describe, expect, it } from "vitest";

import { matchChainStore } from "../../app/features/candidates/chain-store-policy";

describe("matchChainStore", () => {
  it.each([
    "파리바게뜨 광주점",
    "파리바게트 중흥점",
    "파리베게뜨 수완점",
    "파리베게트 전남대점",
  ])("matches Paris Baguette variant %s", (businessName) => {
    expect(matchChainStore(businessName)).toMatchObject({ chainId: "PARIS_BAGUETTE", chainName: "파리바게뜨" });
  });

  it.each(["뚜레쥬르 동명점", "뜌레쥬르 광주역점"])(
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
