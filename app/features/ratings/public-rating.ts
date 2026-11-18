import type { PlaceSummary } from "../places/place.types";

export type PublicRatingInput = Partial<Pick<PlaceSummary,
  "ratingScore" | "ratingSampleCount" | "userRatingScore" | "userRatingSampleCount" |
  "reviewerRatingScore" | "reviewerRatingSampleCount" | "ratingIsStale" | "ratingComputedAt" |
  "positive" | "negative" | "userPositive" | "userNegative" | "reviewerPositive" | "reviewerNegative"
>>;

export function publicRatingFromPlace(place: PublicRatingInput) {
  const isStale = place.ratingIsStale ?? place.ratingScore == null;
  return {
    overallScore: isStale ? null : place.ratingScore ?? null,
    userScore: isStale ? null : place.userRatingScore ?? null,
    reviewerScore: isStale ? null : place.reviewerRatingScore ?? null,
    overallSampleCount: place.ratingSampleCount ?? (place.positive ?? 0) + (place.negative ?? 0),
    userSampleCount: place.userRatingSampleCount ?? (place.userPositive ?? 0) + (place.userNegative ?? 0),
    reviewerSampleCount: place.reviewerRatingSampleCount ?? (place.reviewerPositive ?? 0) + (place.reviewerNegative ?? 0),
    isStale,
    computedAt: place.ratingComputedAt ?? null,
    algorithmVersion: isStale ? "rating-recomputing" : "rating-v2.0",
  };
}

export function formatRatingGroup(score: number | null, sampleCount: number) {
  if (score !== null) return `${score}% · ${sampleCount}명 평가`;
  return sampleCount < 8 ? `${sampleCount}/8` : `${sampleCount}명 평가 · 계산 대기`;
}

export function ratingCalculationLabel(place: PublicRatingInput) {
  const rating = publicRatingFromPlace(place);
  if (!rating.computedAt || !Number.isFinite(Date.parse(rating.computedAt))) return "미계산";
  const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(rating.computedAt));
  return `${rating.isStale ? "이전 계산" : "공개 결과 계산"} ${date} (한국 시간)`;
}

export function reviewerWeightExplanation(userSampleCount: number) {
  return userSampleCount > 0
    ? "각 집단은 8표부터 숫자를 공개합니다. 일반 회원 평가가 함께 있어 리뷰어 영향은 전체 유효 가중치의 최대 30%입니다."
    : "각 집단은 8표부터 숫자를 공개합니다. 일반 회원 평가가 함께 있을 때만 리뷰어 영향의 최대 30% 상한을 적용합니다.";
}
