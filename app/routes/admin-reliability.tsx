import { env } from "cloudflare:workers";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/admin-reliability";
import { requireAdmin, readSessionId } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { commitAlertResolution, prepareAlertResolution, readAlertResolution } from "../features/operations/alert-resolution.server";
import { readReliability } from "../features/operations/reliability.server";
import { RELIABILITY_EVIDENCE } from "../features/operations/reliability-evidence";
import "../styles/admin-home.css";
import "../styles/admin-activity.css";

const PATH = "/admin/reliability";
const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers: Route.HeadersFunction = () => PRIVATE;
export const meta: Route.MetaFunction = () => [{ title: "점검·경보·검증 근거 | Re:Taste Admin" }, { name: "robots", content: "noindex, nofollow" }];
async function authorize(request: Request) {
  try { return await requireAdmin(request); }
  catch (error) {
    const headers = new Headers(error instanceof Response ? error.headers : undefined);
    for (const [key, value] of Object.entries(PRIVATE)) headers.set(key, value);
    throw new Response(null, { status: error instanceof Response ? error.status : 503, headers });
  }
}
export async function loader({ request }: Route.LoaderArgs) {
  const admin = await authorize(request), now = new Date().toISOString();
  const operationId = new URL(request.url).searchParams.get("operation");
  if (operationId !== null && (!operationId || operationId.length > 128)) throw new Response(null, { status: 400, headers: PRIVATE });
  let operation: Awaited<ReturnType<typeof readAlertResolution>> | null = null;
  let operationError = false;
  if (operationId) {
    try { operation = await readAlertResolution(env.DB, { actorUserId: admin.id, sessionId: readSessionId(request) ?? "", now, operationId }); }
    catch { operationError = true; }
  }
  return data({ ...await readReliability(env.DB, now), operation, operationError, evidence: RELIABILITY_EVIDENCE }, { headers: PRIVATE });
}
function failure(code: string) {
  if (code === "ADMIN_OPERATION_CONFLICT") return "미리보기 이후 경보가 변경됐습니다. 최신 경보에서 다시 검토해 주세요.";
  if (code === "ADMIN_OPERATION_EXPIRED") return "미리보기가 만료됐습니다. 다시 검토해 주세요.";
  if (code === "ALERT_INPUT_INVALID") return "처리 사유를 5~300자로 입력해 주세요.";
  if (code === "ALERT_UNAVAILABLE") return "열린 경보를 찾을 수 없습니다.";
  if (code === "ADMIN_OPERATION_RESULT_UNKNOWN") return "결과를 확인할 수 없습니다. 같은 요청으로 다시 확인해 주세요.";
  return "요청을 처리하지 못했습니다. 현재 경보와 권한을 다시 확인해 주세요.";
}
async function readForm(request: Request) {
  const reader = request.body?.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Response(null, { status: 413, headers: PRIVATE }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const form = await new Response(body, { headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/octet-stream" } }).formData();
    const keys = [...form.keys()];
    if (keys.length > 4 || new Set(keys).size !== keys.length || keys.some((key) => !["intent", "alertId", "note", "operationId"].includes(key))
      || [...form.values()].some((value) => typeof value !== "string")) throw new Error("INVALID_FORM");
    return form;
  } catch { throw new Response(null, { status: 400, headers: PRIVATE }); }
}
export async function action({ request }: Route.ActionArgs) {
  const admin = await authorize(request);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...PRIVATE, Allow: "GET, HEAD, POST" } });
  if (!isSameOriginMutation(request)) return data({ message: "요청 출처를 확인할 수 없습니다.", retry: null }, { status: 403, headers: PRIVATE });
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) throw new Response(null, { status: 413, headers: PRIVATE });
  const form = await readForm(request), intent = String(form.get("intent") ?? ""), operationId = String(form.get("operationId") ?? "");
  const operator = { actorUserId: admin.id, sessionId: readSessionId(request) ?? "", now: new Date().toISOString() };
  try {
    if (intent === "confirm") {
      const result = await commitAlertResolution(env.DB, { ...operator, operationId });
      return redirect(`${PATH}?${new URLSearchParams({ operation: result.operationId })}`, { headers: PRIVATE });
    }
    if (intent !== "prepare") return data({ message: "처리할 경보를 선택해 주세요.", retry: null }, { status: 400, headers: PRIVATE });
    const result = await prepareAlertResolution(env.DB, { ...operator, alertId: String(form.get("alertId") ?? ""), note: String(form.get("note") ?? "") });
    return redirect(`${PATH}?${new URLSearchParams({ operation: result.operationId })}`, { headers: PRIVATE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ADMIN_RECENT_AUTH_REQUIRED") throw redirect(`/admin/reauth?${new URLSearchParams({ returnTo: `${PATH}?${new URLSearchParams({ operation: operationId })}` })}`, { headers: PRIVATE });
    return data({ message: failure(code), retry: code === "ADMIN_OPERATION_RESULT_UNKNOWN" ? operationId : null }, { status: 400, headers: PRIVATE });
  }
}
const stateLabel: Record<string, string> = { PASSED: "고정 경로 정상", FAILED: "경로 실패", INCOMPLETE: "기록 불완전", SKIPPED: "점검 생략" };
const typeLabel: Record<string, string> = { PUBLIC_DATA_SYNC: "공공 수집", RATING_RECOMPUTE: "평가 재계산", NAVER_LOCAL_SEARCH: "NAVER 검증", UNKNOWN: "종류 미확인" };
function time(value: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "미기록"; }
export function ErrorBoundary() { return <main className="admin-home"><h1>점검 기록을 불러올 수 없습니다.</h1><Link to={PATH}>다시 조회</Link></main>; }
export default function AdminReliability({ loaderData: state, actionData }: Route.ComponentProps) {
  const pending = useNavigation().state !== "idle", operation = state.operation;
  return <main id="main" className="admin-home admin-activity">
    <header className="admin-home__header"><div><p className="admin-home__eyebrow">RE:TASTE / ADMIN</p><h1>점검·경보·검증 근거</h1><p>저장된 관측과 사람의 처리 기록을 확인합니다.</p></div><Link to="/admin">운영 홈</Link></header>
    <nav className="admin-activity__tabs" aria-label="운영 기록"><Link to={PATH} aria-current="page">점검·경보</Link><Link to="/admin/operations">운영 현황</Link><Link to="/admin/activity">감사 이력</Link></nav>
    <p>조회 {time(state.queriedAt)} (KST) · <Link to={PATH}>새로 조회</Link></p>
    <p className="admin-home__note">HTTP 경로 점검, 사람이 남긴 처리 기록, 배포·백업 자료는 서로 다른 근거입니다. 정상 응답이나 경보 처리만으로 실제 복구를 완료했다고 판단하지 않습니다.</p>
    {actionData?.message && <p role="alert">{actionData.message}</p>}{state.operationError && <p role="alert">변경 요청을 확인할 수 없습니다. 현재 경보에서 다시 검토해 주세요.</p>}
    {actionData?.retry && <Form method="post"><input type="hidden" name="intent" value="confirm"/><input type="hidden" name="operationId" value={actionData.retry}/><button disabled={pending}>같은 요청 결과 확인</button></Form>}
    {operation && <section className="admin-activity__detail"><h2>{operation.status === "PENDING" ? "경보 처리 미리보기" : "사람의 처리 기록 완료"}</h2><p>이 작업은 경보를 검토 처리로 표시합니다. 실제 장애 회복·작업 성공을 증명하지 않습니다.</p>
      {operation.status === "PENDING" ? <><p>사유: {operation.note}</p><p>만료 {time(operation.expiresAt)} · 확정 시 최근 인증과 경보 변경 여부를 다시 확인합니다.</p><Form method="post"><input type="hidden" name="intent" value="confirm"/><input type="hidden" name="operationId" value={operation.operationId}/><button disabled={pending}>검토 처리 확정</button></Form></> : <Link to={`/admin/activity?${new URLSearchParams({ view: "operations", operation: operation.operationId })}`}>감사 영수증 확인</Link>}
    </section>}
    <section className="admin-activity__detail"><h2>고정 공개 경로 점검</h2><p>6시간 주기 · 기록이 12시간을 넘으면 오래됨으로 표시합니다. 이 화면 조회는 새 점검을 실행하지 않습니다.</p>
      <p>최근 정기 점검: {state.scheduled ? `${stateLabel[state.scheduled.status]} · ${time(state.scheduled.checkedAt)}${state.scheduled.stale ? " · 오래됨/시각 확인 필요" : ""}` : "기록 없음"}</p>
      {state.rsi.length ? <ol>{state.rsi.map((run) => <li key={run.id}><h3>{stateLabel[run.status]}{run.stale ? " · 오래됨/시각 확인 필요" : ""}</h3><p>{run.trigger === "scheduled" ? "정기 실행" : run.trigger === "admin" ? "관리자 실행" : "실행 방식 미확인"} · {time(run.checkedAt)}</p>{run.paths.length ? <ul>{run.paths.map((path) => <li key={path.path}><code>{path.path}</code> · HTTP {path.status} · {path.ok ? "기대 응답 확인" : "실패"}</li>)}</ul> : <p>완전한 6경로 결과를 확인할 수 없습니다.</p>}</li>)}</ol> : <p>저장된 점검 기록이 없습니다.</p>}<p>최근 최대 20건. 내부 토큰 점검은 감사가 남지 않을 수 있으며, 기록 없음은 정상 동작의 증거가 아닙니다.</p>
    </section>
    <section className="admin-activity__detail"><h2>운영 경보</h2><p>열린 경보 우선 최대 50건. 원문 오류·개인정보는 이 화면에 표시하지 않습니다.</p>
      {state.alerts.length ? state.alerts.map((alert) => <article key={alert.id}><h3>{typeLabel[alert.type]} · {alert.severity === "ERROR" ? "오류" : "주의"} · {alert.status === "OPEN" ? "열림" : "검토 처리됨"}</h3><p>발생 {alert.occurrences}회 · 최근 {time(alert.lastAt)}</p>
        {alert.status === "OPEN" ? <Form method="post" className="admin-home__filter"><input type="hidden" name="intent" value="prepare"/><input type="hidden" name="alertId" value={alert.id}/><label className="grid gap-2">처리 사유<input name="note" minLength={5} maxLength={300} required className="rounded-xl border px-3 py-2"/></label><button disabled={pending}>검토 처리 미리보기</button></Form> : <p>사람의 처리 기록 {time(alert.resolvedAt)} · 실제 회복 검증은 별도</p>}
      </article>) : <p>조회된 경보가 없습니다. 실제 서비스 정상 여부는 별도 확인해야 합니다.</p>}
    </section>
    <section className="admin-activity__detail"><h2>버전이 고정된 검증 근거</h2><p>검토된 자료만 연결합니다. 표시된 SHA-256은 저장 파일의 식별값이며 실제 운영 복원 성공을 뜻하지 않습니다.</p>
      {state.evidence.map((entry) => <article key={entry.path}><h3><a href={entry.href} target="_blank" rel="noopener noreferrer">{entry.title}</a></h3><p>{entry.kind === "LOCAL_SYNTHETIC" ? "로컬 합성 연습" : "과거 배포·경로 확인"}</p><p style={{ overflowWrap: "anywhere" }}>자료 commit <code>{entry.sourceCommit}</code><br/>SHA-256 <code>{entry.sha256}</code></p></article>)}
      <p>현재 운영 배포·실효 설정은 지정 운영 기록과 대조해야 합니다. 실제 운영 백업의 최신성·완전성 및 운영 복원 성공은 이 화면에서 검증하지 않았습니다.</p>
    </section>
  </main>;
}
