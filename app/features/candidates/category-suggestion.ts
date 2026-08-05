import type { PublicDataSource } from "./public-data";

const rules: Array<[RegExp, string[]]> = [
  [/제과|베이커리|빵/, ["bakery-detail"]],
  [/커피|카페|다방/, ["cafe"]],
  [/아이스크림|빙수/, ["ice-dessert"]],
  [/호프|맥주|펍/, ["pub"]],
  [/치킨|통닭/, ["chicken"]],
  [/정종|소주|포차/, ["pocha"]],
  [/일식|횟집|회집/, ["japanese-rice", "sushi-sashimi"]],
  [/중국|중식/, ["chinese-dish"]],
  [/한식/, ["home-meal"]],
  [/경양식|양식/, ["western"]],
  [/분식/, ["tteokbokki"]],
  [/뷔페/, ["other"]],
];

const defaults: Record<PublicDataSource, string[]> = {
  GENERAL_RESTAURANT: ["home-meal"],
  REST_CAFE: ["cafe"],
  BAKERY: ["bakery-detail"],
  ENTERTAINMENT_BAR: ["pub"],
};

export function suggestCategorySlugs(sourceType: PublicDataSource, subtype: string | null | undefined) {
  const value = subtype?.trim() ?? "";
  return rules.find(([pattern]) => pattern.test(value))?.[1] ?? defaults[sourceType];
}
