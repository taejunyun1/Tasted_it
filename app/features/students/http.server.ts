import { and, eq, sql } from "drizzle-orm";
import { data } from "react-router";
import { ZodError } from "zod";
import type { AppDb } from "../../db/client.server";
import { rateLimitWindows } from "../../db/schema";
import { isSameOriginMutation } from "../http/same-origin";
import { subjectFingerprint } from "./subjects.server";
import { NO_STORE_HEADERS, STUDENT_CONFLICT, STUDENT_DENIED } from "./policy";

export function ensureStudentWorkspace(enabled: string | undefined) {
  if (enabled !== "true") throw new Response("페이지를 찾을 수 없습니다.", { status: 404, headers: NO_STORE_HEADERS });
}
export async function readStudentForm(request: Request) {
  if (!isSameOriginMutation(request)) throw new Response("현재 서비스에서 다시 요청해 주세요.", { status: 403, headers: NO_STORE_HEADERS });
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) throw new Response("지원하지 않는 입력 형식입니다.", { status: 415, headers: NO_STORE_HEADERS });
  const reader = request.body?.getReader();
  let length = 0; const parts: Uint8Array[] = [];
  if (reader) while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 16_384) { await reader.cancel(); throw new Response("입력 내용이 너무 깁니다.", { status: 413, headers: NO_STORE_HEADERS }); }
    parts.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  const values: Record<string, string> = {};
  for (const [key, value] of form) {
    if (Object.hasOwn(values, key)) throw new Response("같은 항목을 중복 제출할 수 없습니다.", { status: 400, headers: NO_STORE_HEADERS });
    Object.defineProperty(values, key, { value, enumerable: true });
  }
  return values;
}

export async function consumeStudentWriteLimit(db: AppDb, userId: string, now: Date, purpose: "JOIN" | "WORK") {
  const windowMs = 15 * 60_000;
  const windowStartedAt = new Date(Math.floor(now.getTime() / windowMs) * windowMs).toISOString();
  const bucketHash = await subjectFingerprint(["student-write", purpose, userId]);
  await db.insert(rateLimitWindows).values({ bucketHash, windowStartedAt, attemptCount: 1 }).onConflictDoUpdate({ target: [rateLimitWindows.bucketHash, rateLimitWindows.windowStartedAt], set: { attemptCount: sql`${rateLimitWindows.attemptCount} + 1` } });
  const row = await db.query.rateLimitWindows.findFirst({ where: and(eq(rateLimitWindows.bucketHash, bucketHash), eq(rateLimitWindows.windowStartedAt, windowStartedAt)) });
  if ((row?.attemptCount ?? 1) > (purpose === "JOIN" ? 10 : 60)) throw new Response("요청이 많습니다. 잠시 후 다시 시도해 주세요.", { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": "900" } });
}

export function studentFailure(error: unknown) {
  if (error instanceof Response) {
    if (error.status === 403 || error.status === 429 || error.status >= 500) console.warn("STUDENT_WORKSPACE_FAILURE", { code: "HTTP", status: error.status });
    return data({ error: error.status === 403 ? "현재 서비스에서 다시 요청해 주세요." : error.status === 413 ? "입력 내용이 너무 깁니다." : "요청 형식이나 횟수를 확인해 주세요." }, { status: error.status, headers: error.headers });
  }
  if (error instanceof ZodError) return data({ error: "입력 항목과 허용된 분류 값을 확인해 주세요." }, { status: 400, headers: NO_STORE_HEADERS });
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const messages: Record<string, [number, string]> = {
    STUDENT_ACCESS_DENIED: [403, STUDENT_DENIED], STUDENT_CAPABILITY_REQUIRED: [403, STUDENT_DENIED],
    STUDENT_ADMIN_REQUIRED: [403, "관리자 권한이 필요합니다."], STUDENT_ASSIGNEE_REQUIRED: [403, "이 작업의 1차 담당자만 제출할 수 있습니다."],
    STUDENT_TASK_NOT_FOUND: [404, "배정된 작업을 찾을 수 없습니다."], STUDENT_TARGET_UNAVAILABLE: [404, "대상 자료가 변경되었습니다. 담당자에게 확인해 주세요."],
    STUDENT_TASK_CONFLICT: [409, STUDENT_CONFLICT], STUDENT_SOURCE_CHANGED: [409, "원천 정보가 바뀌었습니다. 1차 담당자가 다시 확인·제출해야 합니다."],
    STUDENT_CHECKER_REQUIRED: [403, "다른 학생의 지정 교차 확인자가 처리해야 합니다."],
    STUDENT_REGISTRATION_NOT_READY: [409, "신규 점포 등록 조건을 확인해 주세요. 공개 실행은 운영 담당자가 처리합니다."],
    STUDENT_INVITE_INVALID: [400, "초대가 만료되었거나 이미 사용되었습니다. 담당자에게 새 초대를 요청하세요."],
    STUDENT_ACCOUNT_REQUIRED: [403, "이메일 인증을 마친 개인 회원 계정으로 참여해 주세요."],
    STUDENT_SEAT_UNAVAILABLE: [409, "이미 연결되었거나 사용할 수 없는 학생 좌석입니다."],
    STUDENT_TASK_DUPLICATE: [409, "이미 배정된 대상입니다. 기존 작업을 확인해 주세요."],
    STUDENT_INPUT_INVALID: [400, "입력한 분류와 세부 업종을 확인해 주세요."],
  };
  const known = Object.hasOwn(messages, code) ? messages[code] : undefined;
  const [status, message] = known ?? [500, "작업을 처리하지 못했습니다. 잠시 후 다시 확인해 주세요."];
  if (status === 403 || status >= 500) console.warn("STUDENT_WORKSPACE_FAILURE", { code: known ? code : "UNEXPECTED", status });
  return data({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export function studentLoadFailure(error: unknown): never {
  const failed = studentFailure(error);
  throw new Response(failed.data.error, { status: failed.init?.status ?? 500, headers: NO_STORE_HEADERS });
}
