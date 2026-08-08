import { matchChainStore } from "./chain-store-policy";

export type AutomaticExclusion = {
  reason: "CHAIN_STORE" | "ADULT_ENTERTAINMENT";
  exclusionCategory: "CHAIN_STORE" | "ADULT_ENTERTAINMENT";
  matchedRule: string;
  matchedBrand: string | null;
  matchedAlias: string | null;
  chainScope: "NATIONAL_CHAIN" | "REGIONAL_CHAIN" | null;
  matchMethod: string;
  confidence: number;
};

export function classifyAutomaticExclusion(input: {
  businessName: string;
  businessSubtype: string | null;
}): AutomaticExclusion | null {
  const normalizedName = input.businessName.normalize("NFKC").replace(/\s/g, "");
  const normalizedSubtype = input.businessSubtype?.normalize("NFKC").replace(/\s/g, "") ?? "";
  if (
    normalizedName.includes("룸살롱") ||
    normalizedName.includes("룸싸롱") ||
    normalizedSubtype.includes("유흥주점영업")
  ) {
    return {
      reason: "ADULT_ENTERTAINMENT",
      exclusionCategory: "ADULT_ENTERTAINMENT",
      matchedRule: normalizedSubtype.includes("유흥주점영업") ? "SUBTYPE_ADULT_BAR" : "NAME_ROOM_SALON",
      matchedBrand: null,
      matchedAlias: null,
      chainScope: null,
      matchMethod: normalizedSubtype.includes("유흥주점영업") ? "SUBTYPE_EXACT" : "NAME_CONTAINS",
      confidence: 1,
    };
  }

  const chain = matchChainStore(input.businessName);
  if (!chain) return null;
  return {
    reason: "CHAIN_STORE",
    exclusionCategory: "CHAIN_STORE",
    matchedRule: chain.chainId,
    matchedBrand: chain.chainName,
    matchedAlias: chain.matchedTerm === chain.chainName ? null : chain.matchedTerm,
    chainScope: chain.chainStatus as "NATIONAL_CHAIN" | "REGIONAL_CHAIN",
    matchMethod: chain.matchMethod,
    confidence: chain.confidence,
  };
}
