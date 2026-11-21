export const privacyKindLabels: Record<string, string> = { ACCESS: "열람", CORRECTION: "정정", DELETION: "삭제", RESTRICTION: "처리정지" };
export const privacyStatusLabels: Record<string, string> = { RECEIVED: "접수", REVIEWING: "검토 중", POLICY_HOLD: "정책 확인 대기", GUIDANCE_RECORDED: "기존 경로 안내 기록" };
export const privacyDecisionLabels: Record<string, string> = { REVIEW_STARTED: "검토 시작", POLICY_UNRESOLVED: "정책 확인 대기", SELF_SERVICE_GUIDANCE: "기존 경로 안내 기록" };
export const cleanupStatusLabels: Record<string, string> = { PENDING: "재시도 대기", RUNNING: "삭제 처리 중", FAILED: "실패·재시도 대기", UNKNOWN: "삭제 결과 미확인" };
export function privacyTime(value: string | null) {
  if (!value) return "미기록";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" }).format(date) : "미확인";
}
