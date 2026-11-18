import { env } from "cloudflare:workers";
import { Form, Link, data, isRouteErrorResponse, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/admin-data-sync";
import { createDb } from "../db/client.server";
import { listPublicSyncStates } from "../features/candidates/sync.server";
import { commitPublicSyncOperation, preparePublicSyncOperation, readPublicSyncOperation } from "../features/candidates/public-sync-admin.server";
import { requireAdmin, readSessionId } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers = () => PRIVATE;
const sourceLabels: Record<string, string> = { GENERAL_RESTAURANT: "일반음식점", REST_CAFE: "휴게음식점", BAKERY: "제과점", ENTERTAINMENT_BAR: "유흥주점" };
const statusLabels: Record<string, string> = { PENDING: "재개 대기", RUNNING: "실행 중", COMPLETED: "완료", FAILED: "실패", CANCELLED: "취소", UNKNOWN: "결과 불명" };

export async function loader({ request }: Route.LoaderArgs) {
  const admin = await requireAdmin(request), now = new Date().toISOString();
  const operationId = new URL(request.url).searchParams.get("operation");
  let preview: Awaited<ReturnType<typeof readPublicSyncOperation>> | null = null;
  let error: string | null = null;
  const sessionId = readSessionId(request);
  if (operationId && sessionId) {
    try { preview = await readPublicSyncOperation(env.DB, { actorUserId: admin.id, sessionId, now, operationId }); }
    catch { error = "이 확인 요청을 재개할 수 없습니다. 최신 작업에서 다시 검토해 주세요."; }
  }
  const runs = await listPublicSyncStates(createDb(env.DB), now);
  return { runs, blockedByLegacyRun: runs.some(run => run.blockedByLegacyRun), preview, error,
    configured: Boolean(env.DATA_GO_KR_SERVICE_KEY?.trim()) };
}

function failureMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    PUBLIC_SYNC_LEGACY_UNVERIFIED: "소유권을 확인할 수 없는 이전 실행이 있어 새 실행과 재개를 중단했습니다. 운영 절차에서 해당 실행을 먼저 확인해 주세요.",
    PUBLIC_SYNC_EXISTS: "같은 출처의 미완료 작업이 있습니다. 해당 작업을 재개하거나 취소해 주세요.",
    PUBLIC_SYNC_NOT_FOUND: "작업을 찾을 수 없습니다.",
    PUBLIC_SYNC_NOT_CONFIGURED: "공공데이터 연결이 설정되지 않아 실행할 수 없습니다.",
    PUBLIC_SYNC_ACTION_UNAVAILABLE: "현재 실행 상태 또는 실패 상한으로 이 작업을 수행할 수 없습니다.",
    ADMIN_OPERATION_CONFLICT: "검토 후 작업 상태가 바뀌었습니다. 최신 상태에서 다시 검토해 주세요.",
    ADMIN_OPERATION_EXPIRED: "확인 시간이 지났습니다. 다시 검토해 주세요.",
    ADMIN_OPERATION_RESULT_UNKNOWN: "접수 결과를 확인할 수 없습니다. 같은 요청을 다시 확인해 주세요.",
    ADMIN_OPERATION_UNAVAILABLE: "이 확인 요청을 사용할 수 없습니다.",
  };
  return messages[code] ?? "출처·주소 구분·처리 사유와 현재 권한을 확인해 주세요.";
}

export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("Forbidden", { status: 403, headers: PRIVATE });
  const admin = await requireAdmin(request), sessionId = readSessionId(request);
  if (!sessionId) throw new Response("Unauthorized", { status: 401, headers: PRIVATE });
  const form = await request.formData(), intent = String(form.get("intent") ?? "");
  const operator = { actorUserId: admin.id, sessionId, now: new Date().toISOString() };
  if (!env.DATA_GO_KR_SERVICE_KEY?.trim() && intent !== "cancel" && intent !== "confirm")
    return data({ ok: false, error: "공공데이터 연결이 설정되지 않았습니다.", preview: null, result: null, retryOperationId: null }, { status: 503, headers: PRIVATE });
  const operationId = String(form.get("operationId") ?? "");
  try {
    if (intent === "confirm") {
      const result = await commitPublicSyncOperation(env.DB, { ...operator, operationId }, { serviceKey: env.DATA_GO_KR_SERVICE_KEY ?? "" });
      return data({ ok: true, error: null, preview: null, result, retryOperationId: null }, { headers: PRIVATE });
    }
    if (!["start", "resume", "cancel"].includes(intent)) throw new Error("INVALID_INTENT");
    const prepared = await preparePublicSyncOperation(env.DB, { ...operator,
      action: intent.toUpperCase(), sourceType: String(form.get("sourceType") ?? ""), addressField: String(form.get("addressField") ?? ""),
      runId: String(form.get("runId") ?? "") || undefined, reason: String(form.get("reason") ?? ""),
    });
    const preview = await readPublicSyncOperation(env.DB, { ...operator, operationId: prepared.operationId });
    return data({ ok: true, error: null, preview, result: null, retryOperationId: null }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_RECENT_AUTH_REQUIRED") {
      throw redirect(`/admin/reauth?returnTo=${encodeURIComponent(`/admin/data-sync?operation=${encodeURIComponent(operationId)}`)}`);
    }
    return data({ ok: false, error: failureMessage(error), preview: null, result: null, retryOperationId: intent === "confirm" ? operationId : null }, { status: 400, headers: PRIVATE });
  }
}

export function meta() { return [{ title: "공공데이터 작업 — Re:Taste Admin" }]; }
export default function AdminDataSync({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const preview = actionData?.preview ?? loaderData.preview;
  const result = actionData?.result;
  return <main id="main" className="admin-rating-shell">
    <header><p className="eyebrow">ADMIN / PUBLIC DATA</p><h1>공공데이터 동기화</h1><Link to="/admin/place-operations?step=1">장소 검수</Link>
      <p>한 번에 최대 5페이지, 페이지당 100행을 처리합니다. 요청 재시도는 페이지당 최대 3회이며 실패한 페이지 전체를 다시 처리합니다.</p>
      <p>실패는 최대 3회까지 허용합니다. 완료된 페이지와 원본 자료는 유지하고, 취소하면 이 공공 인허가 수집의 이후 요청과 저장을 중단합니다. NAVER 검증·자동 검수는 별도 작업입니다.</p></header>
    {(actionData?.error || loaderData.error) && <p role="alert" className="admin-notice">{actionData?.error || loaderData.error}</p>}
    {actionData?.retryOperationId && <p><Link to={`/admin/data-sync?operation=${encodeURIComponent(actionData.retryOperationId)}`}>같은 요청 결과 다시 확인</Link></p>}
    {loaderData.blockedByLegacyRun && <p className="admin-notice" role="alert">이전 버전의 실행 소유권이 미확인되어 모든 공공 동기화의 새 실행과 재개를 중단했습니다. 기존 자료는 보존합니다.</p>}
    {!loaderData.configured && <p className="admin-notice">공공데이터 연결 미설정: 새 실행·재개를 사용할 수 없습니다.</p>}
    <section className="admin-rating-section"><h2>새 동기화</h2><Form method="post">
      <input type="hidden" name="intent" value="start"/>
      <label>출처<select name="sourceType">{Object.entries(sourceLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>주소 구분<select name="addressField"><option value="ROAD_NM_ADDR">도로명 주소</option><option value="LOTNO_ADDR">지번 주소</option></select></label>
      <label>실행 사유<input name="reason" required maxLength={300}/></label><button disabled={busy || !loaderData.configured || loaderData.blockedByLegacyRun}>실행 미리보기</button>
    </Form></section>
    {preview && <section className="admin-rating-section" aria-label="동기화 실행 확인"><h2>동기화 실행 확인</h2>
      <p>{sourceLabels[preview.sourceType]} · {preview.addressField === "ROAD_NM_ADDR" ? "도로명" : "지번"} · {preview.action === "START" ? "새로 시작" : preview.action === "RESUME" ? "재개" : "취소"}</p>
      <p style={{overflowWrap:"anywhere"}}>작업 ID: {preview.runId}</p>
      {"reason" in preview && <p>사유: {preview.reason}</p>}
      <p>{preview.action === "CANCEL" ? "공공 인허가 수집과 저장만 중단합니다. 이미 허용된 외부 요청은 끝날 수 있지만 그 결과를 저장하지 않습니다. 별도 NAVER 검증·자동 검수는 취소 대상이 아닙니다." : "확정 후에만 외부 조회를 실행합니다. 최신 상태와 최근 인증을 다시 확인합니다."}</p>
      {preview.status === "PENDING" ? <Form method="post"><input type="hidden" name="intent" value="confirm"/><input type="hidden" name="operationId" value={preview.operationId}/><button disabled={busy}>확인 후 반영</button></Form> : <p>이미 접수된 요청입니다. 아래 현재 작업 상태를 확인해 주세요.</p>}
      <Link to="/admin/data-sync">확인 닫기</Link></section>}
    {result && <section className="admin-notice" role="status"><h2>요청 결과</h2><p>접수 {result.replayed ? "재확인" : "완료"} · 현재 작업: {result.run ? statusLabels[result.run.status] : "결과 불명"}</p><p style={{overflowWrap:"anywhere"}}>작업 ID: {result.accepted.runId}</p><Link to={`/admin/data-sync?operation=${encodeURIComponent(result.operationId)}`}>같은 요청과 현재 상태 다시 확인</Link></section>}
    <section className="admin-rating-section"><h2>최근 작업</h2><p>최근 50건입니다. 누적 처리 행수와 외부 요청 시도 수는 다릅니다. 이전 버전에서 시작한 작업의 요청 수는 과거 호출을 포함하지 않습니다.</p><Link to="/admin/data-sync">현재 상태 새로고침</Link>
      {loaderData.runs.length ? loaderData.runs.map((run) => <article key={run.id} className="integrity-case"><div>
        <strong>{sourceLabels[run.sourceType] ?? run.sourceType} · {statusLabels[run.status]}</strong><p style={{overflowWrap:"anywhere"}}>작업 ID: {run.id}</p>
        <p>{run.addressField === "ROAD_NM_ADDR" ? "도로명" : "지번"} · 다음 페이지 {run.nextPage} · 처리 {run.fetchedCount}행 · 요청 {run.requestCount}회</p>
        <p>실행 {run.attempts}회 · 실패 {run.retryCount}/{run.failureLimit} · 갱신 {run.updatedAt}</p>
        {run.blockedByOtherRun && <p>같은 출처와 주소 구분의 다른 미완료 작업이 있어 재개할 수 없습니다.</p>}
        {run.unmanaged && <p>이전 버전의 실행은 쓰기 소유권을 확인할 수 없습니다. 자동 재개·취소를 중단했으며 운영 절차에서 실행 종료와 자료 상태를 확인해야 합니다.</p>}
        {run.interrupted && !run.unmanaged && <p>실행 기한이 지났습니다. 이전 실행의 결과는 불명이며 재개 시 이전 저장 권한을 차단합니다.</p>}
        {run.active && <p>실행 중 · 임대 만료 {run.leaseExpiresAt}</p>}
        {run.errorSummary && <p>실패 코드: {run.errorSummary}</p>}
      </div><Form method="post"><input type="hidden" name="runId" value={run.id}/><label>처리 사유<input name="reason" required maxLength={300}/></label>
        <button name="intent" value="resume" disabled={busy || !run.canResume || !loaderData.configured}>재개 미리보기</button>
        <button name="intent" value="cancel" disabled={busy || !run.canCancel}>취소 미리보기</button></Form></article>) : <p>실행 기록이 없습니다.</p>}
    </section>
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const forbidden = isRouteErrorResponse(error) && error.status === 403;
  return <main id="main" className="admin-rating-shell"><h1>{forbidden ? "관리자만 조회할 수 있습니다." : "동기화 작업을 읽을 수 없습니다."}</h1><p>{forbidden ? "관리자 계정으로 로그인했는지 확인해 주세요." : "연결 상태를 확인한 뒤 다시 시도해 주세요."}</p><Link to="/admin">관리자 홈</Link></main>;
}
