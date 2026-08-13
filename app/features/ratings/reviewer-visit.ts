import { z } from "zod";

export const REVIEWER_BADGE_CATALOG = {
  "백반·가정식": ["반찬 구성이 알참", "밥·국 온도 좋음", "집밥 간이 편안"],
  "국밥·해장국": ["국물 맛이 깊음", "건더기가 넉넉", "잡내 없이 깔끔"],
  "찌개·전골·탕": ["재료가 푸짐", "국물 간이 균형", "끝까지 따뜻"],
  "고기·구이": ["굽기 상태 좋음", "육즙이 살아 있음", "불향이 선명"],
  "족발·보쌈": ["살코기가 촉촉", "껍질 식감 좋음", "김치·곁들임 조화"],
  "한정식": ["코스 흐름 자연스러움", "제철 재료가 또렷", "상차림이 정갈"],
  "초밥·회": ["생선 선도 좋음", "밥 간과 온도 적절", "칼질이 고름"],
  "돈가스": ["튀김옷 바삭", "고기가 촉촉", "소스와 조화"],
  "라멘": ["육수 농도 선명", "면 익힘 알맞음", "토핑 상태 좋음"],
  "우동·소바": ["면 탄력 좋음", "국물·쯔유 깔끔", "고명 균형"],
  "덮밥·카레": ["소스 농도 적절", "밥과 토핑 균형", "향신료 풍미 선명"],
  "이자카야": ["안주 간이 균형", "제철 식재료 사용", "술과 궁합 좋음"],
  "해산물·생선요리": ["해산물 선도 좋음", "손질이 깔끔", "익힘이 정확"],
  "짜장·짬뽕": ["불향이 선명", "면 익힘 알맞음", "소스·국물 농도 좋음"],
  "중화요리": ["웍 향이 살아 있음", "튀김 식감 좋음", "소스 균형"],
  "마라·훠궈": ["마라 향 선명", "매운맛 단계 정확", "재료 선도 좋음"],
  "양꼬치": ["양고기 잡내 없음", "겉면이 잘 구워짐", "향신료 조화"],
  "파스타": ["면 익힘 정확", "소스 유화 좋음", "재료 풍미 선명"],
  "스테이크": ["굽기 정확", "육즙 풍부", "시어링 좋음"],
  "피자": ["도우 발효 풍미", "치즈·토핑 균형", "바닥이 바삭"],
  "버거": ["패티 육즙 좋음", "번 상태 좋음", "소스·토핑 균형"],
  "브런치": ["달걀 익힘 정확", "빵·채소 신선", "한 접시 균형"],
  "떡볶이·튀김": ["떡 식감 쫄깃", "양념 감칠맛", "튀김 바삭"],
  "김밥": ["밥 간 알맞음", "속재료 균형", "말이 상태 단단"],
  "만두": ["만두피 식감 좋음", "소가 꽉 참", "육즙이 살아 있음"],
  "치킨": ["튀김옷 바삭", "속살 촉촉", "양념 균형"],
  "베트남": ["허브 향 선명", "육수 깔끔", "면 익힘 알맞음"],
  "태국": ["향신료 균형", "산미·단맛 조화", "볶음 불향 좋음"],
  "인도": ["향신료 층위 선명", "커리 농도 좋음", "난이 잘 구워짐"],
  "멕시칸": ["또르띠야 상태 좋음", "살사 산미 선명", "속재료 균형"],
  "카페": ["추출 균형 좋음", "원두 향미 선명", "우유 질감 부드러움"],
  "디저트": ["단맛 절제", "식감 대비 좋음", "재료 향 선명"],
  "베이커리": ["겉껍질 바삭", "속결 촉촉", "발효 풍미 선명"],
  "아이스크림·빙수": ["얼음·크림 질감 좋음", "재료 맛 선명", "단맛 균형"],
  "호프·펍": ["맥주 상태 신선", "안주 온도 좋음", "튀김 바삭"],
  "포차": ["안주 간이 좋음", "불맛이 선명", "국물 안주 뜨거움"],
  "와인바": ["와인 보관 상태 좋음", "잔 관리 깨끗", "음식 페어링 조화"],
  "칵테일바": ["희석 균형 좋음", "향이 선명", "얼음 상태 좋음"],
  "샐러드": ["채소 신선", "드레싱 균형", "토핑이 알참"],
  "비건·채식": ["식물성 재료 선명", "단백질 구성이 알참", "조리 식감 좋음"],
  "도시락·간편식": ["구성 알참", "포장 상태 깔끔", "먹기 좋은 온도"],
  "기타": ["대표 메뉴 완성도", "재료 상태 좋음", "조리 상태 안정"],
} as const satisfies Record<string, readonly [string, string, string]>;

export type ReviewerCategoryName = keyof typeof REVIEWER_BADGE_CATALOG;
export type ReviewerEvaluation = "RECOMMEND" | "HOLD" | "NOT_RECOMMEND";

const allowedFields = new Set([
  "intent",
  "placeId",
  "categoryId",
  "categoryName",
  "evaluation",
  "badges",
  "golden",
  "goldenReason",
  "photos",
]);

const baseSubmissionSchema = z.object({
  intent: z.literal("publish-review"),
  placeId: z.string().trim().min(1).max(128),
  categoryId: z.string().trim().min(1).max(128),
  categoryName: z.string().trim().min(1).max(64),
  evaluation: z.enum(["RECOMMEND", "HOLD", "NOT_RECOMMEND"]),
  golden: z.enum(["0", "1"]),
  goldenReason: z.string().trim().max(100),
});

export type ReviewerVisitSubmission = {
  placeId: string;
  categoryId: string;
  categoryName: ReviewerCategoryName;
  evaluation: ReviewerEvaluation;
  badges: string[];
  golden: boolean;
  goldenReason: string | null;
};

function contractError(code: string): never {
  throw new Error(code);
}

export function parseReviewerVisitSubmission(form: FormData): ReviewerVisitSubmission {
  for (const key of form.keys()) if (!allowedFields.has(key)) contractError("REVIEW_FIELD_UNKNOWN");
  const raw = baseSubmissionSchema.safeParse({
    intent: form.get("intent"),
    placeId: form.get("placeId"),
    categoryId: form.get("categoryId"),
    categoryName: form.get("categoryName"),
    evaluation: form.get("evaluation"),
    golden: form.get("golden") ?? "0",
    goldenReason: form.get("goldenReason") ?? "",
  });
  if (!raw.success) contractError("REVIEW_SUBMISSION_INVALID");

  const categoryName = raw.data.categoryName as ReviewerCategoryName;
  const allowedBadges = REVIEWER_BADGE_CATALOG[categoryName];
  if (!allowedBadges) contractError("REVIEW_CATEGORY_INVALID");
  const badges = form.getAll("badges").map(String);
  if (badges.length > 2 || new Set(badges).size !== badges.length) contractError("REVIEW_BADGE_LIMIT");
  if (badges.some((badge) => !allowedBadges.includes(badge as never))) contractError("REVIEW_BADGE_INVALID");

  const golden = raw.data.golden === "1";
  const goldenReason = raw.data.goldenReason;
  if (golden && badges.length !== 2) contractError("GOLDEN_PICK_BADGES_REQUIRED");
  if (golden && (goldenReason.length < 15 || goldenReason.length > 100)) contractError("GOLDEN_PICK_REASON_LENGTH");

  return {
    placeId: raw.data.placeId,
    categoryId: raw.data.categoryId,
    categoryName,
    evaluation: raw.data.evaluation,
    badges,
    golden,
    goldenReason: golden ? goldenReason : null,
  };
}

export function reviewerEvaluationToVoteValue(evaluation: ReviewerEvaluation): -1 | 1 | null {
  if (evaluation === "RECOMMEND") return 1;
  if (evaluation === "NOT_RECOMMEND") return -1;
  return null;
}
