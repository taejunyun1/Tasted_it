import { matchChainStore } from "./chain-store-policy";
import { matchNonRestaurantVenue } from "../places/food-venue-policy";

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
  const venue = matchNonRestaurantVenue(input);
  if (venue) {
    return {
      reason: "ADULT_ENTERTAINMENT",
      exclusionCategory: "ADULT_ENTERTAINMENT",
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
    chainScope: chain.chainStatus as "NATIONAL_CHAIN" | "REGIONAL_CHAIN",
    matchMethod: chain.matchMethod,
    confidence: chain.confidence,
  };
}
