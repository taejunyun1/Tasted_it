import { z } from "zod";

export const REVIEWER_CHANGES = {
  START_REVIEW: "검토 시작", APPROVE: "일반 승인", OVERRIDE_APPROVE: "예외 승인", REJECT: "신청 반려",
  ACTIVE: "활동 재개", DORMANT: "휴면 전환", SUSPENDED: "활동 정지", AUTO_DORMANCY: "90일 휴면 후보 전환",
} as const;
export type ReviewerChange = keyof typeof REVIEWER_CHANGES;
export const reviewerChangeValueSchema = z.enum(["START_REVIEW", "APPROVE", "OVERRIDE_APPROVE", "REJECT", "ACTIVE", "DORMANT", "SUSPENDED", "AUTO_DORMANCY"]);
export const reviewerChangeSchema = z.object({
  change: reviewerChangeValueSchema,
  targetIds: z.array(z.string().min(1).max(128)).max(25), reason: z.string().trim().max(300),
}).strict().superRefine((value, ctx) => {
  if ((!value.targetIds.length && value.change !== "AUTO_DORMANCY") || new Set(value.targetIds).size !== value.targetIds.length
    || value.reason.includes("\0") || (!["START_REVIEW", "APPROVE", "AUTO_DORMANCY"].includes(value.change) && !value.reason))
    ctx.addIssue({ code: "custom", message: "REVIEWER_ADMIN_INPUT_INVALID" });
});
export const REVIEWER_RESULT_CODES: Record<string, string> = {
  READY: "미리보기 확인 대상", APPLIED: "반영됨", NOT_FOUND: "대상 없음", APPLICATION_CLOSED: "종료된 신청",
  PROFILE_EXISTS: "기존 리뷰어 프로필 있음", STORED_REQUIREMENT_NOT_MET: "신청 당시 승인 제안 10곳 미만",
  ALREADY_STATUS: "이미 같은 상태", NOT_DORMANT: "90일 휴면 조건 미충족", PROTECTED_ADMIN: "관리자 계정 보호",
  ACCOUNT_UNAVAILABLE: "탈퇴한 계정", ACCOUNT_RESTRICTED: "계정 접근 제한 중", SLUG_CONFLICT: "프로필 주소 충돌",
  DUPLICATE_APPLICANT: "같은 신청자의 다른 신청을 먼저 처리",
  BATCH_CONFLICT: "대상 변경으로 전체 미반영", RESULT_UNKNOWN: "결과 재확인 필요",
};
export type ReviewerItemResult = { targetRef: string; targetId?: string; targetType?: "APPLICATION" | "PROFILE"; outcome: "APPLIED" | "SKIPPED" | "NOT_APPLIED" | "UNKNOWN"; code: string };
export type ReviewerBatchResult = { change: ReviewerChange; requestedCount: number; appliedCount: number; skippedCount: number; results: ReviewerItemResult[] };
export const reviewerBatchResultSchema = z.object({ change: reviewerChangeValueSchema, requestedCount: z.number().int().min(1).max(25),
  appliedCount: z.number().int().min(0).max(25), skippedCount: z.number().int().min(0).max(25),
  results: z.array(z.object({ targetRef: z.string().regex(/^reviewer-[a-f0-9]{12}$/), targetId: z.string().min(1).max(128), targetType: z.enum(["APPLICATION", "PROFILE"]), outcome: z.enum(["APPLIED", "SKIPPED"]),
    code: z.string().refine((code) => Object.hasOwn(REVIEWER_RESULT_CODES, code)) }).strict()).max(25),
}).strict().refine((result) => result.requestedCount === result.results.length
  && result.appliedCount === result.results.filter((item) => item.outcome === "APPLIED").length
  && result.skippedCount === result.results.filter((item) => item.outcome === "SKIPPED").length);
