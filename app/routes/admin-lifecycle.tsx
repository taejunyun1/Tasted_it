import { env } from "cloudflare:workers";
import { data, Link, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/admin-lifecycle";
import { requireAdmin } from "../features/auth/session.server";
import { readAdminLifecycle } from "../features/operations/admin-lifecycle.server";
import "../styles/admin-home.css";
import "../styles/admin-lifecycle.css";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers: Route.HeadersFunction = () => PRIVATE;
export const meta: Route.MetaFunction = () => [{ title: "비회원·보존 정리 현황 | Re:Taste" }, { name: "robots", content: "noindex, nofollow" }];
async function authorize(request: Request) {
  try { await requireAdmin(request); }
  catch (error) {
    const headers = new Headers(error instanceof Response ? error.headers : undefined);
    for (const [key, value] of Object.entries(PRIVATE)) headers.set(key, value);
    throw new Response(null, { status: error instanceof Response ? error.status : 503, headers });
  }
}
export async function loader({ request }: Route.LoaderArgs) {
  await authorize(request);
  if (new URL(request.url).searchParams.size) throw new Response(null, { status: 400, headers: PRIVATE });
  try { return data(await readAdminLifecycle(env.DB, new Date().toISOString()), { headers: PRIVATE }); }
  catch { throw new Response(null, { status: 503, headers: PRIVATE }); }
}
export async function action({ request }: Route.ActionArgs) {
  await authorize(request);
  return new Response(null, { status: 405, headers: { ...PRIVATE, Allow: "GET, HEAD" } });
}
function time(value: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "미관측";
}
const cleanupLabel: Record<string, string> = { COMPLETED: "온보딩 정리 완료 관측", PARTIAL_OR_UNKNOWN: "부분 수행·결과 불명", INCOMPLETE: "관측 기록 불완전", UNOBSERVED: "저장된 관측 없음" };
export default function AdminLifecycle({ loaderData: state }: Route.ComponentProps) {
  const sets = [
    { title: "비회원 세션", rows: state.guest, metrics: [["진행 중·미연결", state.guest.active], ["완료·미연결", state.guest.completed], ["건너뛰기·미연결", state.guest.skipped], ["계정 연결 표식", state.guest.merged], ["만료 조건 충족", state.guest.due]] },
    { title: "임시 저장 장소", rows: state.saves, metrics: [["만료 세션 연결", state.saves.due], ["이미 연결된 세션에 잔존", state.saves.merged]] },
    { title: "임시 취향 배지", rows: state.badges, metrics: [["만료 세션 연결", state.badges.due], ["이미 연결된 세션에 잔존", state.badges.merged]] },
    { title: "제품 이벤트", rows: state.events, metrics: [["정리 조건 충족", state.events.due], ["계정 연결 이벤트", state.events.conversions]] },
    { title: "요청 제한 시간창", rows: state.rates, metrics: [["정리 조건 충족", state.rates.due]] },
  ];
  return <main id="main" className="admin-home admin-lifecycle">
    <header className="admin-home__header"><div><p className="admin-home__eyebrow">RE:TASTE / ADMIN</p><h1>비회원·보존 정리 현황</h1><p>개별 이용자 자료 없이 현재 표본과 저장된 정리 관측을 확인합니다.</p></div><Link to="/admin">운영 홈</Link></header>
    <p className="admin-home__timestamp">조회 {time(state.queriedAt)} KST · <Link to="/admin/lifecycle">새로 조회</Link></p>
    <section className="admin-lifecycle__section"><h2>현재 코드의 기술 기준</h2>
      <ul><li>비회원 세션 최대 {state.technical.guestDays}일: 진행 중 유효 활동으로 갱신하며 완료·건너뛰기 뒤에는 활동만으로 연장하지 않습니다.</li>
        <li>임시 저장은 세션당 최대 {state.technical.saveLimit}곳입니다. 계정 연결은 기존 회원의 명시 선택을 우선합니다.</li>
        <li>제품 이벤트 {state.technical.eventDays}일, 요청 제한 시간창 {state.technical.rateWindowHours}시간의 기존 정리 조건을 사용합니다.</li></ul>
      <p className="admin-home__note">추가 법정 보존기간·삭제 요청 범위는 <a href="https://github.com/taejunyun1/Tasted_it/issues/360">#360</a>의 별도 미확정 사항입니다. 이 화면에서 기간 변경·대리 승계·수동 삭제는 제공하지 않습니다.</p>
    </section>
    <section className="admin-lifecycle__section"><h2>제한된 현재 표본</h2>
      <p>표마다 최근 저장순 최대 {state.sampleLimit.toLocaleString()}행만 집계합니다. 전체 건수나 실패율이 아니며, 서로 다른 표의 표본을 직접 합산하지 마세요.</p>
      <div className="admin-lifecycle__samples">{sets.map((set) => <article key={set.title}>
        <h3>{set.title}</h3><p className="admin-home__state">표본 {Number(set.rows.sampled).toLocaleString()}행{set.rows.truncated ? " · 상한 도달, 더 있음" : " · 현재 저장 행 전체"}</p>
        <dl>{set.metrics.map(([title, value]) => <div key={String(title)}><dt>{String(title)}</dt><dd>{Number(value).toLocaleString()}건</dd></div>)}</dl>
      </article>)}</div>
      <p className="admin-home__note">계정 연결 표식과 이벤트는 다른 근거입니다. 이벤트 저장은 연결 처리 뒤 별도로 이루어져 누락될 수 있습니다. 미연결을 실패로 세지 않으며, 연결 실패·재시도 횟수는 현재 영속 계측이 없습니다. 만료 세션 삭제에 따른 임시 저장·배지 정리는 참조 관계에 의해 함께 처리됩니다.</p>
    </section>
    <section className="admin-lifecycle__section"><h2>최근 온보딩 정리 관측</h2>
      <p className="admin-home__state">{cleanupLabel[state.cleanup.status]}</p>
      <dl className="admin-lifecycle__telemetry"><div><dt>관측 저장 시각</dt><dd>{time(state.cleanup.recordedAt)}</dd></div><div><dt>정리 기준 시각</dt><dd>{time(state.cleanup.cutoff)}</dd></div>
        <div><dt>정리된 비회원 세션</dt><dd>{state.cleanup.guestSessions ?? "미측정"}</dd></div><div><dt>정리된 제품 이벤트</dt><dd>{state.cleanup.productEvents ?? "미측정"}</dd></div><div><dt>정리된 요청 제한 시간창</dt><dd>미측정</dd></div></dl>
      <p>최근 감사 {state.sampleLimit.toLocaleString()}건에서 마지막 정리 관측을 찾습니다. 기록 없음은 정리가 실행되지 않았다는 뜻이 아닙니다. 이 기능 적용 이전 이력, 프로세스 중단과 관측 저장 실패의 공백은 복원하지 않습니다.</p>
      <p className="admin-home__note">완료는 이 온보딩 정리 함수의 반환 결과입니다. 전체 maintenance·사진 삭제·운영 복원 완료를 뜻하지 않습니다. 실패는 일부 삭제가 이미 수행됐을 수 있는 결과 불명으로 남깁니다. 기존 cron과 정리 조건은 유지합니다.</p>
    </section>
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <main id="main" className="admin-home"><h1>{isRouteErrorResponse(error) && error.status === 403 ? "관리자만 조회할 수 있습니다." : "보존 현황을 불러올 수 없습니다."}</h1><p>현재 권한을 확인하고 다시 조회해 주세요.</p><Link to="/admin">운영 홈</Link></main>;
}
