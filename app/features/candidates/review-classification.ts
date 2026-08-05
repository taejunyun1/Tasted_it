import type { ClassificationConfidence } from "./category-suggestion";

export type CandidateReviewState = "AUTO" | "MANUAL" | "BLOCKED";

export function classifyReviewState(input: {
  confidence: ClassificationConfidence;
  categoryAvailable: boolean;
  address: string;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  duplicate: boolean;
}) {
  const blockers: string[] = [];
  const reviewReasons: string[] = [];
  if (!input.address) blockers.push("주소 없음");
  if (!input.neighborhood) blockers.push("동네 추출 실패");
  if (!validCoordinates(input.latitude, input.longitude)) blockers.push("좌표 확인 필요");
  if (input.duplicate) blockers.push("기존 공개 장소와 중복");
  if (!input.categoryAvailable) reviewReasons.push("활성 세부 카테고리 없음");
  if (input.confidence !== "HIGH") reviewReasons.push(`자동 분류 ${input.confidence}`);
  const state: CandidateReviewState = blockers.length > 0 ? "BLOCKED" : reviewReasons.length > 0 ? "MANUAL" : "AUTO";
  return { state, blockers, reviewReasons };
}

function validCoordinates(latitude: number | null, longitude: number | null) {
  return latitude != null && longitude != null && Number.isFinite(latitude) && latitude >= 33 && latitude <= 39
    && Number.isFinite(longitude) && longitude >= 124 && longitude <= 132;
}
