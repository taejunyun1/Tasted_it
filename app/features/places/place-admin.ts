import { z } from "zod";

const id = z.string().min(1).max(160);
const reason = z.string().trim().max(300);
export const placeAdminCommandSchema = z.discriminatedUnion("change", [
  z.object({ change: z.literal("PUBLISH"), workItemId: id, expectedVersion: z.number().int().nonnegative().optional(), reason }).strict(),
  z.object({ change: z.literal("MERGE"), sourcePlaceId: id, targetPlaceId: id, reason: reason.min(1) }).strict(),
  z.object({ change: z.literal("RECALL"), placeId: id, reason: reason.min(1) }).strict(),
  z.object({ change: z.literal("RESTORE_RECALL"), recallOperationId: z.uuid(), reason: reason.min(1) }).strict(),
]).refine((value) => !value.reason.includes("\0") && (value.change !== "MERGE" || value.sourcePlaceId !== value.targetPlaceId));
export type PlaceAdminCommand = z.infer<typeof placeAdminCommandSchema>;
export type PlaceAdminChange = PlaceAdminCommand["change"];
export const PLACE_ADMIN_CHANGE_LABELS = { PUBLISH: "선택 장소 공개", MERGE: "장소 병합", RECALL: "장소 공개 회수", RESTORE_RECALL: "직전 회수 복원" } as const;
export const PLACE_ADMIN_IMPACT_LABELS = {
  generalVotes: "연결된 일반 반응", reviewerVotes: "원장에 보존할 리뷰어 반응", memberSaves: "연결된 회원 저장",
  guestSaves: "연결된 임시 저장", reviewPhotos: "연결된 리뷰 사진", reviews: "연결된 방문 기록", sourceLinks: "연결된 원천",
  corrections: "연결된 정정 요청", categories: "연결된 분류",
  generalVotesForwarded: "대상으로 전달 가능한 일반 반응", generalVotesBlockedByTargetChoice: "대상의 기존 반응 우선",
  sourceGeneralVotesRemoved: "전달·대상 우선으로 정리될 원본 현재 반응", reviewerVotesRetained: "원본에 보존할 리뷰어 반응",
  reviewerVotesTransferred: "이동할 리뷰어 반응", voteEventsDeleted: "삭제할 반응 원장",
  memberChoicesCopied: "복사할 원본 명시 저장 선택", memberTargetChoicesPreserved: "보존할 대상 명시 선택",
  memberUnsaveProtected: "우선할 대상 명시 저장 해제", memberSavesAdded: "대상에 추가할 저장", memberSavesMoved: "원본에서 이동할 저장",
  memberSavesRemoved: "대상 명시 선택으로 해제할 저장", memberSavesSourceCleared: "원본에서 정리할 저장", memberSavesDeduplicated: "합칠 회원 저장 중복",
  guestSavesMoved: "이동할 임시 저장", guestSavesDeduplicated: "합칠 임시 저장 중복", sourceLinksMoved: "이동할 원천 연결",
  categoriesMoved: "이동할 분류", categoriesDeduplicated: "합칠 분류 중복", correctionsMoved: "이동할 정정 요청",
  suggestionsRemapped: "대상을 바꿀 승인 제안", slugAliasesRetargeted: "재연결할 기존 주소",
  sourceReviewsRetained: "원본에 보존할 방문 기록", sourcePhotosRetained: "원본에 보존할 사진", reviewsTransferred: "이동할 방문 기록",
  reviewPhotosTransferred: "이동할 리뷰 사진", goldenPickRecordsRetained: "보존할 골든픽 원장", flavorRatingRecordsRetained: "보존할 취향 평가 원장",
  targetPublicBefore: "대상 목록·상세 공개 조건 · 현재", targetPublicAfter: "대상 목록·상세 공개 조건 · 변경 후",
  sourcePublicBefore: "원본 목록·상세 공개 조건 · 현재", sourcePublicAfter: "원본 목록·상세 공개 조건 · 변경 후",
  targetRecommendationBefore: "대상 추천 기본 조건 · 현재", targetRecommendationAfter: "대상 추천 기본 조건 · 변경 후",
  sourceRecommendationBefore: "원본 추천 기본 조건 · 현재", sourceRecommendationAfter: "원본 추천 기본 조건 · 변경 후",
  targetReviewerEligibilityBefore: "대상 리뷰어 참여 조건 · 현재", targetReviewerEligibilityAfter: "대상 리뷰어 참여 조건 · 변경 후",
  sourceReviewerEligibilityBefore: "원본 리뷰어 참여 조건 · 현재", sourceReviewerEligibilityAfter: "원본 리뷰어 참여 조건 · 변경 후",
  targetReviewsVisibleBefore: "대상 공개 방문 기록 · 현재", targetReviewsVisibleAfter: "대상 공개 방문 기록 · 변경 후",
  sourceReviewsVisibleBefore: "원본 공개 방문 기록 · 현재", sourceReviewsVisibleAfter: "원본 공개 방문 기록 · 변경 후",
  targetReviewPhotosVisibleBefore: "대상 공개 리뷰 사진 · 현재", targetReviewPhotosVisibleAfter: "대상 공개 리뷰 사진 · 변경 후",
  sourceReviewPhotosVisibleBefore: "원본 공개 리뷰 사진 · 현재", sourceReviewPhotosVisibleAfter: "원본 공개 리뷰 사진 · 변경 후",
} as const;
export type PlaceAdminImpact = Record<string, number>;
export type PlaceAdminTarget = { id: string; name: string; address: string; status: string; afterStatus: string; role: "TARGET" | "SOURCE" | "PLACE" };
export const placeAdminResultSchema = z.object({ change: z.enum(["PUBLISH", "MERGE", "RECALL", "RESTORE_RECALL"]),
  requestedCount: z.literal(1), appliedCount: z.literal(1), skippedCount: z.literal(0), targetId: id,
  sourceId: id.optional(), recallOperationId: z.uuid().optional(), reviewWorkItemId: id.optional(),
  afterDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  impact: z.record(z.string(), z.number().int().min(-1)),
}).strict();
export type PlaceAdminResult = z.infer<typeof placeAdminResultSchema>;
export type PlaceAdminView = { operationId: string; status: "PENDING" | "COMMITTED"; expiresAt: string; change: PlaceAdminChange;
  targets: PlaceAdminTarget[]; impact: PlaceAdminImpact; stale?: boolean; result?: PlaceAdminResult };
