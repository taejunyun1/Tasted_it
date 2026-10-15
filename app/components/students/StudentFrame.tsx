import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import type { ReactNode } from "react";
import "../../styles/student-workspace.css";

export function StudentFrame({ title, description, children, admin = false }: { title: string; description: string; children: ReactNode; admin?: boolean }) {
  return <main id="main" className="student-page">
    <header className="student-heading"><div><p className="student-kicker">{admin ? "학생 운영" : "학생 작업공간"}</p><h1>{title}</h1><p>{description}</p></div>
      <nav aria-label="작업공간 이동"><Link to={admin ? "/admin/place-operations" : "/student"}>{admin ? "장소 운영" : "내 작업"}</Link><Link to="/places">서비스 보기</Link></nav>
    </header>{children}
  </main>;
}
export function StudentNotice({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return <p className={`student-notice${error ? " student-notice--error" : ""}`} role={error ? "alert" : "status"}>{error ?? message}</p>;
}
export function StudentErrorBoundary() {
  const error = useRouteError();
  return <StudentFrame title="작업을 열 수 없습니다" description={isRouteErrorResponse(error) && typeof error.data === "string" ? error.data : "권한과 작업 상태를 확인한 뒤 다시 접속해 주세요."}><p><Link className="student-link" to="/login?returnTo=%2Fstudent">로그인</Link> 또는 <Link className="student-link" to="/student">내 작업으로 돌아가기</Link></p></StudentFrame>;
}
