import { z } from "zod";

export const ACTIVITY_KINDS = {
  CSV_IMPORT: "CSV 반입", RATING_RECOMPUTE: "평가 재계산", RATING_JOB_CONTROL: "평가 작업 취소·복구", INTEGRITY_CASE_TRANSITION: "사건 상태 변경",
  VOTE_INVALIDATE: "투표 무효화", ADMIN_ROLE_CHANGE: "관리자 권한 변경", ADMIN_SESSIONS_REVOKE: "세션 회수",
  TEMP_PUBLISH: "TEMP 공개", TEMP_UNPUBLISH: "TEMP 공개 회수",
  MEMBER_ACCESS_CHANGE: "회원 접근·세션 관리",
  PARKING_SYNC_CONTROL: "주차·EV 작업 제어",
  REVIEWER_ADMIN_CHANGE: "리뷰어 관리", STUDENT_ADMIN_CHANGE: "학생 관리", PLACE_ADMIN_CHANGE: "장소 공개·병합·회수",
  PUBLIC_SYNC_CONTROL: "공공 인허가 동기화",
} as const;
export type ActivityKind = keyof typeof ACTIVITY_KINDS;
export type ActivityView = "audit" | "operations";
export const ACTIVITY_PAGE_SIZE = 50;
export const ACTIVITY_STATUS = {
  RECORDED: "기존 감사 기록", PENDING: "미확정", EXPIRED: "미리보기 만료",
  COMMITTED: "확정 영수증", INCOMPLETE: "연결 미확인",
} as const;
export type ActivityStatus = keyof typeof ACTIVITY_STATUS;
const time = z.string().datetime();
const cursorSchema = z.object({ version: z.literal(1), view: z.enum(["audit", "operations"]), kind: z.string(),
  cutoff: time, afterKey: z.number().positive(), afterId: z.string().min(1).max(128), highWater: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type ActivityCursor = z.infer<typeof cursorSchema>;
export class ActivityInputError extends Error {}
export function activityKind(value: unknown): ActivityKind | null {
  return typeof value === "string" && Object.hasOwn(ACTIVITY_KINDS, value) ? value as ActivityKind : null;
}
export function normalizeActivityTime(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const utc = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const parsed = Date.parse(utc);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
export function encodeActivityCursor(cursor: ActivityCursor) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function parseActivityQuery(params: URLSearchParams, now: string) {
  const view = params.get("view") ?? "audit", kind = params.get("kind") ?? "all", operationId = params.get("operation");
  if (!["audit", "operations"].includes(view) || (kind !== "all" && !activityKind(kind))
    || ["view", "kind", "cursor", "operation"].some((key) => params.getAll(key).length > 1)
    || (operationId !== null && !z.uuid().safeParse(operationId).success)) throw new ActivityInputError();
  let cursor: ActivityCursor | null = null;
  const raw = params.get("cursor");
  if (raw !== null) {
    try {
      if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      const bytes = Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
      cursor = cursorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (cursor.view !== view || cursor.kind !== kind || cursor.cutoff > now) throw new Error();
    } catch { throw new ActivityInputError(); }
  }
  return { view: view as ActivityView, kind: kind as ActivityKind | "all", operationId, cursor };
}
export function activityHref(input: { view: ActivityView; kind: string }, extra?: { cursor?: string; operation?: string }) {
  const params = new URLSearchParams({ view: input.view });
  if (input.kind !== "all") params.set("kind", input.kind);
  if (extra?.cursor) params.set("cursor", extra.cursor);
  if (extra?.operation) params.set("operation", extra.operation);
  return `/admin/activity?${params}`;
}
