import { env } from "cloudflare:workers";
import { data, Form, isRouteErrorResponse, Link, useNavigation } from "react-router";
import type { Route } from "./+types/admin-records";
import { requireAdminSession } from "../features/auth/session.server";
import { getAdminAssurance } from "../features/auth/admin-assurance.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { ACTIVITY_KINDS, ActivityInputError } from "../features/operations/admin-activity";
import { EXPORT_MAX_DAYS, EXPORT_MAX_ROWS, ExportInputError, parseExportQuery } from "../features/operations/admin-records";
import { exportAdminActivity } from "../features/operations/admin-records.server";
import { readPolicyVersions, UNRESOLVED_POLICY_FACTS } from "../features/operations/admin-policy.server";
import "../styles/admin-home.css";
import "../styles/admin-records.css";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
export const headers: Route.HeadersFunction = () => PRIVATE;
export const meta: Route.MetaFunction = () => [{ title: "기록 내보내기·정책 문서 | Re:Taste" }, { name: "robots", content: "noindex, nofollow" }];
async function authorize(request: Request) {
  try { return await requireAdminSession(request); }
  catch (error) {
    const headers = new Headers(error instanceof Response ? error.headers : undefined);
    for (const [key, value] of Object.entries(PRIVATE)) headers.set(key, value);
    throw new Response(null, { status: error instanceof Response ? error.status : 503, headers });
  }
}
async function readInput(request: Request) {
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !== "application/x-www-form-urlencoded") throw new ExportInputError();
  const reader = request.body?.getReader();
  if (!reader) throw new ExportInputError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new ExportInputError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return parseExportQuery(new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
  catch { throw new ExportInputError(); }
}
export async function loader({ request }: Route.LoaderArgs) {
  const { user, sessionId } = await authorize(request);
  try {
    const now = new Date();
    return data({ documents: await readPolicyVersions(), unresolved: UNRESOLVED_POLICY_FACTS,
      canExport: Boolean(await getAdminAssurance(env.DB, { actorUserId: user.id, sessionId, now })),
      today: now.toISOString().slice(0, 10), from: new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10),
    }, { headers: PRIVATE });
  } catch { throw new Response(null, { status: 503, headers: PRIVATE }); }
}
export async function action({ request }: Route.ActionArgs) {
  const { user, sessionId } = await authorize(request);
  if (request.method !== "POST") return data({ error: "POST 요청만 가능합니다.", result: null }, { status: 405, headers: { ...PRIVATE, Allow: "GET, HEAD, POST" } });
  if (!isSameOriginMutation(request)) return data({ error: "현재 사이트에서 다시 요청해 주세요.", result: null }, { status: 403, headers: PRIVATE });
  try {
    const query = await readInput(request);
    const result = await exportAdminActivity(env.DB, { actorUserId: user.id, sessionId, now: new Date().toISOString(), query });
    return data({ error: null, result }, { headers: PRIVATE });
  } catch (error) {
    const invalid = error instanceof ExportInputError || error instanceof ActivityInputError;
    const auth = error instanceof Error && ["ADMIN_REAUTH_REQUIRED", "ADMIN_REQUIRED"].includes(error.message);
    return data({ result: null, error: invalid ? "기간·종류·행 수 또는 다음 페이지 조건을 확인해 주세요." : auth ? "최근 재인증을 완료한 뒤 다시 요청해 주세요." : "내보내기를 생성하지 못했습니다. 다시 조회해 주세요." },
      { status: invalid ? 400 : auth ? 403 : 503, headers: PRIVATE });
  }
}
function download(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function AdminRecords({ loaderData: state, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle", result = actionData?.result;
  return <main id="main" className="admin-home admin-records">
    <header className="admin-home__header"><div><p className="admin-home__eyebrow">RE:TASTE / ADMIN</p><h1>기록 내보내기·정책 문서</h1><p>감사 목록의 제한된 필드와 현재 코드의 정책 문서를 확인합니다.</p></div><Link to="/admin">운영 홈</Link></header>
    <section className="admin-records__section" aria-labelledby="export-title">
      <h2 id="export-title">감사 목록 CSV</h2>
      <p>UTC 날짜 기준 최대 {EXPORT_MAX_DAYS}일, 한 번에 {EXPORT_MAX_ROWS}건까지 생성합니다. 기록·행위자·대상 참조, 시각, 작업 이름과 상태만 포함합니다.</p>
      <p className="admin-home__note">이메일, 자유 사유와 원문 payload는 포함하지 않습니다. 현재 상태의 전체 백업이 아니며 생성 이력은 감사에 남습니다.</p>
      {!state.canExport && <p className="admin-home__notice">내보내기에는 최근 재인증이 필요합니다. <Link to="/admin/reauth?returnTo=%2Fadmin%2Frecords">재인증하기</Link></p>}
      <Form method="post" className="admin-records__form">
        <label>시작일 (UTC)<input name="from" type="date" defaultValue={state.from} required /></label>
        <label>종료일 (UTC, 포함)<input name="to" type="date" defaultValue={state.today} required /></label>
        <label>목록<select name="view" defaultValue="audit"><option value="audit">감사 기록</option><option value="operations">작업 영수증</option></select></label>
        <label>작업 종류<select name="kind" defaultValue="all"><option value="all">전체 종류</option>{Object.entries(ACTIVITY_KINDS).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
        <label>최대 행 수<input name="limit" type="number" min="1" max={EXPORT_MAX_ROWS} defaultValue="50" required /></label>
        <button disabled={busy || !state.canExport}>{busy ? "생성 중…" : "CSV 생성"}</button>
      </Form>
      {actionData?.error && <p role="alert">{actionData.error}</p>}
      {result && <div className="admin-records__result" aria-live="polite">
        <h3>CSV 생성됨 · {result.rowCount}건</h3>
        <p>{result.filters.from} – {result.filters.to} UTC · {result.filters.view === "audit" ? "감사 기록" : "작업 영수증"} · {result.filters.kind === "all" ? "전체 종류" : ACTIVITY_KINDS[result.filters.kind]}</p>
        <p>목록 기준 {result.cutoff}. {result.truncated ? "행 상한에 도달해 나머지 기록이 있습니다. 같은 조건으로 다음 페이지를 생성하세요." : "이 조건의 마지막 페이지입니다."}</p>
        <button type="button" onClick={() => download(result.csv, result.filename)}>CSV 다운로드</button>
        {result.nextCursor && <Form method="post">{Object.entries(result.filters).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}<input type="hidden" name="cursor" value={result.nextCursor} /><button disabled={busy || !state.canExport}>같은 조건의 다음 페이지 생성</button></Form>}
        <p className="admin-home__note">감사 기록은 CSV 생성 사실을 뜻하며 실제 파일 저장 완료를 확인한 기록은 아닙니다.</p>
      </div>}
      <p><Link to="/admin/activity">감사·작업 이력 조회</Link></p>
    </section>
    <section className="admin-records__section" aria-labelledby="policy-title">
      <h2 id="policy-title">정책 문서 버전·초안</h2>
      <p>아래 링크는 현재 서비스 코드에 포함된 원문입니다. 변경 초안은 저장소의 해당 파일을 수정한 PR에서 검토하며, 이 화면은 문안을 편집하거나 시행하지 않습니다.</p>
      <div className="admin-records__documents">{state.documents.map((document) => <article key={document.id}>
        <h3>{document.title}</h3><p className="admin-home__state">{document.status}</p>
        <dl><div><dt>시행일</dt><dd>{document.effectiveDate ?? "미확정 · 원문과 #360 확인"}</dd></div><div><dt>현재 코드 원문 SHA-256</dt><dd><code>{document.sourceHash}</code></dd></div></dl>
        <Link to={document.href} target="_blank" rel="noopener">현재 원문 보기 <span className="sr-only">(새 탭)</span></Link>
      </article>)}</div>
      <h3>별도로 확인할 실제 운영 사실</h3><ul>{state.unresolved.map((fact) => <li key={fact}>{fact}</li>)}</ul>
      <p className="admin-home__note"><a href="https://github.com/taejunyun1/Tasted_it/issues/360" target="_blank" rel="noopener">#360 확인 기록</a> · 문서의 구현 기준과 실제 운영·법적 사실은 구분합니다. 검토자와 시행 승인은 관련 PR에서 확인합니다.</p>
    </section>
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <main id="main" className="admin-home"><h1>{isRouteErrorResponse(error) && error.status === 403 ? "관리자만 조회할 수 있습니다." : "기록 화면을 불러올 수 없습니다."}</h1><p>현재 권한을 확인한 뒤 다시 시도해 주세요.</p><Link to="/admin">운영 홈</Link></main>;
}
