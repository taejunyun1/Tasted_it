export type RecommendationMatchKind = "DIRECT" | "ADJACENT" | "EXPLORATION";
export type LegacyRecommendationMatchKind = RecommendationMatchKind | "FAMILIAR";

export function canonicalRecommendationMatchKind(
  kind: LegacyRecommendationMatchKind,
): RecommendationMatchKind {
  return kind === "FAMILIAR" ? "DIRECT" : kind;
}

export type RecommendationActionName =
  | "SAVE"
  | "LIKE"
  | "DISLIKE_MENU"
  | "DISLIKE_DISTANCE"
  | "DISLIKE_PRICE"
  | "DISLIKE_ATMOSPHERE"
  | "ALREADY_VISITED"
  | "DETAIL_OPENED";

export type RecommendationActionValue = {
  action: RecommendationActionName;
  rankingInput: boolean;
  tastePenalty: number;
  notes: string;
};

export const RECOMMENDATION_ACTION_VALUES: readonly RecommendationActionValue[] = [
  { action: "SAVE", rankingInput: true, tastePenalty: 0, notes: "저장 이력은 추론 취향에 간접 반영" },
  { action: "LIKE", rankingInput: true, tastePenalty: 0, notes: "추천 평가는 추론 취향에 간접 반영" },
  { action: "DISLIKE_MENU", rankingInput: true, tastePenalty: .18, notes: "음식 취향 감점과 현재 장소 제외" },
  { action: "DISLIKE_DISTANCE", rankingInput: true, tastePenalty: 0, notes: "현재 장소만 제외" },
  { action: "DISLIKE_PRICE", rankingInput: true, tastePenalty: 0, notes: "현재 장소만 제외" },
  { action: "DISLIKE_ATMOSPHERE", rankingInput: true, tastePenalty: 0, notes: "현재 장소만 제외" },
  { action: "ALREADY_VISITED", rankingInput: true, tastePenalty: 0, notes: "현재 장소만 제외" },
  { action: "DETAIL_OPENED", rankingInput: false, tastePenalty: 0, notes: "분석 이벤트만 기록" },
] as const;

export function actionValue(action: RecommendationActionName) {
  return RECOMMENDATION_ACTION_VALUES.find((item) => item.action === action)!;
}

export function tastePenaltyForFeedback(input: {
  value: -1 | 1;
  reason: "MENU" | "DISTANCE" | "PRICE" | "ATMOSPHERE" | "ALREADY_VISITED" | null;
}) {
  return input.value === -1 && (input.reason === null || input.reason === "MENU")
    ? actionValue("DISLIKE_MENU").tastePenalty
    : 0;
}
