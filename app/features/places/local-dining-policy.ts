import { classifyDiningChainStore } from "../candidates/chain-store-policy";

export const LOCAL_DINING_POLICY_VERSION = "local-dining-v1";
export type DiningExclusion = "ADULT_ENTERTAINMENT" | "DELIVERY_ONLY" | "RETAIL_MARKET" | "CHAIN_STORE" | "DISTRIBUTION_WHOLESALE" | "OTHER_NON_FOOD";
export type DiningReason = DiningExclusion | "LOCAL_DINE_IN_UNCONFIRMED";
export type LocalDiningInput = {
  businessName: string;
  businessSubtype?: string | null;
  sourceType?: string | null;
  /** Only an identity-matched, current provider result may be supplied. */
  naverCategory?: string | null;
  /** A server-validated, subject-bound administrator confirmation, never a category inference. */
  localDineInConfirmed?: boolean;
};
export type LocalDiningDecision = {
  decision: "ELIGIBLE" | "EXCLUDE" | "REVIEW";
  reasons: DiningReason[];
  matchedRules: string[];
  policyVersion: string;
};

export const diningReasonLabels: Record<DiningReason, string> = {
  ADULT_ENTERTAINMENT: "유흥·노래 업종",
  DELIVERY_ONLY: "배달·포장 전문 / 홀 미운영",
  RETAIL_MARKET: "마트·편의점·소매점",
  CHAIN_STORE: "체인점 (로컬 체인 포함)",
  DISTRIBUTION_WHOLESALE: "유통·도매·식자재 공급",
  OTHER_NON_FOOD: "방문 식당이 아닌 업종",
  LOCAL_DINE_IN_UNCONFIRMED: "로컬·방문 식사 확인 필요",
};

const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const industryRules: ReadonlyArray<[DiningExclusion, RegExp]> = [
  ["ADULT_ENTERTAINMENT", /^(?:유흥주점(?:영업|업)?|단란주점(?:영업|업)?|무도유흥주점업|무도장운영업|고고\(디스코\)클럽|노래연습장(?:업)?|노래방|룸살롱|나이트클럽|카바레|캬바레)$/],
  ["DELIVERY_ONLY", /^(?:배달전문(?:점|음식점)?|포장전문(?:점|음식점)?|배달및포장전문|홀미운영|홀없음)$/],
  ["DISTRIBUTION_WHOLESALE", /(?:유통|도매|물류|식자재|납품|수입판매)/],
  ["RETAIL_MARKET", /^(?:마트|대형마트|할인마트|슈퍼(?:마켓)?|슈퍼마켓업|수퍼마켓|편의점|편의점업|백화점|기타식품판매업|식료품소매업|농수산물소매업|식품소분업|즉석판매제조가공업|축산물판매업|식육판매업|식품자동판매기영업)$/],
  ["RETAIL_MARKET", /^(?!(?:.*유통|.*도매|.*물류|.*납품|.*수입판매)).*(?:마트|편의점|소매|판매업)$/],
  ["OTHER_NON_FOOD", /^(?:pc방|인터넷컴퓨터게임시설제공업|도자기공방|가죽공방|목공방|향수공방|미술공방|공예품판매업)$/],
];

/** Business-domain evidence must not be inferred from an address or a menu substring. */
export function classifyLocalDining(input: LocalDiningInput): LocalDiningDecision {
  const reasons = new Set<DiningReason>();
  const matchedRules: string[] = [];
  const add = (reason: DiningExclusion, rule: string) => { reasons.add(reason); matchedRules.push(rule); };
  if (input.sourceType === "ENTERTAINMENT_BAR") add("ADULT_ENTERTAINMENT", "SOURCE_ENTERTAINMENT_BAR");
  for (const [field, value] of [["SUBTYPE", input.businessSubtype], ["NAVER", input.naverCategory]] as const) {
    const segments = (value ?? "").split(/[>,;/|·]/).map(normalize).filter(Boolean);
    for (const segment of segments) {
      for (const [reason, pattern] of industryRules) {
        if (pattern.test(segment)) add(reason, `${field}:${segment}`);
      }
    }
  }
  const name = normalize(input.businessName);
  // Explicit operating claims only. "배달 가능", "상회", "수산", "식품", "클럽" are not exclusions.
  if (/(?:배달전문(?:점)?|포장전문(?:점)?|홀미운영|홀없음)$/.test(name)) add("DELIVERY_ONLY", "NAME_DELIVERY_ONLY");
  if (/(?:룸살롱|룸싸롱|단란주점|노래연습장|노래방|카바레|캬바레|콜라텍|가라오케)$/.test(name)) add("ADULT_ENTERTAINMENT", "NAME_ADULT_VENUE");
  if (name.includes("라이브바") || name.includes("라이브클럽")) add("ADULT_ENTERTAINMENT", "NAME_LIVE_BAR");
  if (name.includes("라이브카페")) add("OTHER_NON_FOOD", "NAME_LIVE_CAFE");
  if (/(?:pc방|피씨방|피시방|도자기공방|가죽공방|목공방)$/.test(name)) add("OTHER_NON_FOOD", "NAME_NON_FOOD_VENUE");
  const convenience = /^(gs25|세븐일레븐|이마트24|미니스톱)(?:$|.+점$)/.exec(name);
  if (convenience) add("RETAIL_MARKET", `NAME_CONVENIENCE_${convenience[1].toUpperCase()}`);
  if (name === "cu" || /^cu(?:[가-힣]|\d).*(?:점)$/.test(name)) add("RETAIL_MARKET", "NAME_CONVENIENCE_CU");
  const chain = classifyDiningChainStore(input.businessName);
  if (chain) add("CHAIN_STORE", `BRAND:${chain.chainId}:${chain.matchMethod}`);
  if (reasons.size) return { decision: "EXCLUDE", reasons: [...reasons], matchedRules, policyVersion: LOCAL_DINING_POLICY_VERSION };
  const normalizedSubtype = normalize(input.businessSubtype ?? "");
  const sourceFood = ["GENERAL_RESTAURANT", "REST_CAFE", "BAKERY"].includes(input.sourceType ?? "")
    || /(?:일반음식점|휴게음식점|한식|경양식|일식|중식|양식|제과점|제과|커피|카페|음식점)/.test(normalizedSubtype);
  const naverFood = (input.naverCategory ?? "").split(">")[0]?.replace(/\s/g, "")
    && /^(?:음식점|한식|양식|일식|중식|카페[,·/]디저트|카페|술집|분식|아시아음식)/.test((input.naverCategory ?? "").split(">")[0]!.replace(/\s/g, ""));
  // A source restaurant licence or an identity-matched NAVER food domain is a
  // positive dine-in signal. Delivery-only and uncertain operating modes were
  // excluded above; absent all positive evidence remains review, never ALLOW.
  if (input.localDineInConfirmed || sourceFood || naverFood) {
    return { decision: "ELIGIBLE", reasons: [], matchedRules: [input.localDineInConfirmed ? "ADMIN_LOCAL_DINE_IN" : sourceFood ? "SOURCE_FOOD_SERVICE" : "NAVER_FOOD_DOMAIN"], policyVersion: LOCAL_DINING_POLICY_VERSION };
  }
  return { decision: "REVIEW", reasons: ["LOCAL_DINE_IN_UNCONFIRMED"], matchedRules: [], policyVersion: LOCAL_DINING_POLICY_VERSION };
}

export type DiningSubject = { businessName: string; address: string; businessSubtype?: string | null; sourceType?: string | null; latitude?: number | null; longitude?: number | null };
export function diningSubjectKey(input: DiningSubject) {
  return JSON.stringify([input.businessName, input.address, input.businessSubtype ?? "", input.sourceType ?? "", input.latitude ?? null, input.longitude ?? null]);
}
export type DiningConfirmation = { policyVersion: string; subjectKey: string; actorUserId: string; confirmedAt: string; reason: string };
export function hasDiningConfirmation(json: string | null | undefined, subject: DiningSubject, now: string) {
  try {
    const value = JSON.parse(json ?? "null") as DiningConfirmation | null;
    const age = Date.parse(now) - Date.parse(value?.confirmedAt ?? "");
    return Boolean(value && value.policyVersion === LOCAL_DINING_POLICY_VERSION && value.subjectKey === diningSubjectKey(subject)
      && typeof value.actorUserId === "string" && value.actorUserId.length > 0
      && typeof value.reason === "string" && value.reason.trim().length >= 20
      && age >= 0 && age <= 90 * 86400_000);
  } catch { return false; }
}
