import { env } from "cloudflare:workers";
import { useEffect, useState } from "react";
import { data, Form, redirect, useNavigation, useRevalidator } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/student-join";
import { createDb } from "../db/client.server";
import { getOptionalUser, requireUser } from "../features/auth/session.server";
import { acceptStudentInvite } from "../features/students/invitations.server";
import { consumeStudentWriteLimit, ensureStudentWorkspace, readStudentForm, studentFailure } from "../features/students/http.server";
import { inviteTokenSchema, NO_STORE_HEADERS } from "../features/students/policy";
import { StudentFrame, StudentNotice } from "../components/students/StudentFrame";
export { StudentErrorBoundary as ErrorBoundary } from "../components/students/StudentFrame";
export const headers = () => NO_STORE_HEADERS;
export const meta = () => [{ title: "학생 초대 수락 — Re:Taste" }, { name: "robots", content: "noindex,nofollow" }];
export async function loader({ request }: Route.LoaderArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED);
  const user = await getOptionalUser(request);
  return data({ user: user ? { displayName: user.displayName } : null }, { headers: NO_STORE_HEADERS });
}
export async function action({ request }: Route.ActionArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED);
  const user = await requireUser(request);
  try {
    const values = z.object({ intent: z.literal("accept"), token: inviteTokenSchema }).strict().parse(await readStudentForm(request));
    const db = createDb(env.DB); const now = new Date();
    await consumeStudentWriteLimit(db, user.id, now, "JOIN");
    await acceptStudentInvite(db, { token: values.token, userId: user.id, now: now.toISOString() });
    return redirect("/student", { headers: NO_STORE_HEADERS });
  } catch (error) { return studentFailure(error); }
}
export default function StudentJoin({ loaderData, actionData }: Route.ComponentProps) {
  const [token, setToken] = useState(""); const nav = useNavigation(); const revalidator = useRevalidator();
  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (inviteTokenSchema.safeParse(fragment).success) setToken(fragment);
    if (fragment) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);
  return <StudentFrame title="개별 학생 초대" description="담당자가 보낸 초대를 본인 계정에 한 번 연결합니다.">
    <StudentNotice error={actionData?.error} />
    {!token ? <p className="student-notice" role="alert">담당자가 보낸 전체 초대 링크를 다시 열어 주세요. 초대는 발급 후 7일 동안 사용할 수 있습니다.</p> : loaderData.user ? <section className="student-section"><h2>{loaderData.user.displayName} 계정으로 참여</h2><p>이메일 인증을 마친 개인 회원 계정이 필요합니다. 공용 계정을 사용하지 마세요.</p><Form method="post" className="student-form"><input type="hidden" name="intent" value="accept" /><input type="hidden" name="token" value={token} /><button disabled={nav.state !== "idle"}>초대 수락하고 내 작업 열기</button></Form></section> : <section className="student-section"><h2>먼저 개인 계정으로 로그인해 주세요</h2><p>새 창에서 로그인하거나 회원가입과 이메일 인증을 마친 뒤 이 화면으로 돌아오세요.</p><div className="student-actions"><a href="/login?returnTo=%2Fstudent%2Fjoin" target="_blank" rel="noopener">로그인 새 창</a><a href="/signup" target="_blank" rel="noopener">회원가입 새 창</a></div><p><button className="student-button" onClick={() => revalidator.revalidate()} disabled={revalidator.state !== "idle"}>로그인 상태 확인</button></p></section>}
    <p className="student-help">작업공간에는 계정 연결, 업무 배정, 분류·확인·등록 인가 이력이 남으며 지정 운영 담당자가 확인합니다. 다른 사람에게 초대 링크를 전달하지 마세요. 이미 사용했거나 만료된 초대는 담당자에게 다시 요청하세요.</p>
  </StudentFrame>;
}
