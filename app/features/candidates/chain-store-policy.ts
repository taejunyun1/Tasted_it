export type ChainStoreMatch = {
  chainId: string;
  chainName: string;
  matchedTerm: string;
};

type ChainStoreDefinition = {
  chainId: string;
  chainName: string;
  terms: string[];
};

const chainStores: ChainStoreDefinition[] = [
  {
    chainId: "PARIS_BAGUETTE",
    chainName: "파리바게뜨",
    terms: ["파리바게뜨", "파리바게트", "파리베게뜨", "파리베게트"],
  },
  {
    chainId: "TOUS_LES_JOURS",
    chainName: "뚜레쥬르",
    terms: ["뚜레쥬르", "뜌레쥬르"],
  },
];

function normalizeChainStoreName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s·.,()\-_&]/g, "");
}

export function matchChainStore(businessName: string): ChainStoreMatch | null {
  const normalized = normalizeChainStoreName(businessName);
  for (const chain of chainStores) {
    const matchedTerm = chain.terms.find((term) => normalized.includes(normalizeChainStoreName(term)));
    if (matchedTerm) return { chainId: chain.chainId, chainName: chain.chainName, matchedTerm };
  }
  return null;
}
