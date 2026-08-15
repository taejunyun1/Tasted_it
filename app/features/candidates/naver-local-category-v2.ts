import type { NaverLocalSearchResult } from "./naver-local-search.server";
import type { RegionCode } from "./public-data";
import { matchNaverLocalCategory } from "./naver-local-category";

export const NAVER_CATEGORY_V2_VERSION = "naver-category-v2" as const;

export type NaverV2Verification = {
  status: "VERIFIED" | "BROAD" | "NO_MATCH" | "UNAVAILABLE" | "OUT_OF_SCOPE" | "AMBIGUOUS";
  placeType: "FOOD" | "NOT_FOOD" | "UNKNOWN";
  categoryVerification: "SPECIFIC" | "BROAD" | "NONE";
  categorySlug: string | null;
  matchKind: "NAME_ADDRESS" | "NAME_COORDINATE" | "NONE";
  distanceMeters: number | null;
  evidenceCodes: string[];
};

export function verifyNaverCategoryV2(input: {
  businessName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  regionCode: RegionCode;
  results: NaverLocalSearchResult[] | null;
  terminalSlugs: Set<string>;
}): NaverV2Verification {
  if (input.results == null) return { status: "UNAVAILABLE", placeType: "UNKNOWN", categoryVerification: "NONE", categorySlug: null, matchKind: "NONE", distanceMeters: null, evidenceCodes: ["NAVER_UNAVAILABLE"] };
  const result = matchNaverLocalCategory({ ...input, results: input.results });
  if (result.status === "OUT_OF_SCOPE") return { status: "OUT_OF_SCOPE", placeType: "UNKNOWN", categoryVerification: "NONE", categorySlug: null, matchKind: "NONE", distanceMeters: null, evidenceCodes: result.evidenceCodes };
  if (result.status === "AMBIGUOUS") return { status: "AMBIGUOUS", placeType: "UNKNOWN", categoryVerification: "NONE", categorySlug: null, matchKind: "NONE", distanceMeters: null, evidenceCodes: result.evidenceCodes };
  if (result.status !== "VERIFIED") return { status: "NO_MATCH", placeType: "UNKNOWN", categoryVerification: "NONE", categorySlug: null, matchKind: "NONE", distanceMeters: null, evidenceCodes: result.evidenceCodes };
  const matchKind = result.evidenceCodes.includes("NAVER_EXACT_ADDRESS") ? "NAME_ADDRESS" as const : "NAME_COORDINATE" as const;
  if (!result.mappedCategorySlug) return { status: "BROAD", placeType: "FOOD", categoryVerification: "BROAD", categorySlug: null, matchKind, distanceMeters: null, evidenceCodes: result.evidenceCodes };
  return { status: "VERIFIED", placeType: "FOOD", categoryVerification: "SPECIFIC", categorySlug: result.mappedCategorySlug, matchKind, distanceMeters: null, evidenceCodes: result.evidenceCodes };
}
