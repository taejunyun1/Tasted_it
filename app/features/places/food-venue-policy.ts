type VenueRule = {
  term: string;
  matchedRule: string;
  exclusionCategory: "ADULT_ENTERTAINMENT" | "NOT_RESTAURANT";
};

export type FoodVenueDecision =
  | { decision: "ALLOW" }
  | { decision: "EXCLUDE"; category: "ADULT_ENTERTAINMENT" | "NOT_RESTAURANT"; matchedRule: string; matchMethod: string; confidence: number };

const subtypeRules: VenueRule[] = [
  { term: "유흥주점영업", matchedRule: "SUBTYPE_ADULT_BAR", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "단란주점영업", matchedRule: "SUBTYPE_KARAOKE_BAR", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "무도유흥주점업", matchedRule: "SUBTYPE_DANCE_BAR", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "무도장운영업", matchedRule: "SUBTYPE_DANCE_HALL", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "고고(디스코)클럽", matchedRule: "SUBTYPE_DANCE_CLUB", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "카바레", matchedRule: "SUBTYPE_CABARET", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "캬바레", matchedRule: "SUBTYPE_CABARET", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "노래연습장업", matchedRule: "SUBTYPE_KARAOKE", exclusionCategory: "ADULT_ENTERTAINMENT" },
];

const nameRules: VenueRule[] = [
  { term: "룸살롱", matchedRule: "NAME_ROOM_SALON", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "룸싸롱", matchedRule: "NAME_ROOM_SALON", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "라이브바", matchedRule: "NAME_LIVE_BAR", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "라이브bar", matchedRule: "NAME_LIVE_BAR", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "라이브클럽", matchedRule: "NAME_LIVE_CLUB", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "카바레", matchedRule: "NAME_CABARET", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "캬바레", matchedRule: "NAME_CABARET", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "콜라텍", matchedRule: "NAME_COLATHEQUE", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "가라오케", matchedRule: "NAME_KARAOKE", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "노래방", matchedRule: "NAME_KARAOKE", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "노래타운", matchedRule: "NAME_KARAOKE", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "뮤직타운", matchedRule: "NAME_KARAOKE", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "나이트클럽", matchedRule: "NAME_NIGHT_CLUB", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "성인나이트", matchedRule: "NAME_NIGHT_CLUB", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "관광나이트", matchedRule: "NAME_NIGHT_CLUB", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "단란주점", matchedRule: "NAME_KARAOKE_BAR", exclusionCategory: "ADULT_ENTERTAINMENT" },
  { term: "라이브카페", matchedRule: "NAME_LIVE_CAFE", exclusionCategory: "NOT_RESTAURANT" },
  { term: "pc방", matchedRule: "NAME_PC_BANG", exclusionCategory: "NOT_RESTAURANT" },
  { term: "피씨방", matchedRule: "NAME_PC_BANG", exclusionCategory: "NOT_RESTAURANT" },
  { term: "피시방", matchedRule: "NAME_PC_BANG", exclusionCategory: "NOT_RESTAURANT" },
  { term: "도자기공방", matchedRule: "NAME_CERAMIC_WORKSHOP", exclusionCategory: "NOT_RESTAURANT" },
  { term: "가죽공방", matchedRule: "NAME_LEATHER_WORKSHOP", exclusionCategory: "NOT_RESTAURANT" },
  { term: "목공방", matchedRule: "NAME_WOOD_WORKSHOP", exclusionCategory: "NOT_RESTAURANT" },
  { term: "향수공방", matchedRule: "NAME_PERFUME_WORKSHOP", exclusionCategory: "NOT_RESTAURANT" },
  { term: "캔들공방", matchedRule: "NAME_CANDLE_WORKSHOP", exclusionCategory: "NOT_RESTAURANT" },
  { term: "비누공방", matchedRule: "NAME_SOAP_WORKSHOP", exclusionCategory: "NOT_RESTAURANT" },
  { term: "꽃공방", matchedRule: "NAME_FLOWER_WORKSHOP", exclusionCategory: "NOT_RESTAURANT" },
  { term: "플라워공방", matchedRule: "NAME_FLOWER_WORKSHOP", exclusionCategory: "NOT_RESTAURANT" },
  { term: "미술공방", matchedRule: "NAME_ART_WORKSHOP", exclusionCategory: "NOT_RESTAURANT" },
  { term: "원데이클래스", matchedRule: "NAME_ONE_DAY_CLASS", exclusionCategory: "NOT_RESTAURANT" },
  { term: "공예방", matchedRule: "NAME_CRAFT_STUDIO", exclusionCategory: "NOT_RESTAURANT" },
];

const namePrefixRules: VenueRule[] = [
  { term: "cu", matchedRule: "NAME_CONVENIENCE_CU", exclusionCategory: "NOT_RESTAURANT" },
  { term: "gs25", matchedRule: "NAME_CONVENIENCE_GS25", exclusionCategory: "NOT_RESTAURANT" },
  { term: "세븐일레븐", matchedRule: "NAME_CONVENIENCE_7ELEVEN", exclusionCategory: "NOT_RESTAURANT" },
  { term: "seveneleven", matchedRule: "NAME_CONVENIENCE_7ELEVEN", exclusionCategory: "NOT_RESTAURANT" },
  { term: "이마트24", matchedRule: "NAME_CONVENIENCE_EMART24", exclusionCategory: "NOT_RESTAURANT" },
  { term: "emart24", matchedRule: "NAME_CONVENIENCE_EMART24", exclusionCategory: "NOT_RESTAURANT" },
  { term: "미니스톱", matchedRule: "NAME_CONVENIENCE_MINISTOP", exclusionCategory: "NOT_RESTAURANT" },
  { term: "ministop", matchedRule: "NAME_CONVENIENCE_MINISTOP", exclusionCategory: "NOT_RESTAURANT" },
];

function normalizeVenueText(value: string | null | undefined) {
  return value?.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s/g, "") ?? "";
}

export const NON_RESTAURANT_PUBLIC_NAME_TERMS = [...new Set([
  ...nameRules.map((rule) => rule.term),
  "라이브ＢＡＲ",
  "라이브ｂａｒ",
])];
// CU needs a token boundary: a broad `cu*` prefix would incorrectly hide names
// such as "Curry ...". The matching rule is shared below with the SQL layer.
export const CU_CONVENIENCE_PREFIX = "cu";
export const NON_RESTAURANT_PUBLIC_NAME_PREFIXES = [...new Set(namePrefixRules.filter((rule) => rule.term !== CU_CONVENIENCE_PREFIX).map((rule) => rule.term))];
export const NON_RESTAURANT_SOURCE_SUBTYPE_TERMS = [...new Set(subtypeRules.map((rule) => rule.term))];

export function matchNonRestaurantVenue(input: {
  businessName: string;
  businessSubtype: string | null;
}) {
  const normalizedSubtype = normalizeVenueText(input.businessSubtype);
  const subtypeMatch = subtypeRules.find((rule) => normalizedSubtype.includes(rule.term));
  if (subtypeMatch) {
    return { matchedRule: subtypeMatch.matchedRule, exclusionCategory: subtypeMatch.exclusionCategory, matchMethod: "SUBTYPE_CONTAINS", confidence: 1 };
  }

  const normalizedName = normalizeVenueText(input.businessName);
  const nameMatch = nameRules.find((rule) => normalizedName.includes(rule.term));
  if (nameMatch) return { matchedRule: nameMatch.matchedRule, exclusionCategory: nameMatch.exclusionCategory, matchMethod: "NAME_CONTAINS", confidence: 1 };

  const prefixMatch = namePrefixRules.find((rule) => rule.term === CU_CONVENIENCE_PREFIX
    ? normalizedName === CU_CONVENIENCE_PREFIX || /^cu(?:[가-힣]|\d)/.test(normalizedName)
    : normalizedName.startsWith(rule.term));
  if (!prefixMatch) return null;
  return { matchedRule: prefixMatch.matchedRule, exclusionCategory: prefixMatch.exclusionCategory, matchMethod: "NAME_PREFIX", confidence: 1 };
}

export function classifyFoodVenue(input: { businessName: string; businessSubtype: string | null }): FoodVenueDecision {
  const matched = matchNonRestaurantVenue(input);
  if (!matched) return { decision: "ALLOW" };
  return {
    decision: "EXCLUDE",
    category: matched.exclusionCategory,
    matchedRule: matched.matchedRule,
    matchMethod: matched.matchMethod,
    confidence: matched.confidence,
  };
}
