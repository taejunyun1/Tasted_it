import type { PublicDataSource } from "./public-data";

export type ClassificationConfidence = "HIGH" | "MEDIUM" | "LOW" | "CONFLICT";

export interface CandidateClassification {
  categorySlug: string;
  confidence: ClassificationConfidence;
  neighborhood: string | null;
  reasons: string[];
}

type CategoryGroup = "korean" | "japanese" | "chinese" | "western" | "bunsik" | "chicken" | "world" | "cafe" | "bar" | "healthy" | "other";

const nameRules: Array<{ pattern: RegExp; slug: string; group: CategoryGroup; label: string }> = [
  { pattern: /해장국|국밥/, slug: "gukbap-detail", group: "korean", label: "상호의 국밥·해장국 표현" },
  { pattern: /찌개|전골|감자탕|설렁탕|곰탕/, slug: "stew", group: "korean", label: "상호의 찌개·탕 표현" },
  { pattern: /삼겹|갈비|구이|고기|정육/, slug: "grill", group: "korean", label: "상호의 고기·구이 표현" },
  { pattern: /족발|보쌈/, slug: "jokbal-bossam", group: "korean", label: "상호의 족발·보쌈 표현" },
  { pattern: /한정식/, slug: "hanjeongsik", group: "korean", label: "상호의 한정식 표현" },
  { pattern: /스시|초밥|횟집|회집|사시미/, slug: "sushi-sashimi", group: "japanese", label: "상호의 초밥·회 표현" },
  { pattern: /라멘|멘야/, slug: "ramen-detail", group: "japanese", label: "상호의 라멘 표현" },
  { pattern: /우동|소바/, slug: "udon-soba", group: "japanese", label: "상호의 우동·소바 표현" },
  { pattern: /돈가스|돈까스/, slug: "donkatsu-detail", group: "japanese", label: "상호의 돈가스 표현" },
  { pattern: /이자카야/, slug: "izakaya", group: "japanese", label: "상호의 이자카야 표현" },
  { pattern: /짜장|짬뽕/, slug: "jjajang-jjamppong", group: "chinese", label: "상호의 짜장·짬뽕 표현" },
  { pattern: /마라|훠궈/, slug: "mala-hotpot", group: "chinese", label: "상호의 마라·훠궈 표현" },
  { pattern: /양꼬치/, slug: "lamb-skewer", group: "chinese", label: "상호의 양꼬치 표현" },
  { pattern: /파스타/, slug: "pasta", group: "western", label: "상호의 파스타 표현" },
  { pattern: /스테이크/, slug: "steak", group: "western", label: "상호의 스테이크 표현" },
  { pattern: /피자/, slug: "pizza", group: "western", label: "상호의 피자 표현" },
  { pattern: /햄버거|버거/, slug: "burger", group: "western", label: "상호의 버거 표현" },
  { pattern: /브런치/, slug: "brunch", group: "western", label: "상호의 브런치 표현" },
  { pattern: /떡볶이|튀김/, slug: "tteokbokki", group: "bunsik", label: "상호의 떡볶이·튀김 표현" },
  { pattern: /김밥/, slug: "gimbap", group: "bunsik", label: "상호의 김밥 표현" },
  { pattern: /만두/, slug: "dumpling", group: "bunsik", label: "상호의 만두 표현" },
  { pattern: /치킨|통닭/, slug: "chicken", group: "chicken", label: "상호의 치킨 표현" },
  { pattern: /쌀국수|베트남/, slug: "vietnamese", group: "world", label: "상호의 베트남 음식 표현" },
  { pattern: /태국|타이/, slug: "thai", group: "world", label: "상호의 태국 음식 표현" },
  { pattern: /인도|인디아|커리/, slug: "indian", group: "world", label: "상호의 인도 음식 표현" },
  { pattern: /멕시칸|타코/, slug: "mexican", group: "world", label: "상호의 멕시칸 표현" },
  { pattern: /제과|베이커리|빵집/, slug: "bakery-detail", group: "cafe", label: "상호의 베이커리 표현" },
  { pattern: /아이스크림|빙수/, slug: "ice-dessert", group: "cafe", label: "상호의 아이스크림·빙수 표현" },
  { pattern: /디저트|케이크/, slug: "dessert", group: "cafe", label: "상호의 디저트 표현" },
  { pattern: /카페|커피|다방/, slug: "cafe", group: "cafe", label: "상호의 카페 표현" },
  { pattern: /와인/, slug: "wine-bar", group: "bar", label: "상호의 와인 표현" },
  { pattern: /칵테일/, slug: "cocktail-bar", group: "bar", label: "상호의 칵테일 표현" },
  { pattern: /포차|소주/, slug: "pocha", group: "bar", label: "상호의 포차 표현" },
  { pattern: /호프|펍|맥주/, slug: "pub", group: "bar", label: "상호의 호프·펍 표현" },
  { pattern: /샐러드/, slug: "salad", group: "healthy", label: "상호의 샐러드 표현" },
  { pattern: /비건|채식/, slug: "vegan", group: "healthy", label: "상호의 비건·채식 표현" },
];

const subtypeRules: Array<{ pattern: RegExp; group: CategoryGroup; slug: string }> = [
  { pattern: /한식/, group: "korean", slug: "home-meal" },
  { pattern: /일식/, group: "japanese", slug: "japanese-rice" },
  { pattern: /중국|중식/, group: "chinese", slug: "chinese-dish" },
  { pattern: /경양식|양식/, group: "western", slug: "pasta" },
  { pattern: /분식/, group: "bunsik", slug: "tteokbokki" },
  { pattern: /커피|카페|다방/, group: "cafe", slug: "cafe" },
  { pattern: /제과|베이커리/, group: "cafe", slug: "bakery-detail" },
  { pattern: /호프|주점/, group: "bar", slug: "pub" },
  { pattern: /치킨|통닭/, group: "chicken", slug: "chicken" },
];

const defaults: Record<PublicDataSource, string> = {
  GENERAL_RESTAURANT: "home-meal",
  REST_CAFE: "cafe",
  BAKERY: "bakery-detail",
  ENTERTAINMENT_BAR: "pub",
};

export function extractNeighborhood(address: string | null | undefined) {
  if (!address) return null;
  const parenthesized = [...address.matchAll(/\(([^)]*)\)/g)]
    .flatMap((match) => match[1].split(/[·,\s]+/))
    .find((token) => /(?:동|읍|면)$/.test(token));
  if (parenthesized) return parenthesized;
  return address.split(/[·,()\s]+/).find((token) => /(?:동|읍|면)$/.test(token)) ?? null;
}

export function classifyCandidate(input: {
  sourceType: PublicDataSource;
  businessSubtype?: string | null;
  businessName: string;
  address?: string | null;
}): CandidateClassification {
  const nameRule = nameRules.find((rule) => rule.pattern.test(input.businessName));
  const subtypeRule = subtypeRules.find((rule) => rule.pattern.test(input.businessSubtype?.trim() ?? ""));
  const neighborhood = extractNeighborhood(input.address);

  if (nameRule && subtypeRule) {
    const conflict = nameRule.group !== subtypeRule.group;
    return {
      categorySlug: nameRule.slug,
      confidence: conflict ? "CONFLICT" : "HIGH",
      neighborhood,
      reasons: [nameRule.label, conflict ? `원천 업태(${input.businessSubtype})와 불일치` : `원천 업태(${input.businessSubtype})와 일치`],
    };
  }
  if (nameRule) return { categorySlug: nameRule.slug, confidence: "MEDIUM", neighborhood, reasons: [nameRule.label] };
  if (subtypeRule) return { categorySlug: subtypeRule.slug, confidence: "MEDIUM", neighborhood, reasons: [`원천 업태(${input.businessSubtype}) 기준`] };
  return { categorySlug: defaults[input.sourceType], confidence: "LOW", neighborhood, reasons: ["공공데이터 종류의 기본 분류만 적용"] };
}

export function suggestCategorySlugs(sourceType: PublicDataSource, subtype: string | null | undefined) {
  return [classifyCandidate({ sourceType, businessSubtype: subtype, businessName: "" }).categorySlug];
}
