import { useEffect } from "react";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { data, Link, redirect } from "react-router";
import type { Route } from "./+types/student-index";
import { studentSeats } from "../db/schema";
import { clearPendingInvite } from "../features/students/pending-invite";
import { createDb } from "../db/client.server";
import { requireUser } from "../features/auth/session.server";
import { ensureStudentWorkspace, studentLoadFailure } from "../features/students/http.server";
import { listStudentTasks } from "../features/students/tasks.server";
import { kindLabels, NO_STORE_HEADERS, statusLabels } from "../features/students/policy";
import { StudentFrame } from "../components/students/StudentFrame";
export { StudentErrorBoundary as ErrorBoundary } from "../components/students/StudentFrame";
export const headers = () => NO_STORE_HEADERS;
export const meta = () => [{ title: "학생 작업공간 — Re:Taste" }, { name: "robots", content: "noindex,nofollow" }];
export async function loader({ request }: Route.LoaderArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED);
  const user = await requireUser(request);
  const db = createDb(env.DB);
  try {
    const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
    const result = await listStudentTasks(db, { userId: user.id, now: new Date().toISOString(), page });
    return data({ ...result, seat: { code: result.seat.code, label: result.seat.label, expiresAt: result.seat.expiresAt } }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof Error && error.message === "STUDENT_ACCESS_DENIED" && user.role !== "ADMIN") {
      const seat = await db.query.studentSeats.findFirst({ where: eq(studentSeats.userId, user.id), columns: { code: true } });
      if (!seat) {
        console.info("STUDENT_ONBOARDING_REQUIRED", { reason: "INVITE_NOT_ACCEPTED" });
        return redirect("/student/join?from=workspace", { headers: NO_STORE_HEADERS });
      }
    }
    return studentLoadFailure(error);
  }
}
export default function StudentIndex({ loaderData: result }: Route.ComponentProps) {
  useEffect(() => { try { clearPendingInvite(window.sessionStorage); } catch { /* Storage may be disabled. */ } }, []);
  return <StudentFrame title={`${result.seat.label}의 작업`} description="배정된 자료를 분류하고 다른 학생의 지정 자료를 교차 확인합니다.">
    <p className="student-help">1차 담당 작업은 직접 제출하고, 교차 확인 작업은 제출된 근거를 확인하세요. 사용 기한은 {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" }).format(new Date(Date.parse(result.seat.expiresAt) - 1))}까지입니다.</p>
    {result.tasks.length ? <ul className="student-task-list">{result.tasks.map((task) => <li key={task.id}><Link to={`/student/tasks/${task.id}`}><div><strong>{task.title}</strong><small>{kindLabels[task.kind]} · {task.assignedSeat === result.seat.code ? "내가 1차 담당" : `${task.assignedSeat} 학생의 자료 교차 확인`}</small></div><span className="student-status">{statusLabels[task.status]}</span></Link></li>)}</ul> : <p className="student-empty">아직 배정된 작업이 없습니다. 담당자에게 이번 주 작업을 요청하세요.</p>}
    <nav className="student-pagination" aria-label="작업 목록 페이지">{result.page > 1 && <Link to={`?page=${result.page - 1}`}>이전</Link>}<span>{result.page}쪽 · 총 {result.total}건</span>{result.page * 50 < result.total && <Link to={`?page=${result.page + 1}`}>다음</Link>}</nav>
  </StudentFrame>;
}
