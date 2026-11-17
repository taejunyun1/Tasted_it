import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { data, isRouteErrorResponse, Link } from "react-router";
import type { Route } from "./+types/admin-providers";
import { createDb } from "../db/client.server";
import { parkingSyncRuns, publicDataSyncRuns } from "../db/schema";
import { requireAdmin } from "../features/auth/session.server";
import { readProviderUsage } from "../features/operations/provider-usage.server";
import "../styles/admin-home.css";
import "../styles/admin-activity.css";

const PATH = "/admin/providers";
const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers: Route.HeadersFunction = () => PRIVATE;
export const meta: Route.MetaFunction = () => [{ title: "공급자 사용량 | Re:Taste Admin" }, { name: "robots", content: "noindex, nofollow" }];

async function authorize(request: Request) {
  try { await requireAdmin(request); }
  catch (error) {
    if (error instanceof Response) {
      const headers = new Headers(error.headers);
      for (const [name, value] of Object.entries(PRIVATE)) headers.set(name, value);
      throw new Response(null, { status: error.status, statusText: error.statusText, headers });
    }
    throw new Response(null, { status: 503, headers: PRIVATE });
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  await authorize(request);
  const now = new Date().toISOString(), db = createDb(env.DB);
  const parkingFields = { status: parkingSyncRuns.status, records: parkingSyncRuns.fetchedCount, nextPage: parkingSyncRuns.nextPage, updatedAt: parkingSyncRuns.updatedAt };
  const [usage, publicRuns, parkingRuns, evRuns] = await Promise.all([
    readProviderUsage(env.DB, { now, env }),
    db.select({ status: publicDataSyncRuns.status, records: publicDataSyncRuns.fetchedCount, nextPage: publicDataSyncRuns.nextPage, updatedAt: publicDataSyncRuns.updatedAt })
      .from(publicDataSyncRuns).orderBy(desc(publicDataSyncRuns.updatedAt), desc(publicDataSyncRuns.id)).limit(1),
    db.select(parkingFields).from(parkingSyncRuns).where(eq(parkingSyncRuns.source, "PARKING"))
      .orderBy(desc(parkingSyncRuns.updatedAt), desc(parkingSyncRuns.id)).limit(1),
    db.select(parkingFields).from(parkingSyncRuns).where(eq(parkingSyncRuns.source, "EV"))
      .orderBy(desc(parkingSyncRuns.updatedAt), desc(parkingSyncRuns.id)).limit(1),
  ]);
  return data({ utcDay: usage.utcDay, queriedAt: usage.queriedAt, naver: usage.naver, other: {
    publicDataConfigured: Boolean(env.DATA_GO_KR_SERVICE_KEY?.trim()),
    mailConfigured: Boolean(env.RESEND_API_KEY?.trim() && env.RESEND_FROM_EMAIL?.trim()),
    publicRun: publicRuns[0] ?? null, parkingRun: parkingRuns[0] ?? null, evRun: evRuns[0] ?? null,
  } }, { headers: PRIVATE });
}

export async function action({ request }: Route.ActionArgs) {
  await authorize(request);
  return new Response(null, { status: 405, headers: { ...PRIVATE, Allow: "GET, HEAD" } });
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 503;
  return <main id="main" className="admin-home"><h1>{status === 403 ? "관리자만 조회할 수 있습니다." : "공급자 사용량을 불러올 수 없습니다."}</h1><p>실제 사용량을 확인하기 전에는 남은 횟수나 금액을 확정하지 않습니다.</p><Link to={PATH}>다시 조회</Link></main>;
}

function number(value: number | null) { return value === null ? "산정 안 됨" : value.toLocaleString("ko-KR"); }
function time(value: string | null) {
  if (!value) return "미기록";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" }).format(date) : "미확인";
}
type RunSummary = { status: string; records: number; nextPage: number; updatedAt: string } | null;
function RecentRun({ run }: { run: RunSummary }) {
  return run ? <p>최근 작업의 저장 상태 {run.status} · 누적 수집 {number(run.records)}개 레코드 · 다음 {run.nextPage}쪽<br/>갱신 {time(run.updatedAt)} (KST)</p> : <p>작업 기록 없음 · 실제 호출 수 미측정</p>;
}

export default function AdminProviders({ loaderData: state }: Route.ComponentProps) {
  const naver = state.naver;
  const regions = [{ key: "global", label: "전역" }, { key: "GWANGJU", label: "광주" }, { key: "JEONNAM", label: "전남" }] as const;
  const outcomes = [
    { label: "전송 시도 표식", value: naver.attempts.dispatched },
    { label: "응답 성공", value: naver.attempts.succeeded },
    { label: "응답 실패", value: naver.attempts.failed },
    { label: "결과 불명", value: naver.attempts.unknown },
    { label: "결과 대기", value: naver.attempts.pending },
  ];
  return <main id="main" className="admin-home admin-activity">
    <header className="admin-home__header"><div><p className="admin-home__eyebrow">RE:TASTE / ADMIN</p><h1>공급자 사용량</h1><p>서비스에 기록된 사용량과 측정 범위를 읽기 전용으로 확인합니다.</p></div><Link to="/admin">운영 홈</Link></header>
    <nav className="admin-activity__tabs" aria-label="공급자 운영"><Link to={PATH} aria-current="page">사용량</Link><Link to="/admin/place-operations">장소 검수</Link><Link to="/admin/operations">운영 현황</Link></nav>
    <p className="admin-home__timestamp">집계일 {state.utcDay} (UTC) · 조회 {time(state.queriedAt)} (KST) · <Link to={PATH}>새로 조회</Link></p>
    <p className="admin-home__note">공급자의 실제 수신·청구 내역은 조회하지 않았습니다. 청구 금액은 확인 안 됨이며, 기록이 없다는 이유로 0원으로 표시하지 않습니다.</p>
    <section className="admin-activity__detail" aria-labelledby="naver-usage-title">
      <h2 id="naver-usage-title">NAVER 지역검색</h2>
      <p><strong>{naver.cutoverState === "READY" ? "사용량 원장 준비 완료" : "사용량 원장 전환 보류"}</strong> · 외부 검수 기능 {naver.enabled ? "켜짐" : "꺼짐"}</p>
      <dl>
        <div><dt>자격정보 구성</dt><dd>{naver.configured ? "구성 있음" : "구성 없음"}</dd></div>
        <div><dt>한도 설정</dt><dd>{naver.configValid ? "유효" : "확인 필요 · 호출 차단"}</dd></div>
        <div><dt>전환 확인</dt><dd>{naver.cutoverVerified ? "확인 기록 있음" : "확인 전 · 호출 차단"}</dd></div>
        <div><dt>새 원장 사용 시작</dt><dd>{naver.readyAfterUtcDay ? `${naver.readyAfterUtcDay} (UTC)` : "확정 전"}</dd></div>
      </dl>
      <p>구성 있음은 연결 성공을 뜻하지 않습니다. 전환·기능·자격정보·한도 조건을 모두 통과한 요청만 실행됩니다.</p>
      <div className="admin-home__metrics" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
        {regions.map(({ key, label }) => <article key={key} className="admin-home__metric" aria-label={`${label} 사용량`}>
          <h3>{label}</h3><dl>
            <div><dt>적용 한도</dt><dd>{naver.limits[key] === null ? "산정 안 됨" : `${number(naver.limits[key])}회`}</dd></div>
            <div><dt>기존 실행이력 추정</dt><dd>{number(naver.legacy[key])}회</dd></div>
            <div><dt>새 예약 소모</dt><dd>{number(naver.reserved[key])}회</dd></div>
            <div><dt>기록된 사용 합계</dt><dd>{number(naver.used[key])}회</dd></div>
            <div><dt>남은 예약 가능량</dt><dd>{naver.remaining[key] === null ? "산정 안 됨" : `${number(naver.remaining[key])}회`}</dd></div>
          </dl>{naver.limits[key] !== null && naver.used[key] > naver.limits[key]! && <p>기록된 사용량이 현재 한도를 초과했습니다.</p>}
        </article>)}
      </div>
      <p className="admin-home__note">기존 실행이력은 추정치이며 새 예약과 구분합니다. 지역이 불명인 기존 기록은 광주·전남 양쪽에 보수적으로 포함하므로 지역 수치를 전역에 더하지 않습니다. 남은 양이 있어도 전환이 보류됐으면 호출할 수 없습니다.</p>
      <h3>오늘 새 요청의 결과 기록</h3>
      <div className="admin-home__metrics">{outcomes.map((item) => <article className="admin-home__metric" key={item.label}><span>{item.label}</span><strong>{number(item.value)}</strong><small>건</small></article>)}</div>
      <p className="admin-home__note">예약은 전송 전부터 횟수를 소모합니다. 전송 시도 표식은 공급자 수신의 증거가 아니며, 결과 대기·불명도 자동 환불하지 않습니다.</p>
    </section>
    <section className="admin-activity__detail" aria-labelledby="other-providers-title">
      <h2 id="other-providers-title">다른 공급자의 측정 범위</h2>
      <article><h3>공공 인허가 데이터</h3><p>자격정보 {state.other.publicDataConfigured ? "구성 있음" : "구성 없음"} · 실제 HTTP 호출 수 미측정 · 청구 금액 확인 안 됨</p><RecentRun run={state.other.publicRun}/><p>레코드 수·페이지는 호출 수가 아닙니다. 기존 기본 한 번에 최대 5페이지 범위를 유지합니다.</p></article>
      <article><h3>주차·전기차 충전 데이터</h3><p>자격정보 {state.other.publicDataConfigured ? "구성 있음" : "구성 없음"} · 실제 HTTP 호출 수 미측정 · 청구 금액 확인 안 됨</p><h4>주차</h4><RecentRun run={state.other.parkingRun}/><h4>전기차 충전</h4><RecentRun run={state.other.evRun}/><p>주차 정기 작업은 회당 최대 3페이지, 완료 기준 90일 주기를 사용합니다. EV는 지역별 응답 완전성 검사를 통과해야 반영됩니다.</p></article>
      <article><h3>AI</h3><p>일반 서비스의 공급자 실행 경로 없음 · 사용량 측정 없음 · 청구 금액 확인 안 됨</p><p>개발·실험용 기록을 서비스 사용량으로 합산하지 않습니다.</p></article>
      <article><h3>메일</h3><p>발신 설정 {state.other.mailConfigured ? "구성 있음" : "구성 없음"} · 도메인 검증 상태 미조회 · 발신 결과 미조회</p><p>지정 도메인의 검증과 결과 조회는 후속 작업입니다. 이 화면은 메일을 발송하지 않습니다.</p></article>
      <p className="admin-home__note">브라우저 지도·별도 좌표 검색·로그인 연동 호출은 NAVER 서버 지역검색 원장 범위 밖입니다. 계약상 무료 잔여량과 단가는 확인 안 됨입니다.</p>
    </section>
  </main>;
}
