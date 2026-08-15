import type { CategoryEvidenceLevel, PlaceTrait } from "./category-v5.types";

export type CategoryV5Rule = {
  code: string;
  pattern: RegExp;
  slug: string;
  level: CategoryEvidenceLevel;
  kind: "FOOD" | "INGREDIENT_METHOD" | "VENUE" | "CUISINE";
  traits?: PlaceTrait[];
};

/**
 * This is intentionally separate from the v4 taxonomy. V4 keeps serving the
 * public taxonomy while v5 is evaluated in shadow mode.
 */
export const categoryV5NameRules: CategoryV5Rule[] = [
  { code: "NAME_GUKBAP", pattern: /해장국|순대국|돼지국밥|국밥|설렁탕|곰탕/, slug: "gukbap-detail", level: 1, kind: "FOOD", traits: ["quickMeal", "soloFriendly"] },
  { code: "NAME_STEW", pattern: /육개장|찌개|전골|감자탕/, slug: "stew", level: 1, kind: "FOOD", traits: ["groupFriendly"] },
  { code: "NAME_GRILL_MENU", pattern: /삼겹|갈비|떡갈비|불고기/, slug: "grill", level: 1, kind: "FOOD", traits: ["groupFriendly"] },
  { code: "NAME_SEAFOOD", pattern: /연어|장어|킹크랩|크랩|대게|꽃게|홍게|랍스터|전복|굴(?:밥|국밥|구이|전|찜|탕|보쌈|세상|나라|마을|집|요리|전문|향|$)|꼬막|조개|가리비|낙지|주꾸미|쭈꾸미|문어|오징어|갑오징어|아귀|아구|생선|고등어|갈치|복어|물회|해물|해산물|횟집|회집|사시미/, slug: "seafood-dish", level: 1, kind: "FOOD", traits: ["groupFriendly"] },
  { code: "NAME_SUSHI", pattern: /스시|초밥/, slug: "sushi-sashimi", level: 1, kind: "FOOD", traits: ["date"] },
  { code: "NAME_RAMEN", pattern: /라멘|멘야/, slug: "ramen-detail", level: 1, kind: "FOOD", traits: ["soloFriendly"] },
  { code: "NAME_UDON_SOBA", pattern: /우동|소바/, slug: "udon-soba", level: 1, kind: "FOOD", traits: ["soloFriendly"] },
  { code: "NAME_DONKATSU", pattern: /돈가스|돈까스/, slug: "donkatsu-detail", level: 1, kind: "FOOD", traits: ["soloFriendly"] },
  { code: "NAME_JJAJANG", pattern: /짜장|짬뽕/, slug: "jjajang-jjamppong", level: 1, kind: "FOOD", traits: ["quickMeal"] },
  { code: "NAME_MALA", pattern: /마라|훠궈/, slug: "mala-hotpot", level: 1, kind: "FOOD", traits: ["groupFriendly"] },
  { code: "NAME_PASTA", pattern: /파스타/, slug: "pasta", level: 1, kind: "FOOD", traits: ["date"] },
  { code: "NAME_PIZZA", pattern: /피자/, slug: "pizza", level: 1, kind: "FOOD", traits: ["groupFriendly"] },
  { code: "NAME_BURGER", pattern: /햄버거|버거/, slug: "burger", level: 1, kind: "FOOD", traits: ["quickMeal"] },
  { code: "NAME_GIMBAP", pattern: /김밥/, slug: "gimbap", level: 1, kind: "FOOD", traits: ["quickMeal", "soloFriendly"] },
  { code: "NAME_TTEOKBOKKI", pattern: /떡볶이|튀김|순대(?:분식|집|마을|나라|전문|$)/, slug: "tteokbokki", level: 1, kind: "FOOD", traits: ["quickMeal"] },
  { code: "NAME_CHICKEN", pattern: /치킨|통닭|닭강정/, slug: "chicken", level: 1, kind: "FOOD", traits: ["lateNight", "groupFriendly"] },
  { code: "NAME_BAKERY", pattern: /베이킹|제과|제빵|베이커리|브레드|브래드|빵집|꽈배기|바게뜨|바게트|식빵|케이크|도넛|도너츠|크루아상|쿠키|과자(?:점)?/, slug: "bakery-detail", level: 1, kind: "FOOD", traits: ["dessert"] },
  { code: "NAME_GRILL_METHOD", pattern: /숯불|화로|직화|구이|정육|식육/, slug: "grill", level: 2, kind: "INGREDIENT_METHOD", traits: ["groupFriendly"] },
  { code: "NAME_IZAKAYA", pattern: /이자카야/, slug: "izakaya", level: 3, kind: "VENUE", traits: ["alcoholFriendly", "lateNight"] },
  { code: "NAME_POCHA", pattern: /정종|대포집|소주방|포장마차|포차|소주/, slug: "pocha", level: 3, kind: "VENUE", traits: ["alcoholFriendly", "lateNight"] },
  { code: "NAME_PUB", pattern: /호프|펍|맥주|주점/, slug: "pub", level: 3, kind: "VENUE", traits: ["alcoholFriendly", "lateNight"] },
  { code: "NAME_CAFE", pattern: /카페|커피|다방/, slug: "cafe", level: 3, kind: "VENUE", traits: ["dessert", "date"] },
];

export const categoryV5SubtypeRules: CategoryV5Rule[] = [
  { code: "SUBTYPE_GRILL", pattern: /식육|숯불구이|불고기|갈비구이/, slug: "grill", level: 2, kind: "INGREDIENT_METHOD", traits: ["groupFriendly"] },
  { code: "SUBTYPE_SEAFOOD", pattern: /횟집|회집|해산물|수산|생선|회센터/, slug: "seafood-dish", level: 2, kind: "INGREDIENT_METHOD", traits: ["groupFriendly"] },
  { code: "SUBTYPE_GUKBAP", pattern: /해장국|순대국|돼지국밥|국밥|설렁탕|곰탕/, slug: "gukbap-detail", level: 2, kind: "INGREDIENT_METHOD", traits: ["quickMeal", "soloFriendly"] },
  { code: "SUBTYPE_POCHA", pattern: /정종|대포집|소주방|실내포장마차|포장마차|포차|소주/, slug: "pocha", level: 3, kind: "VENUE", traits: ["alcoholFriendly", "lateNight"] },
  { code: "SUBTYPE_PUB", pattern: /호프|주점|펍|유흥|음악/, slug: "pub", level: 3, kind: "VENUE", traits: ["alcoholFriendly", "lateNight"] },
  { code: "SUBTYPE_CAFE", pattern: /커피|카페|다방/, slug: "cafe", level: 3, kind: "VENUE", traits: ["dessert", "date"] },
  { code: "SUBTYPE_BAKERY", pattern: /베이킹|제과|제빵|베이커리|과자점/, slug: "bakery-detail", level: 2, kind: "INGREDIENT_METHOD", traits: ["dessert"] },
  { code: "SUBTYPE_KOREAN", pattern: /한식/, slug: "korean-general", level: 4, kind: "CUISINE" },
  { code: "SUBTYPE_JAPANESE", pattern: /일식/, slug: "japanese-general", level: 4, kind: "CUISINE" },
  { code: "SUBTYPE_CHINESE", pattern: /중국|중식/, slug: "chinese-general", level: 4, kind: "CUISINE" },
  { code: "SUBTYPE_WESTERN", pattern: /경양식|양식/, slug: "western-general", level: 4, kind: "CUISINE" },
  { code: "SUBTYPE_WORLD", pattern: /외국식|세계음식|외국음식/, slug: "world-general", level: 4, kind: "CUISINE" },
];

export const sourceFallbackV5 = {
  GENERAL_RESTAURANT: "korean-general",
  REST_CAFE: "cafe",
  BAKERY: "bakery-detail",
  ENTERTAINMENT_BAR: "pub",
} as const;
