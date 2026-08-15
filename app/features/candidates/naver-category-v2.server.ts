import {
  NaverLocalSearchError,
  type NaverLocalSearchAdapter,
} from "./naver-local-search.server";
import {
  verifyNaverCategoryV2,
  type NaverV2Verification,
} from "./naver-local-category-v2";

/**
 * Server boundary for v5.  Provider payloads are intentionally discarded as
 * soon as the bounded internal verification has been derived.
 */
export async function verifyNaverCategoryV2WithAdapter(input: {
  businessName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  regionCode: "GWANGJU" | "JEONNAM";
  terminalSlugs: Set<string>;
  adapter: NaverLocalSearchAdapter;
}): Promise<NaverV2Verification> {
  const searchInput = {
    businessName: input.businessName,
    address: input.address,
    regionCode: input.regionCode,
  };
  try {
    const results = await searchWithOneRetry(input.adapter, searchInput);
    return verifyNaverCategoryV2({ ...input, results });
  } catch {
    return verifyNaverCategoryV2({ ...input, results: null });
  }
}

async function searchWithOneRetry(
  adapter: NaverLocalSearchAdapter,
  input: { businessName: string; address: string; regionCode: "GWANGJU" | "JEONNAM" },
) {
  try {
    return await adapter.search(input);
  } catch (error) {
    if (!(error instanceof NaverLocalSearchError) || !error.retryable) throw error;
    return adapter.search(input);
  }
}
