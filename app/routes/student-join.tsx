import { env } from "cloudflare:workers";
import { useEffect, useState } from "react";
import { data, Form, redirect, useLocation, useNavigation, useRevalidator } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/student-join";
import { createDb } from "../db/client.server";
import { getOptionalUser, requireUser } from "../features/auth/session.server";
import { acceptStudentInvite, getStudentSeat } from "../features/students/invitations.server";
import { recordStudentInviteFailure } from "../features/students/invite-attempts.server";
import { consumeStudentWriteLimit, ensureStudentWorkspace, readStudentForm, studentFailure } from "../features/students/http.server";
import { parseStudentInviteInput, recoverPendingInvite } from "../features/students/pending-invite";
import { inviteTokenSchema, NO_STORE_HEADERS } from "../features/students/policy";
import { StudentFrame, StudentNotice } from "../components/students/StudentFrame";
export { StudentErrorBoundary as ErrorBoundary } from "../components/students/StudentFrame";
export const headers = () => NO_STORE_HEADERS;
export const meta = () => [{ title: "학생 초대 수락 — Re:Taste" }, { name: "robots", content: "noindex,nofollow" }];
export async function loader({ request }: Route.LoaderArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED);
  const user = await getOptionalUser(request);
  if (user && await getStudentSeat(createDb(env.DB), { userId: user.id, now: new Date().toISOString() })) {
    return redirect("/student", { headers: NO_STORE_HEADERS });
  }
  return data({ user: user ? { displayName: user.displayName } : null }, { headers: NO_STORE_HEADERS });
}
export async function action({ request }: Route.ActionArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED);
  const user = await requireUser(request);
  const db = createDb(env.DB); const now = new Date();
  let diagnosticToken: string | null = null;
  try {
    const values = z.object({ intent: z.literal("accept"), token: inviteTokenSchema }).strict().parse(await readStudentForm(request));
    await consumeStudentWriteLimit(db, user.id, now, "JOIN");
    diagnosticToken = values.token;
    await acceptStudentInvite(db, { token: values.token, userId: user.id, now: now.toISOString() });
    return redirect("/student", { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (diagnosticToken) await recordStudentInviteFailure(db, { userId: user.id, token: diagnosticToken, error, now: now.toISOString() });
    return studentFailure(error);
  }
}
export default function StudentJoin({ loaderData, actionData }: Route.ComponentProps) {
  const [token, setToken] = useState(""); const nav = useNavigation(); const revalidator = useRevalidator(); const location = useLocation();
  const [inviteInput, setInviteInput] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  function restoreInvite() {
    const recovered = parseStudentInviteInput(inviteInput, window.location.origin);
    if (!recovered) {
      setRecoveryError("개인별 초대 링크 전체를 붙여넣어 주세요. 홈이나 로그인 주소만으로는 초대를 확인할 수 없습니다.");
      return;
    }
    try { recoverPendingInvite(window.sessionStorage, `#${recovered}`); } catch { /* This page remains usable without storage. */ }
    setInviteInput(""); setRecoveryError(""); setToken(recovered);
  }
  useEffect(() => {
    // Accessing sessionStorage itself can throw in restricted browsers.
    let recovered = "";
    try { recovered = recoverPendingInvite(window.sessionStorage, window.location.hash); }
    catch { const parsed = inviteTokenSchema.safeParse(window.location.hash.slice(1)); if (parsed.success) recovered = parsed.data; }
    setToken(recovered);
    if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, [location.key]);
  const recoveryPanel = <section className="student-section">
    <h2>{loaderData.user ? "로그인 완료 · 학생 초대 연결이 필요합니다" : "담당자가 보낸 개별 초대를 열어 주세요"}</h2>
    <p className="student-notice" role="status">{loaderData.user ? "로그인은 정상적으로 완료됐습니다. 아래에서 받은 초대 링크를 확인하면 수락 버튼이 표시됩니다." : "학생 작업을 시작하려면 본인에게 전달된 전체 초대 링크가 필요합니다."}</p>
    <p>로그인하거나 브라우저를 옮기는 동안 초대 정보가 사라졌다면, 받은 개인별 초대 링크를 여기에 붙여넣어 주세요.</p>
    <div className="student-form">
      <label htmlFor="student-invite-link">받은 개인별 초대 링크</label>
      <input id="student-invite-link" type="text" value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); restoreInvite(); } }} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={2048} placeholder="담당자가 보낸 초대 링크 전체" />
      <button type="button" onClick={restoreInvite}>초대 링크 확인</button>
      {recoveryError && <p className="student-notice" role="alert">{recoveryError}</p>}
    </div>
    <p>링크 확인 후 본인 이름을 확인하고 ‘초대 수락하고 내 작업 열기’를 눌러 주세요. 초대 링크는 다른 사람에게 공유하지 마세요.</p>
  </section>;
  return <StudentFrame title="개별 학생 초대" description="담당자가 보낸 초대를 본인 계정에 한 번 연결합니다.">
    <StudentNotice error={actionData?.error} />
    {!token ? recoveryPanel : loaderData.user ? <section className="student-section"><h2>{loaderData.user.displayName} 계정으로 참여</h2><p>이메일 인증을 마친 개인 회원 계정이 필요합니다. 공용 계정을 사용하지 마세요.</p><Form method="post" className="student-form"><input type="hidden" name="intent" value="accept" /><input type="hidden" name="token" value={token} /><button disabled={nav.state !== "idle"}>초대 수락하고 내 작업 열기</button></Form></section> : <section className="student-section"><h2>먼저 개인 계정으로 로그인해 주세요</h2><p>아래 버튼으로 로그인하거나 회원가입을 마치면 이 초대 화면으로 돌아옵니다. 이메일 가입은 인증을 마친 뒤 같은 브라우저에서 로그인해 주세요.</p><div className="student-actions"><a href="/login?returnTo=%2Fstudent%2Fjoin">로그인하고 초대 수락 계속하기</a><a href="/signup?returnTo=%2Fstudent%2Fjoin">회원가입하고 초대 수락 계속하기</a></div><p><button className="student-button" onClick={() => revalidator.revalidate()} disabled={revalidator.state !== "idle"}>로그인 상태 확인</button></p></section>}
    <p className="student-help">로그인만으로 초대가 수락되지는 않습니다. 이 화면에서 본인 이름을 확인하고 수락 버튼을 눌러 주세요. 새 창에서 인증했다면 원래 초대 탭으로 돌아와 ‘로그인 상태 확인’을 누르세요.</p>
    <p className="student-help">작업공간에는 계정 연결, 업무 배정, 분류·확인·등록 인가 이력이 남으며 지정 운영 담당자가 확인합니다. 다른 사람에게 초대 링크를 전달하지 마세요. 이미 사용했거나 만료된 초대는 담당자에게 다시 요청하세요.</p>
  </StudentFrame>;
}
