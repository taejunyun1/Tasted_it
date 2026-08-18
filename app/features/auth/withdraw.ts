export const WITHDRAWN_DISPLAY_NAME = "탈퇴한 회원";
export const WITHDRAW_CONFIRM_PHRASE = "탈퇴합니다";

export function withdrawnEmailFor(userId: string) {
  return `withdrawn.${userId}@invalid.local`;
}

export function isWithdrawnEmail(email: string) {
  return /^withdrawn\.[^@\s]+@invalid\.local$/.test(email.trim().toLowerCase());
}
