import type { PublicDataSource } from "./public-data";

export type ClassificationConfidence = "HIGH" | "MEDIUM" | "LOW" | "CONFLICT";

export interface CandidateClassification {
  categorySlug: string;
  candidateSlugs: string[];
  confidence: ClassificationConfidence;
  neighborhood: string | null;
  reasons: string[];
}

type CategoryGroup = "korean" | "seafood" | "japanese" | "chinese" | "western" | "bunsik" | "chicken" | "world" | "cafe" | "bar" | "healthy" | "other";
type SignalKind = "FOOD" | "CUISINE" | "VENUE" | "DEFAULT";
type SignalOrigin = "NAME" | "SUBTYPE" | "SOURCE";

type Rule = {
  pattern: RegExp;
  slug: string;
  group: CategoryGroup;
  label: string;
  kind: SignalKind;
  priority?: number;
};

type Signal = Rule & { score: number; origin: SignalOrigin };

const nameRules: Rule[] = [
  { pattern: /(?<!자)연어|장어|킹크랩|크랩|대게|꽃게|홍게|랍스터|바닷가재|전복|굴(?:밥|국밥|구이|전|찜|탕|보쌈|세상|나라|마을|집|요리|전문|향|$)|꼬막|조개|가리비|낙지|주꾸미|쭈꾸미|문어|오징어|갑오징어|아귀|아구|생선|고등어|갈치|복어|복집|물회|해물|해산물|횟집|회집|사시미/, slug: "seafood-dish", group: "seafood", label: "상호의 해산물·생선 음식 표현", kind: "FOOD", priority: 25 },
  { pattern: /해장국|순대국|돼지국밥|국밥|설렁탕|곰탕/, slug: "gukbap-detail", group: "korean", label: "상호의 국밥·해장국·탕반 표현", kind: "FOOD" },
  { pattern: /육개장|찌개|전골|감자탕/, slug: "stew", group: "korean", label: "상호의 육계장·육개장·찌개·전골 표현", kind: "FOOD" },
  { pattern: /삼겹|갈비|구이|고기|정육/, slug: "grill", group: "korean", label: "상호의 고기·구이 표현", kind: "FOOD" },
  { pattern: /족발|보쌈/, slug: "jokbal-bossam", group: "korean", label: "상호의 족발·보쌈 표현", kind: "FOOD" },
  { pattern: /한정식/, slug: "hanjeongsik", group: "korean", label: "상호의 한정식 표현", kind: "FOOD" },
  { pattern: /스시|초밥/, slug: "sushi-sashimi", group: "japanese", label: "상호의 스시·초밥 표현", kind: "FOOD" },
  { pattern: /라멘|멘야/, slug: "ramen-detail", group: "japanese", label: "상호의 라멘 표현", kind: "FOOD" },
  { pattern: /우동|소바/, slug: "udon-soba", group: "japanese", label: "상호의 우동·소바 표현", kind: "FOOD" },
  { pattern: /돈가스|돈까스/, slug: "donkatsu-detail", group: "japanese", label: "상호의 돈가스 표현", kind: "FOOD" },
  { pattern: /타코야끼|타코야키/, slug: "japanese-rice", group: "japanese", label: "상호의 타코야끼 표현", kind: "FOOD" },
  { pattern: /이자카야/, slug: "izakaya", group: "japanese", label: "상호의 이자카야 표현", kind: "VENUE" },
  { pattern: /짜장|짬뽕/, slug: "jjajang-jjamppong", group: "chinese", label: "상호의 짜장·짬뽕 표현", kind: "FOOD" },
  { pattern: /마라|훠궈/, slug: "mala-hotpot", group: "chinese", label: "상호의 마라·훠궈 표현", kind: "FOOD" },
  { pattern: /양꼬치/, slug: "lamb-skewer", group: "chinese", label: "상호의 양꼬치 표현", kind: "FOOD" },
  { pattern: /파스타/, slug: "pasta", group: "western", label: "상호의 파스타 표현", kind: "FOOD" },
  { pattern: /스테이크/, slug: "steak", group: "western", label: "상호의 스테이크 표현", kind: "FOOD" },
  { pattern: /피자/, slug: "pizza", group: "western", label: "상호의 피자 표현", kind: "FOOD" },
  { pattern: /햄버거|버거/, slug: "burger", group: "western", label: "상호의 버거 표현", kind: "FOOD" },
  { pattern: /브런치/, slug: "brunch", group: "western", label: "상호의 브런치 표현", kind: "FOOD" },
  { pattern: /떡볶이|튀김/, slug: "tteokbokki", group: "bunsik", label: "상호의 떡볶이·튀김 표현", kind: "FOOD" },
  { pattern: /김밥/, slug: "gimbap", group: "bunsik", label: "상호의 김밥 표현", kind: "FOOD" },
  { pattern: /만두/, slug: "dumpling", group: "bunsik", label: "상호의 만두 표현", kind: "FOOD" },
  { pattern: /치킨|통닭|닭강정/, slug: "chicken", group: "chicken", label: "상호의 치킨·통닭 표현", kind: "FOOD" },
  { pattern: /쌀국수|베트남/, slug: "vietnamese", group: "world", label: "상호의 베트남 음식 표현", kind: "FOOD" },
  { pattern: /태국|타이/, slug: "thai", group: "world", label: "상호의 태국 음식 표현", kind: "FOOD" },
  { pattern: /인도|인디아|(?<!베이)커리/, slug: "indian", group: "world", label: "상호의 인도 음식 표현", kind: "FOOD" },
  { pattern: /멕시칸|타코(?!야끼|야키)/, slug: "mexican", group: "world", label: "상호의 멕시칸 표현", kind: "FOOD" },
  { pattern: /제과|제빵|베이커리|빵집|빵쇼핑|바게뜨|바게트|식빵|케이크|도넛|도너츠|크루아상|쿠키|과자점/, slug: "bakery-detail", group: "cafe", label: "상호의 제과·제빵·베이커리 표현", kind: "FOOD" },
  { pattern: /아이스크림|빙수/, slug: "ice-dessert", group: "cafe", label: "상호의 아이스크림·빙수 표현", kind: "FOOD" },
  { pattern: /디저트/, slug: "dessert", group: "cafe", label: "상호의 디저트 표현", kind: "FOOD" },
  { pattern: /라이브카페|라이브바|음악주점|7080라이브|라이브클럽/, slug: "pub", group: "bar", label: "상호의 라이브·음악 주점 표현", kind: "VENUE", priority: 40 },
  { pattern: /카페|커피|다방/, slug: "cafe", group: "cafe", label: "상호의 카페 표현", kind: "VENUE" },
  { pattern: /와인/, slug: "wine-bar", group: "bar", label: "상호의 와인 표현", kind: "VENUE" },
  { pattern: /칵테일/, slug: "cocktail-bar", group: "bar", label: "상호의 칵테일 표현", kind: "VENUE" },
  { pattern: /포차|소주/, slug: "pocha", group: "bar", label: "상호의 포차 표현", kind: "VENUE" },
  { pattern: /호프|펍|맥주/, slug: "pub", group: "bar", label: "상호의 호프·펍 표현", kind: "VENUE" },
  { pattern: /샐러드/, slug: "salad", group: "healthy", label: "상호의 샐러드 표현", kind: "FOOD" },
  { pattern: /비건|채식/, slug: "vegan", group: "healthy", label: "상호의 비건·채식 표현", kind: "FOOD" },
];

const subtypeRules: Rule[] = [
  { pattern: /횟집|회집|해산물|수산|생선|회센터/, slug: "seafood-dish", group: "seafood", label: "원천 업태의 해산물·생선 표현", kind: "FOOD" },
  { pattern: /해장국|순대국|돼지국밥|국밥|설렁탕|곰탕/, slug: "gukbap-detail", group: "korean", label: "원천 업태의 국밥·해장국·탕반 표현", kind: "FOOD" },
  { pattern: /육개장|찌개|전골|감자탕/, slug: "stew", group: "korean", label: "원천 업태의 찌개·전골·탕 표현", kind: "FOOD" },
  { pattern: /치킨|통닭|닭강정/, group: "chicken", slug: "chicken", label: "원천 업태의 치킨·통닭 표현", kind: "FOOD" },
  { pattern: /한식/, group: "korean", slug: "home-meal", label: "원천 업태의 한식 표현", kind: "CUISINE" },
  { pattern: /일식/, group: "japanese", slug: "japanese-rice", label: "원천 업태의 일식 표현", kind: "CUISINE" },
  { pattern: /중국|중식/, group: "chinese", slug: "chinese-dish", label: "원천 업태의 중식 표현", kind: "CUISINE" },
  { pattern: /경양식|양식/, group: "western", slug: "pasta", label: "원천 업태의 양식 표현", kind: "CUISINE" },
  { pattern: /분식/, group: "bunsik", slug: "tteokbokki", label: "원천 업태의 분식 표현", kind: "CUISINE" },
  { pattern: /커피|카페|다방/, group: "cafe", slug: "cafe", label: "원천 업태의 카페 표현", kind: "VENUE" },
  { pattern: /제과|제빵|베이커리|과자점/, group: "cafe", slug: "bakery-detail", label: "원천 업태의 제과·제빵 표현", kind: "FOOD" },
  { pattern: /호프|주점|펍|유흥|라이브|음악/, group: "bar", slug: "pub", label: "원천 업태의 호프·주점 표현", kind: "VENUE" },
];

const defaults: Record<PublicDataSource, { slug: string; group: CategoryGroup }> = {
  GENERAL_RESTAURANT: { slug: "home-meal", group: "korean" },
  REST_CAFE: { slug: "cafe", group: "cafe" },
  BAKERY: { slug: "bakery-detail", group: "cafe" },
  ENTERTAINMENT_BAR: { slug: "pub", group: "bar" },
};

export function extractNeighborhood(address: string | null | undefined) {
  if (!address) return null;
  const isNeighborhood = (token: string) => /(?:동|읍|면|리)$/.test(token);
  const parenthesized = [...address.matchAll(/\(([^)]*)\)/g)].flatMap((match) => match[1].split(/[·,\s]+/)).find(isNeighborhood);
  if (parenthesized) return parenthesized;
  const tokens = address.split(/[·,()\s]+/).filter(isNeighborhood);
  return tokens.find((token) => token.endsWith("리")) ?? tokens.at(-1) ?? null;
}

export function normalizeBusinessName(value: string) {
  return value.normalize("NFKC").replace(/[\s·.,()\-_&]/g, "").replaceAll("육계장", "육개장").replaceAll("타코야키", "타코야끼");
}

function signalScore(origin: SignalOrigin, kind: SignalKind, priority = 0) {
  if (origin === "NAME") return (kind === "FOOD" ? 100 : 55) + priority;
  if (origin === "SUBTYPE") return (kind === "FOOD" ? 70 : kind === "CUISINE" ? 30 : 20) + priority;
  return 5;
}

function collectSignals(input: { sourceType: PublicDataSource; businessSubtype?: string | null; businessName: string }) {
  const normalizedName = normalizeBusinessName(input.businessName);
  const subtype = input.businessSubtype?.normalize("NFKC").trim() ?? "";
  const signals: Signal[] = [
    ...nameRules.filter((rule) => rule.pattern.test(normalizedName)).map((rule) => ({ ...rule, origin: "NAME" as const, score: signalScore("NAME", rule.kind, rule.priority) })),
    ...subtypeRules.filter((rule) => rule.pattern.test(subtype)).map((rule) => ({ ...rule, origin: "SUBTYPE" as const, score: signalScore("SUBTYPE", rule.kind, rule.priority) })),
  ];
  const fallback = defaults[input.sourceType];
  signals.push({ pattern: /(?:)/, slug: fallback.slug, group: fallback.group, label: "공공데이터 종류의 기본 분류", kind: "DEFAULT", origin: "SOURCE", score: 5 });
  return signals;
}

function rankSignals(signals: Signal[]) {
  const bySlug = new Map<string, Signal>();
  for (const signal of signals) {
    const current = bySlug.get(signal.slug);
    if (!current || signal.score > current.score) bySlug.set(signal.slug, signal);
  }
  return [...bySlug.values()].sort((left, right) => right.score - left.score);
}

export function classifyCandidate(input: {
  sourceType: PublicDataSource;
  businessSubtype?: string | null;
  businessName: string;
  address?: string | null;
}): CandidateClassification {
  const signals = collectSignals(input);
  const ranked = rankSignals(signals);
  const primary = ranked[0];
  const neighborhood = extractNeighborhood(input.address);
  const nameFoodSignals = rankSignals(signals.filter((signal) => signal.origin === "NAME" && signal.kind === "FOOD"));
  const subtypeCuisine = signals.find((signal) => signal.origin === "SUBTYPE" && signal.kind === "CUISINE");
  const hasFoodConflict = nameFoodSignals.length > 1 && nameFoodSignals[0].score === nameFoodSignals[1].score;
  const isCrossCuisineSeafood = primary.group === "seafood";
  const hasCuisineConflict = primary.origin === "NAME" && primary.kind === "FOOD" && subtypeCuisine != null && subtypeCuisine.group !== primary.group && !isCrossCuisineSeafood;
  const hasSubtypeSupport = signals.some((signal) => signal.origin === "SUBTYPE" && signal.group === primary.group && signal.kind !== "DEFAULT")
    || (isCrossCuisineSeafood && subtypeCuisine != null);
  const confidence: ClassificationConfidence = hasFoodConflict || hasCuisineConflict
    ? "CONFLICT"
    : primary.score <= 5
      ? "LOW"
      : primary.origin === "NAME" && hasSubtypeSupport
        ? "HIGH"
        : "MEDIUM";
  const reasons = signals
    .filter((signal) => signal.slug === primary.slug || (hasFoodConflict && signal.origin === "NAME" && signal.kind === "FOOD"))
    .sort((left, right) => right.score - left.score)
    .map((signal) => `${signal.label} (${signal.score}점)`);
  if (hasFoodConflict) reasons.push("상호에 서로 다른 구체 음식 신호가 함께 있음");
  if (hasCuisineConflict) reasons.push(`구체 음식 신호가 원천 업태(${input.businessSubtype})와 불일치`);
  if (primary.kind === "FOOD" && ranked.some((signal) => signal.kind === "VENUE" && signal.score < primary.score)) reasons.push("구체 음식 신호를 영업 형태보다 우선 적용");
  return {
    categorySlug: primary.slug,
    candidateSlugs: ranked.slice(0, 4).map((signal) => signal.slug),
    confidence,
    neighborhood,
    reasons,
  };
}

export function suggestCategorySlugs(sourceType: PublicDataSource, subtype: string | null | undefined) {
  return classifyCandidate({ sourceType, businessSubtype: subtype, businessName: "" }).candidateSlugs;
}
