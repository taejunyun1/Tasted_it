import { z } from "zod";

export const seatCodeSchema = z.enum(["A", "B", "C", "D"]);
export type SeatCode = z.infer<typeof seatCodeSchema>;
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const taskKindSchema = z.enum(["PLACE", "REVIEW", "QA"]);
export type TaskKind = z.infer<typeof taskKindSchema>;
export const kindLabels = { PLACE: "점포 분류", REVIEW: "리뷰·사진 분류", QA: "화면 QA" } as const;
export const decisionLabels = { ELIGIBLE: "등록 적합", EXCLUDE: "제외", HOLD: "보류", VERIFIED: "확인완료", NEEDS_INFO: "보완필요", ESCALATE: "담당검토", PASS: "통과", FAIL: "실패", NOT_RUN: "미실시" } as const;
export const statusLabels = { OPEN: "배정됨", SUBMITTED: "교차 확인 대기", VERIFIED: "교차 확인 완료", APPROVED: "등록 인가 완료", NEEDS_INFO: "보완 요청" } as const;

export function permissionsForSeat(seat: SeatCode) {
  const place = seat === "A" || seat === "B";
  return { classifyPlaces: place, classifyReviews: !place, recordQa: true, approveRegistration: place };
}

export function mayReviewTask(input: { actorSeat: string; assignedSeat: string; checkerSeat: string; actorUserId: string; submittedBy: string | null }) {
  return input.actorSeat === input.checkerSeat && input.actorSeat !== input.assignedSeat
    && input.submittedBy !== null && input.actorUserId !== input.submittedBy;
}

export function safeQaPath(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//") || /[\\#\r\n]/.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded !== value && /[%\\]|\.\.|^\/\//.test(decoded)) return null;
    if (value.includes("..")) return null;
    const url = new URL(value, "https://student.invalid");
    if (url.origin !== "https://student.invalid") return null;
    return /^\/$|^\/(?:places|courses|maps|onboarding)(?:\/|$)/.test(url.pathname) ? value : null;
  } catch { return null; }
}

export const assignmentSchema = z.object({
  kind: taskKindSchema,
  assignedSeat: seatCodeSchema,
  checkerSeat: seatCodeSchema,
  targetId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(2).max(120),
}).strict().refine((v) => v.assignedSeat !== v.checkerSeat, "다른 학생을 교차 확인자로 지정하세요.")
  .refine((v) => v.kind !== "QA" || safeQaPath(v.targetId) !== null, "공개 서비스 화면 경로를 입력하세요.");

const evidenceUrl = z.string().trim().max(1000).refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}, "인증 정보가 없는 HTTPS 근거 링크를 입력하세요.");
const common = { note: z.string().trim().min(10).max(1500), evidenceUrl };
export const classificationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PLACE"), decision: z.enum(["ELIGIBLE", "EXCLUDE", "HOLD"]), categoryId: z.string().trim().max(128).optional(), ...common }).strict(),
  z.object({ kind: z.literal("REVIEW"), decision: z.enum(["VERIFIED", "NEEDS_INFO", "ESCALATE"]), ...common }).strict(),
  z.object({ kind: z.literal("QA"), decision: z.enum(["PASS", "FAIL", "NOT_RUN"]), ...common }).strict(),
]).refine((v) => v.kind !== "PLACE" || v.decision !== "ELIGIBLE" || Boolean(v.categoryId), "등록 적합에는 세부 업종이 필요합니다.");

export const NO_STORE_HEADERS = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } as const;
export const STUDENT_DENIED = "학생 작업 권한이 없거나 사용 기간이 끝났습니다.";
export const STUDENT_CONFLICT = "자료나 배정 상태가 바뀌었습니다. 새로 확인한 뒤 다시 제출해 주세요.";
