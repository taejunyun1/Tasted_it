import { env } from "cloudflare:workers";
import { data, Link } from "react-router";
import type { Route } from "./+types/admin-operations";
import { createDb } from "../db/client.server";
import { requireAdmin } from "../features/auth/session.server";
import { getOperationalDashboard } from "../features/operations/dashboard.server";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers = () => PRIVATE;
async function authorize(request: Request) {
  try { return await requireAdmin(request); }
  catch (error) {
    const headers = new Headers(error instanceof Response ? error.headers : undefined);
    for (const [key, value] of Object.entries(PRIVATE)) headers.set(key, value);
    throw new Response(null, { status: error instanceof Response ? error.status : 503, headers });
  }
}
export async function loader({ request }: Route.LoaderArgs) {
  await authorize(request);
  const dashboard = await getOperationalDashboard(createDb(env.DB), { now: new Date().toISOString() });
  return data({ ...dashboard, alerts: dashboard.alerts.map(({ id, severity, alertType, occurrenceCount, lastOccurredAt }) => ({ id, severity, alertType, occurrenceCount, lastOccurredAt })) }, { headers: PRIVATE });
}
export async function action({ request }: Route.ActionArgs) {
  await authorize(request);
  return new Response(null, { status: 405, headers: { ...PRIVATE, Allow: "GET, HEAD" } });
}
export function meta() { return [{ title: "운영 현황 — Re:Taste Admin" }]; }
export default function AdminOperations({ loaderData }: Route.ComponentProps) {
  const week = loaderData.windows.find((item) => item.label === "7일");
  const queue = loaderData.reviewQueue;
  return (
    <main id="main" className="admin-rating-shell">
      <header>
        <p className="eyebrow">ADMIN / OPERATIONS</p>
        <h1>운영 현황</h1>
        <p>실제 D1 실행 이력으로 수집·검수·NAVER 검증·실패 상태를 확인합니다. 외부 이메일 알림은 운영 문의 주소 확정 후 연결합니다.</p>
        <Link to="/admin/place-operations?step=1">장소 검수로 이동</Link>
      </header>
      <section className="admin-rating-section" aria-labelledby="review-throughput">
        <h2 id="review-throughput">검수 처리량</h2>
        <p>최근 7일 공개 {week?.reviewPublished ?? 0}곳 · 하루 {loaderData.publishedPerDay7d.toFixed(2)}곳. ACTIVE 큐 {queue.activeTotal}곳. 보류 {queue.onHoldTotal}곳.</p>
        <div className="admin-rating-stats">
          <article><span>7일 공개</span><strong>{week?.reviewPublished ?? 0}</strong></article>
          <article><span>7일 공개/일</span><strong>{loaderData.publishedPerDay7d.toFixed(2)}</strong></article>
          <article><span>ACTIVE 큐</span><strong>{queue.activeTotal}</strong></article>
          <article><span>보류</span><strong>{queue.onHoldTotal}</strong></article>
          <article><span>공개 장소</span><strong>{loaderData.catalog.published}</strong></article>
        </div>
        <dl>
          <div><dt>1단계 원천</dt><dd>{queue.SOURCE_REVIEW}</dd></div>
          <div><dt>2단계 NAVER</dt><dd>{queue.NAVER_VERIFICATION}</dd></div>
          <div><dt>3단계 분류</dt><dd>{queue.CATEGORY_CONFIRMATION}</dd></div>
          <div><dt>4단계 중복</dt><dd>{queue.DUPLICATE_REVIEW}</dd></div>
          <div><dt>5단계 최종</dt><dd>{queue.FINAL_APPROVAL}</dd></div>
          <div><dt>공개 / 숨김 / 초안</dt><dd>{loaderData.catalog.published} / {loaderData.catalog.hidden} / {loaderData.catalog.draft}</dd></div>
        </dl>
      </section>
      <section className="ops-dashboard-grid">{loaderData.windows.map((item) => <article key={item.label}><h2>{item.label}</h2><dl><div><dt>신규 후보</dt><dd>{item.candidates}</dd></div><div><dt>검수 공개 / 보류 / 제외</dt><dd>{item.reviewPublished} / {item.reviewHeld} / {item.reviewExcluded}</dd></div><div><dt>레거시 승인 / 반려</dt><dd>{item.approvals} / {item.rejections}</dd></div><div><dt>NAVER 검증 / 실패</dt><dd>{item.naverVerified} / {item.naverFailed}</dd></div><div><dt>동기화 / 재계산 실패</dt><dd>{item.syncFailed} / {item.recomputeFailed}</dd></div></dl></article>)}</section>
      <section className="admin-rating-section"><h2>누락</h2><p>좌표 없는 영업 후보 <strong>{loaderData.missingCoordinates}</strong>곳</p></section>
      <section className="admin-rating-section"><h2>열린 운영 알림</h2><p>{loaderData.alerts.length}건 표시 · <Link to="/admin/reliability">안전한 경보 검토와 점검 기록 확인</Link></p></section>
    </main>
  );
}
