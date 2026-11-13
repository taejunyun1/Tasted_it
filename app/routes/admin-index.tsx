import { env } from "cloudflare:workers";
import { data, Form, isRouteErrorResponse, Link } from "react-router";
import type { Route } from "./+types/admin-index";
import { createDb } from "../db/client.server";
import { requireAdmin } from "../features/auth/session.server";
import { ADMIN_CONTROL_AREAS, ADMIN_CONTROL_REGISTRY, parseAdminControlArea } from "../features/operations/admin-control-registry";
import { getAdminHomeSummary } from "../features/operations/admin-home.server";
import "../styles/admin-home.css";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const meta: Route.MetaFunction = () => [{ title: "운영 홈 | Re:Taste" }, { name: "robots", content: "noindex, nofollow" }];
export const headers: Route.HeadersFunction = () => PRIVATE_HEADERS;

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
  } catch (error) {
    if (error instanceof Response) {
      const responseHeaders = new Headers(error.headers);
      for (const [name, value] of Object.entries(PRIVATE_HEADERS)) responseHeaders.set(name, value);
      throw new Response(error.body, { status: error.status, statusText: error.statusText, headers: responseHeaders });
    }
    throw new Response(null, { status: 503, headers: PRIVATE_HEADERS });
  }
  const queriedAt = new Date().toISOString();
  const area = parseAdminControlArea(new URL(request.url).searchParams.get("area"));
  try {
    const summary = await getAdminHomeSummary(createDb(env.DB), queriedAt);
    return data({ summary, queriedAt, area, state: "AVAILABLE" as const }, { headers: PRIVATE_HEADERS });
  } catch {
    return data({ summary: null, queriedAt, area, state: "UNAVAILABLE" as const }, { status: 503, headers: PRIVATE_HEADERS });
  }
}

const STATUS_LABELS = { READ_ONLY: "조회 제공", PARTIAL: "부분 기능", NOT_IMPLEMENTED: "관리 화면 없음" } as const;
const formatCount = (value: number | undefined) => value === undefined ? "—" : value.toLocaleString("ko-KR");

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const forbidden = isRouteErrorResponse(error) && error.status === 403;
  return <main id="main" className="admin-home">
    <h1>{forbidden ? "이 페이지를 볼 권한이 없습니다." : "운영 정보를 확인할 수 없습니다."}</h1>
    <p>{forbidden ? "관리자 계정으로 로그인해 주세요." : "잠시 후 다시 시도해 주세요."}</p>
    <Link to="/">처음으로 돌아가기</Link>
  </main>;
}

export default function AdminIndex({ loaderData }: Route.ComponentProps) {
  const { summary, queriedAt, area, state } = loaderData;
  const entries = ADMIN_CONTROL_REGISTRY.filter((entry) => area === "all" || entry.area === area);
  const queriedTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "medium" }).format(new Date(queriedAt));
  const metrics = [
    { label: "공개 장소", value: summary?.catalog.published, detail: "현재 공개 상태", href: "/admin/places" },
    { label: "초안·숨김 장소", value: summary ? summary.catalog.draft + summary.catalog.hidden : undefined, detail: summary ? `초안 ${formatCount(summary.catalog.draft)} · 숨김 ${formatCount(summary.catalog.hidden)}` : "현재 비공개 상태", href: "/admin/places" },
    { label: "진행 중 검수", value: summary?.reviewQueue.active, detail: "검수 대기열 5단계 합계", href: "/admin/place-operations" },
    { label: "보류 검수", value: summary?.reviewQueue.onHold, detail: "보류 상태의 검수 항목", href: "/admin/place-operations" },
    { label: "열린 경보", value: summary?.openAlerts.count, detail: summary?.openAlerts.capped ? "100건 이상 · 상한에 도달한 부분 집계" : "최근 열린 경보 · 최대 100건 조회", href: "/admin/operations" },
  ];
  return <main id="main" className="admin-home">
    <header className="admin-home__header">
      <div><p className="admin-home__eyebrow">RE:TASTE / ADMIN</p><h1>운영 홈</h1><p>현재 집계와 관리 가능한 작업을 한곳에서 확인합니다.</p></div>
      <div><Link className="admin-home__primary" to="/admin/place-operations">장소 검수 열기 <span aria-hidden="true">↗</span></Link><p><Link to="/admin/temp-catalog">TEMP100 관리</Link> · <Link to="/admin/identities">관리자·세션 관리</Link></p></div>
    </header>
    <section className="admin-home__snapshot" aria-labelledby="snapshot-title">
      <div className="admin-home__section-heading"><div><h2 id="snapshot-title">현재 운영 집계</h2><p>출처: 서비스 DB의 장소·검수 대기열·운영 경보</p></div><span className={`admin-home__state${state === "UNAVAILABLE" ? " admin-home__state--unknown" : ""}`}>{state === "AVAILABLE" ? "집계 조회 완료" : "집계 미확인"}</span></div>
      <p className="admin-home__timestamp">{state === "AVAILABLE" ? "조회 시각" : "조회 시도"} <time dateTime={queriedAt}>{queriedTime} KST</time> · <Link to={area === "all" ? "/admin" : `/admin?area=${area}`} reloadDocument>새로 조회</Link></p>
      {state === "UNAVAILABLE" && <p className="admin-home__notice" role="alert">집계 정보를 불러오지 못했습니다. 숫자는 미확인 상태이며, 잠시 후 다시 조회해 주세요.</p>}
      <div className="admin-home__metrics">{metrics.map((metric) => <Link className="admin-home__metric" to={metric.href} key={metric.label}><span>{metric.label}</span><strong>{formatCount(metric.value)}{metric.label === "열린 경보" && summary?.openAlerts.capped ? "+" : ""}</strong><small>{metric.detail}</small></Link>)}</div>
      <p className="admin-home__note">집계는 조회 시점의 상태입니다. 경보는 최대 100건이며, 조회 성공만으로 작업 완료나 서비스 정상 작동이 확인되지는 않습니다.</p>
    </section>
    <section className="admin-home__controls" aria-labelledby="controls-title">
      <div className="admin-home__section-heading"><div><h2 id="controls-title">관리 영역 <span>34</span></h2><p>현재 제공 범위와 다음 보완 작업을 구분합니다.</p></div><Form method="get" className="admin-home__filter"><label htmlFor="admin-control-area">분야</label><select id="admin-control-area" name="area" defaultValue={area} key={area}><option value="all">전체 분야</option>{ADMIN_CONTROL_AREAS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><button type="submit">보기</button></Form></div>
      <p className="admin-home__note">현재 권한은 각 화면의 ADMIN 검사 기준입니다. 세부 작업 권한이 구현되었다는 뜻은 아닙니다. 운영 검증 상태는 별도 증거 연결 전까지 미확인으로 표시합니다.</p>
      <p className="admin-home__results" aria-live="polite">{entries.length}개 영역 표시 · 기능 목록 기준 2026-11-14</p>
      <div className="admin-home__registry">{entries.map((entry) => <article className="admin-control" key={entry.id}>
        <div className="admin-control__top"><span className="admin-control__id">{entry.id}</span><span className={`admin-control__status admin-control__status--${entry.status.toLowerCase()}`}>{STATUS_LABELS[entry.status]}</span></div>
        <h3>{entry.title}</h3><p className="admin-control__task">{entry.task}</p>
        <dl><div><dt>현재 범위</dt><dd>{entry.currentScope}</dd></div><div><dt>현재 권한</dt><dd>{entry.currentPermission ?? "연결된 관리 화면 없음"}</dd></div><div><dt>운영 검증</dt><dd>미확인</dd></div><div><dt>다음 보완</dt><dd>{entry.nextStep}</dd></div></dl>
        {entry.href ? <Link className="admin-control__link" to={entry.href}>{entry.title} 열기 <span aria-hidden="true">→</span></Link> : <p className="admin-control__unavailable">연결할 관리 화면이 아직 없습니다.</p>}
      </article>)}</div>
    </section>
  </main>;
}
