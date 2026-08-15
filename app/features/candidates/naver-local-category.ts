import type { CandidateClassification, ClassificationConfidence } from "./category-suggestion";
import type { NaverLocalSearchResult } from "./naver-local-search.server";
import type { RegionCode } from "./public-data";

export const NAVER_CATEGORY_RULE_VERSION = "naver-category-v1" as const;

export type NaverVerificationStatus =
  | "VERIFIED"
  | "LIKELY"
  | "AMBIGUOUS"
  | "NO_MATCH"
  | "OUT_OF_SCOPE"
  | "FAILED"
  | "SKIPPED";

export type NaverEvidenceCode =
  | "NAVER_EXACT_NAME"
  | "NAVER_BRANCH_NORMALIZED_NAME"
  | "NAVER_EXACT_ADDRESS"
  | "NAVER_COORDINATES_WITHIN_100M"
  | "NAVER_SPECIFIC_CATEGORY"
  | "NAVER_BROAD_CATEGORY"
  | "SOURCE_SUBTYPE_MATCH"
  | "SOURCE_SUBTYPE_CONFLICT"
  | "NAME_FOOD_MATCH";

export type NaverLocalCategoryMatch = {
  status: NaverVerificationStatus;
  mappedCategorySlug: string | null;
  matchScore: number;
  specificityScore: number;
  confidenceScore: number;
  evidenceCodes: NaverEvidenceCode[];
};

export type CategoryAuthorityDecision = {
  categorySlug: string;
  confidence: ClassificationConfidence;
  confidenceScore: number;
  automatic: boolean;
  reasons: string[];
  naver: NaverLocalCategoryMatch | null;
};

type MatchInput = {
  businessName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  regionCode: RegionCode;
  results: NaverLocalSearchResult[];
  terminalSlugs: Set<string>;
};

type CategoryMapping = { slug: string; specificityScore: number };

const specificCategoryMappings: ReadonlyArray<readonly [RegExp, string]> = [
  [/육류|고기요리|숯불구이|갈비구이|불고기|삼겹살|돼지갈비/, "grill"],
  [/국밥|해장국|순대국|설렁탕|곰탕/, "gukbap-detail"],
  [/찌개|전골|감자탕|육개장/, "stew"],
  [/족발|보쌈/, "jokbal-bossam"],
  [/한정식/, "hanjeongsik"],
  [/백반|가정식/, "home-meal"],
  [/스시|초밥/, "sushi-sashimi"],
  [/라멘/, "ramen-detail"],
  [/우동|소바/, "udon-soba"],
  [/돈가스|돈까스/, "donkatsu-detail"],
  [/이자카야/, "izakaya"],
  [/짜장|짬뽕/, "jjajang-jjamppong"],
  [/마라|훠궈/, "mala-hotpot"],
  [/양꼬치/, "lamb-skewer"],
  [/파스타/, "pasta"],
  [/스테이크/, "steak"],
  [/피자/, "pizza"],
  [/햄버거|버거/, "burger"],
  [/브런치/, "brunch"],
  [/떡볶이|분식/, "tteokbokki"],
  [/김밥/, "gimbap"],
  [/만두/, "dumpling"],
  [/치킨|통닭|닭강정/, "chicken"],
  [/쌀국수|베트남/, "vietnamese"],
  [/태국|타이/, "thai"],
  [/인도|커리/, "indian"],
  [/멕시칸|타코/, "mexican"],
  [/베이커리|제과|제빵|빵|도넛|도너츠/, "bakery-detail"],
  [/아이스크림|빙수|젤라또/, "ice-dessert"],
  [/디저트/, "dessert"],
  [/포장마차|대포집|소주방|포차/, "pocha"],
  [/호프|펍|맥주|주점/, "pub"],
  [/와인/, "wine-bar"],
  [/칵테일/, "cocktail-bar"],
  [/횟집|회집|해산물|수산|생선|물회|아구|아귀|장어|연어/, "seafood-dish"],
  [/샐러드/, "salad"],
  [/비건|채식/, "vegan"],
];

const broadCategoryPattern = /(?:^|>)\s*(?:음식점|한식|양식|일식|중식|카페|주점)\s*(?:>|$)/;

function normalizeForComparison(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/<[^>]+>/g, "").replace(/[^0-9a-z가-힣]/g, "");
}

function normalizeBranchName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR")
    .replace(/(?:\s|·|\(|\)|-|_)*(?:본점|직영점|[0-9]+호점|[a-z]점)\s*$/i, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function normalizeAddress(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR")
    .replace(/광주광역시|광주시/g, "광주")
    .replace(/전라남도/g, "전남")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function distanceMeters(latitude: number, longitude: number, otherLatitude: number, otherLongitude: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(otherLatitude - latitude);
  const longitudeDelta = radians(otherLongitude - longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude)) * Math.cos(radians(otherLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function inRequestedRegion(address: string, regionCode: RegionCode) {
  const normalized = address.normalize("NFKC");
  return regionCode === "GWANGJU"
    ? /광주(?:광역시)?/.test(normalized)
    : /전라남도|전남/.test(normalized);
}

function mapCategory(category: string, terminalSlugs: Set<string>): CategoryMapping | null {
  const matched = specificCategoryMappings.find(([pattern, slug]) => pattern.test(category) && terminalSlugs.has(slug));
  if (matched) return { slug: matched[1], specificityScore: 20 };
  if (broadCategoryPattern.test(category)) return null;
  return null;
}

function naverDecision(status: NaverVerificationStatus, mappedCategorySlug: string | null, matchScore = 0, specificityScore = 0, evidenceCodes: NaverEvidenceCode[] = []): NaverLocalCategoryMatch {
  return { status, mappedCategorySlug, matchScore, specificityScore, confidenceScore: 0, evidenceCodes };
}

function nameMatch(input: string, result: string) {
  const exact = normalizeForComparison(input) === normalizeForComparison(result);
  if (exact) return "EXACT" as const;
  if (normalizeBranchName(input) === normalizeBranchName(result)) return "BRANCH" as const;
  return null;
}

/**
 * Matches only a name+address or name+nearby-coordinate result.  Provider
 * strings do not leave this pure function: callers persist the returned
 * internal category and evidence code only.
 */
export function matchNaverLocalCategory(input: MatchInput): NaverLocalCategoryMatch {
  const inScope = input.results.filter((result) => inRequestedRegion(result.address, input.regionCode));
  if (input.results.length > 0 && inScope.length === 0) return naverDecision("OUT_OF_SCOPE", null);

  const candidates = inScope.map((result) => {
    const matchedName = nameMatch(input.businessName, result.name);
    const sameAddress = normalizeAddress(input.address) === normalizeAddress(result.address);
    const closeCoordinates = input.latitude != null && input.longitude != null
      && distanceMeters(input.latitude, input.longitude, result.latitude, result.longitude) <= 100;
    return { matchedName, sameAddress, closeCoordinates, mapped: mapCategory(result.category, input.terminalSlugs) };
  });
  const verified = candidates.filter((candidate) => candidate.matchedName && (candidate.sameAddress || candidate.closeCoordinates));
  if (verified.length > 1) return naverDecision("AMBIGUOUS", null);
  if (verified.length === 1) {
    const candidate = verified[0];
    const evidenceCodes: NaverEvidenceCode[] = [
      candidate.matchedName === "EXACT" ? "NAVER_EXACT_NAME" : "NAVER_BRANCH_NORMALIZED_NAME",
      candidate.sameAddress ? "NAVER_EXACT_ADDRESS" : "NAVER_COORDINATES_WITHIN_100M",
      candidate.mapped ? "NAVER_SPECIFIC_CATEGORY" : "NAVER_BROAD_CATEGORY",
    ];
    return naverDecision("VERIFIED", candidate.mapped?.slug ?? null, 60, candidate.mapped?.specificityScore ?? 0, evidenceCodes);
  }
  if (candidates.some((candidate) => candidate.matchedName)) return naverDecision("LIKELY", null);
  return naverDecision("NO_MATCH", null);
}

function authorityNaver(naver: NaverLocalCategoryMatch, confidenceScore: number, evidenceCodes = naver.evidenceCodes) {
  return { ...naver, confidenceScore, evidenceCodes };
}

/**
 * Applies the evidence ordering: exclusion happens before this function,
 * verified + specific NAVER data may lead, while broad data remains
 * supportive only. Concrete source subtype conflicts are manual-review
 * decisions rather than automatic overwrites.
 */
export function decideCategoryAuthority(input: {
  rule: CandidateClassification;
  subtypeSlug: string | null;
  nameSlug: string | null;
  naver: NaverLocalCategoryMatch | null;
}): CategoryAuthorityDecision {
  const fallback: CategoryAuthorityDecision = {
    categorySlug: input.rule.categorySlug,
    confidence: input.rule.confidence,
    confidenceScore: input.rule.confidenceScore,
    automatic: false,
    reasons: input.rule.reasons,
    naver: input.naver ? authorityNaver(input.naver, input.rule.confidenceScore) : null,
  };
  const naver = input.naver;
  if (!naver || naver.status !== "VERIFIED" || !naver.mappedCategorySlug) return fallback;

  const evidenceCodes = [...naver.evidenceCodes];
  if (input.subtypeSlug && input.subtypeSlug !== naver.mappedCategorySlug) {
    evidenceCodes.push("SOURCE_SUBTYPE_CONFLICT");
    return {
      ...fallback,
      confidence: "CONFLICT",
      automatic: false,
      reasons: ["NAVER 구체 카테고리와 원천 업태가 다름", ...fallback.reasons],
      naver: authorityNaver(naver, input.rule.confidenceScore, evidenceCodes),
    };
  }

  let confidenceScore = naver.matchScore + naver.specificityScore;
  if (input.subtypeSlug === naver.mappedCategorySlug) {
    confidenceScore += 20;
    evidenceCodes.push("SOURCE_SUBTYPE_MATCH");
  }
  if (input.nameSlug === naver.mappedCategorySlug) {
    confidenceScore += 10;
    evidenceCodes.push("NAME_FOOD_MATCH");
  }
  confidenceScore = Math.min(100, confidenceScore);
  const confidence: ClassificationConfidence = confidenceScore >= 80 ? "HIGH"
    : confidenceScore >= 65 ? "MEDIUM"
      : "LOW";
  return {
    categorySlug: naver.mappedCategorySlug,
    confidence,
    confidenceScore,
    automatic: confidence === "HIGH",
    reasons: ["NAVER 상호·위치 검증", ...evidenceCodes],
    naver: authorityNaver(naver, confidenceScore, evidenceCodes),
  };
}
