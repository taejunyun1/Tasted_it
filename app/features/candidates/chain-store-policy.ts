import localAllowlist from "../../../data/franchise-local-allowlist.json";
import manualBlacklist from "../../../data/franchise-manual-blacklist.json";

export type ChainStatus = "INDEPENDENT" | "NATIONAL_CHAIN" | "REGIONAL_CHAIN" | "LOCAL_CHAIN" | "UNKNOWN";

export type ChainMatchMethod =
  | "ALLOWLIST_EXACT"
  | "ALLOWLIST_PREFIX"
  | "BRAND_EXACT"
  | "ALIAS_EXACT"
  | "BRAND_PREFIX"
  | "ALIAS_PREFIX"
  | "BRAND_CONTAINS";

export type ChainClassification = {
  chainStatus: ChainStatus;
  chainId: string;
  chainName: string;
  matchedTerm: string;
  matchMethod: ChainMatchMethod;
  confidence: number;
};

export type ChainStoreMatch = ChainClassification;

type ChainStoreDefinition = {
  id: string;
  name: string;
  aliases: string[];
};

export function normalizeChainStoreName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\(주\)|주식회사|㈜/g, "")
    .replace(/[\s·.,'"()\-_&]/g, "");
}

export function stripBranchSuffix(value: string) {
  return value
    .trim()
    .replace(/(?:드라이브스루점|직영점|가맹점|광주점|전남점|DT점|dt점|지점|본점|호점|점포|DT|dt|점)$/u, "")
    .trim();
}

function matchDefinitions(
  normalizedName: string,
  definitions: ChainStoreDefinition[],
  chainStatus: ChainStatus,
  allowlist: boolean,
): ChainClassification | null {
  for (const definition of definitions) {
    const normalizedBrand = normalizeChainStoreName(definition.name);
    if (normalizedName === normalizedBrand) {
      return {
        chainStatus,
        chainId: definition.id,
        chainName: definition.name,
        matchedTerm: definition.name,
        matchMethod: allowlist ? "ALLOWLIST_EXACT" : "BRAND_EXACT",
        confidence: allowlist ? 1 : 1,
      };
    }

    for (const alias of definition.aliases) {
      const normalizedAlias = normalizeChainStoreName(alias);
      if (normalizedName === normalizedAlias) {
        return {
          chainStatus,
          chainId: definition.id,
          chainName: definition.name,
          matchedTerm: alias,
          matchMethod: allowlist ? "ALLOWLIST_EXACT" : "ALIAS_EXACT",
          confidence: allowlist ? 1 : 0.97,
        };
      }
    }

    if (normalizedName.startsWith(normalizedBrand)) {
      return {
        chainStatus,
        chainId: definition.id,
        chainName: definition.name,
        matchedTerm: definition.name,
        matchMethod: allowlist ? "ALLOWLIST_PREFIX" : "BRAND_PREFIX",
        confidence: allowlist ? 1 : 0.95,
      };
    }

    for (const alias of definition.aliases) {
      const normalizedAlias = normalizeChainStoreName(alias);
      if (normalizedName.startsWith(normalizedAlias)) {
        return {
          chainStatus,
          chainId: definition.id,
          chainName: definition.name,
          matchedTerm: alias,
          matchMethod: allowlist ? "ALLOWLIST_PREFIX" : "ALIAS_PREFIX",
          confidence: allowlist ? 1 : 0.9,
        };
      }
    }

    if (!allowlist && normalizedBrand.length >= 4 && normalizedName.includes(normalizedBrand)) {
      return {
        chainStatus,
        chainId: definition.id,
        chainName: definition.name,
        matchedTerm: definition.name,
        matchMethod: "BRAND_CONTAINS",
        confidence: 0.75,
      };
    }
  }
  return null;
}

export function classifyChainStore(businessName: string): ChainClassification | null {
  const normalizedName = normalizeChainStoreName(stripBranchSuffix(businessName));
  const allowed = matchDefinitions(normalizedName, localAllowlist, "LOCAL_CHAIN", true);
  if (allowed) return allowed;
  return matchDefinitions(normalizedName, manualBlacklist, "NATIONAL_CHAIN", false);
}

export function matchChainStore(businessName: string): ChainStoreMatch | null {
  const classification = classifyChainStore(businessName);
  if (
    !classification ||
    classification.confidence < 0.9 ||
    !["NATIONAL_CHAIN", "REGIONAL_CHAIN"].includes(classification.chainStatus)
  ) {
    return null;
  }
  return classification;
}
