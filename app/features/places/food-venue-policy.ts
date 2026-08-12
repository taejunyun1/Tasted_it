type VenueRule = {
  term: string;
  matchedRule: string;
};

const subtypeRules: VenueRule[] = [
  { term: "유흥주점영업", matchedRule: "SUBTYPE_ADULT_BAR" },
  { term: "단란주점영업", matchedRule: "SUBTYPE_KARAOKE_BAR" },
  { term: "무도유흥주점업", matchedRule: "SUBTYPE_DANCE_BAR" },
  { term: "무도장운영업", matchedRule: "SUBTYPE_DANCE_HALL" },
  { term: "고고(디스코)클럽", matchedRule: "SUBTYPE_DANCE_CLUB" },
  { term: "카바레", matchedRule: "SUBTYPE_CABARET" },
  { term: "캬바레", matchedRule: "SUBTYPE_CABARET" },
  { term: "노래연습장업", matchedRule: "SUBTYPE_KARAOKE" },
];

const nameRules: VenueRule[] = [
  { term: "룸살롱", matchedRule: "NAME_ROOM_SALON" },
  { term: "룸싸롱", matchedRule: "NAME_ROOM_SALON" },
  { term: "라이브바", matchedRule: "NAME_LIVE_BAR" },
  { term: "라이브bar", matchedRule: "NAME_LIVE_BAR" },
  { term: "라이브클럽", matchedRule: "NAME_LIVE_CLUB" },
  { term: "카바레", matchedRule: "NAME_CABARET" },
  { term: "캬바레", matchedRule: "NAME_CABARET" },
  { term: "콜라텍", matchedRule: "NAME_COLATHEQUE" },
  { term: "가라오케", matchedRule: "NAME_KARAOKE" },
  { term: "노래방", matchedRule: "NAME_KARAOKE" },
  { term: "노래타운", matchedRule: "NAME_KARAOKE" },
  { term: "뮤직타운", matchedRule: "NAME_KARAOKE" },
  { term: "나이트클럽", matchedRule: "NAME_NIGHT_CLUB" },
  { term: "성인나이트", matchedRule: "NAME_NIGHT_CLUB" },
  { term: "관광나이트", matchedRule: "NAME_NIGHT_CLUB" },
  { term: "단란주점", matchedRule: "NAME_KARAOKE_BAR" },
];

function normalizeVenueText(value: string | null | undefined) {
  return value?.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s/g, "") ?? "";
}

export const NON_RESTAURANT_PUBLIC_NAME_TERMS = [...new Set(nameRules.map((rule) => rule.term))];

export function matchNonRestaurantVenue(input: {
  businessName: string;
  businessSubtype: string | null;
}) {
  const normalizedSubtype = normalizeVenueText(input.businessSubtype);
  const subtypeMatch = subtypeRules.find((rule) => normalizedSubtype.includes(rule.term));
  if (subtypeMatch) {
    return { matchedRule: subtypeMatch.matchedRule, matchMethod: "SUBTYPE_EXACT", confidence: 1 };
  }

  const normalizedName = normalizeVenueText(input.businessName);
  const nameMatch = nameRules.find((rule) => normalizedName.includes(rule.term));
  if (!nameMatch) return null;
  return { matchedRule: nameMatch.matchedRule, matchMethod: "NAME_CONTAINS", confidence: 1 };
}
