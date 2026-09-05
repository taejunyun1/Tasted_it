import { matchChainStore } from "./chain-store-policy";
import { matchNonRestaurantVenue } from "../places/food-venue-policy";
import { classifyLocalDining } from "../places/local-dining-policy";

export type AutomaticExclusion = {
  reason: "CHAIN_STORE" | "ADULT_ENTERTAINMENT" | "NOT_RESTAURANT";
  exclusionCategory: "CHAIN_STORE" | "ADULT_ENTERTAINMENT" | "NOT_RESTAURANT";
  matchedRule: string;
  matchedBrand: string | null;
  matchedAlias: string | null;
  chainScope: "NATIONAL_CHAIN" | "REGIONAL_CHAIN" | "LOCAL_CHAIN" | null;
  matchMethod: string;
  confidence: number;
};

export function classifyAutomaticExclusion(input: {
  businessName: string;
  businessSubtype: string | null;
  sourceType?: string;
}): AutomaticExclusion | null {
  const dining = classifyLocalDining(input);
  if (dining.decision !== "EXCLUDE") return null;
  const nonChainReason = dining.reasons.find((reason) => reason !== "CHAIN_STORE");
  const category = nonChainReason === "ADULT_ENTERTAINMENT" ? "ADULT_ENTERTAINMENT" : "NOT_RESTAURANT";
  const venue = nonChainReason ? matchNonRestaurantVenue(input) ?? {
    exclusionCategory: category, matchedRule: dining.matchedRules.join("|"), matchMethod: "LOCAL_DINING_POLICY", confidence: 1,
  } : null;
  if (venue) {
    return {
      reason: venue.exclusionCategory,
      exclusionCategory: venue.exclusionCategory,
      matchedRule: venue.matchedRule,
      matchedBrand: null,
      matchedAlias: null,
      chainScope: null,
      matchMethod: venue.matchMethod,
      confidence: venue.confidence,
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
    chainScope: chain.chainStatus as "NATIONAL_CHAIN" | "REGIONAL_CHAIN" | "LOCAL_CHAIN",
    matchMethod: chain.matchMethod,
    confidence: chain.confidence,
  };
}
