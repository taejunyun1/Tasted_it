import { env } from "cloudflare:workers";
import { data, Form, isRouteErrorResponse, Link } from "react-router";
import type { Route } from "./+types/admin-activity";
import { requireAdmin } from "../features/auth/session.server";
import { ACTIVITY_KINDS, ACTIVITY_STATUS, ActivityInputError, activityHref, parseActivityQuery } from "../features/operations/admin-activity";
import { readAdminActivity } from "../features/operations/admin-activity.server";
import "../styles/admin-home.css";
import "../styles/admin-activity.css";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers: Route.HeadersFunction = () => PRIVATE_HEADERS;
export const meta: Route.MetaFunction = () => [{ title: "관리자 작업 이력 | Re:Taste" }, { name: "robots", content: "noindex, nofollow" }];
async function authorize(request: Request) {
  try { await requireAdmin(request); }
  catch (error) {
    if (error instanceof Response) {
      const headers = new Headers(error.headers);
      for (const [key, value] of Object.entries(PRIVATE_HEADERS)) headers.set(key, value);
      throw new Response(null, { status: error.status, statusText: error.statusText, headers });
    }
    throw new Response(null, { status: 503, headers: PRIVATE_HEADERS });
  }
}
export async function loader({ request }: Route.LoaderArgs) {
  await authorize(request);
  const now = new Date().toISOString();
  try {
    const query = parseActivityQuery(new URL(request.url).searchParams, now);
    const activity = await readAdminActivity(env.DB, query, now);
    return data({ ...activity, view: query.view, kind: query.kind, cursor: new URL(request.url).searchParams.get("cursor") }, { status: activity.detailMissing ? 404 : 200, headers: PRIVATE_HEADERS });
  } catch (error) {
    throw new Response(null, { status: error instanceof ActivityInputError ? 400 : 503, headers: PRIVATE_HEADERS });
  }
}
export async function action({ request }: Route.ActionArgs) {
  await authorize(request);
  return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: "GET, HEAD" } });
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 503;
  return <main id="main" className="admin-home"><h1>{status === 403 ? "관리자만 조회할 수 있습니다." : status === 400 ? "조회 조건을 확인해 주세요." : "작업 이력을 불러올 수 없습니다."}</h1>
    <p>{status === 400 ? "목록을 다시 열어 조회해 주세요." : "잠시 후 다시 시도해 주세요."}</p><Link to="/admin/activity">작업 이력 처음으로</Link></main>;
}
const time = (value: string | null) => value ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "미확인";
const JOB_STATUS: Record<string, string> = { PENDING: "접수·대기", RUNNING: "실행 중", COMPLETED: "완료", FAILED: "실패", UNKNOWN: "미확인" };
export default function AdminActivity({ loaderData }: Route.ComponentProps) {
  const state = loaderData, detail = state.detail;
  const currentPage = state.cursor ? { cursor: state.cursor } : undefined;
  return <main id="main" className="admin-home admin-activity">
    <header className="admin-home__header"><div><p className="admin-home__eyebrow">RE:TASTE / ADMIN</p><h1>관리자 작업 이력</h1><p>감사 기록과 작업 영수증을 읽기 전용으로 확인합니다.</p></div><Link to="/admin">운영 홈</Link></header>
    <nav className="admin-activity__tabs" aria-label="이력 종류">
      <Link to={activityHref({ view: "audit", kind: state.kind })} aria-current={state.view === "audit" ? "page" : undefined}>감사 기록</Link>
      <Link to={activityHref({ view: "operations", kind: state.kind })} aria-current={state.view === "operations" ? "page" : undefined}>작업 영수증</Link>
      <Link to="/admin/audit">원장 정합성 검사</Link>
    </nav>
    <Form method="get" className="admin-home__filter"><input type="hidden" name="view" value={state.view}/><label htmlFor="activity-kind">작업 종류</label><select name="kind" id="activity-kind" defaultValue={state.kind} key={state.kind}><option value="all">전체 종류</option>{Object.entries(ACTIVITY_KINDS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><button type="submit">조회</button></Form>
    <p className="admin-home__timestamp">목록 기준 <time dateTime={state.cutoff}>{time(state.cutoff)}</time> · 한 페이지 최대 {state.pageSize}건 · 현재 페이지 {state.rows.length}건</p>
    <p className="admin-home__note">확정 영수증은 변경이 접수된 기록입니다. 재계산 완료 여부는 영수증의 작업 상태를 확인하세요. 만료된 미리보기는 삭제되어 목록에서 사라질 수 있습니다.</p>
    {state.detailMissing && <p role="alert">해당 작업을 찾을 수 없습니다. 미리보기가 만료·정리되었는지 확인해 주세요.</p>}
    {detail && <section className="admin-activity__detail" aria-labelledby="activity-detail-title">
      <div className="admin-home__section-heading"><h2 id="activity-detail-title">선택한 작업 영수증</h2><Link to={activityHref(state, currentPage)}>닫기</Link></div>
      <h3>{detail.title}</h3><p><span className="admin-activity__status">{ACTIVITY_STATUS[detail.state]}</span> · {detail.actor}</p>
      <dl><div><dt>작업 ID</dt><dd><code>{detail.operationId}</code></dd></div><div><dt>접수 / 확정</dt><dd>{time(detail.createdAt)} / {time(detail.committedAt)}</dd></div><div><dt>미리보기 만료</dt><dd>{time(detail.expiresAt)}</dd></div><div><dt>대상 수</dt><dd>{detail.count ?? "미확인"}</dd></div><div><dt>감사·영수증 연결</dt><dd>{detail.auditLinked ? "일치 확인" : "미확인"}</dd></div>{detail.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
      {detail.resultUnavailable && <p>저장된 결과를 확인할 수 없습니다. 원문 대신 확인 가능한 기록만 표시합니다.</p>}
      {detail.job && <div className="admin-activity__job"><h3>재계산 작업 상태</h3><strong>{JOB_STATUS[detail.job.status]}</strong><p>{detail.job.reference} · 조회 {time(detail.job.checkedAt)} · 완료 시각 {time(detail.job.finishedAt)}</p></div>}
    </section>}
    <section aria-label={state.view === "audit" ? "감사 기록 목록" : "작업 영수증 목록"}>
      {state.rows.length ? <ol className="admin-activity__list">{state.rows.map((row) => <li key={row.key}>
        <div><h2>{row.title}</h2><p>{row.actor} · 대상 {row.target}</p><time dateTime={row.createdAt ?? undefined}>{time(row.createdAt)}</time></div>
        <div className="admin-activity__row-end"><span className="admin-activity__status">{ACTIVITY_STATUS[row.state]}</span>{row.operationId && <Link to={activityHref(state, { ...currentPage, operation: row.operationId })}>영수증 보기</Link>}</div>
      </li>)}</ol> : <p className="admin-activity__empty">현재 조건에 맞는 기록이 없습니다.</p>}
      <nav className="admin-activity__pagination" aria-label="이력 페이지"><Link to={activityHref(state)}>처음부터 조회</Link>{state.nextCursor && <Link to={activityHref(state, { cursor: state.nextCursor })}>다음 50건</Link>}</nav>
    </section>
  </main>;
}
