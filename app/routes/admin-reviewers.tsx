import { env } from "cloudflare:workers";
import { data, Form, isRouteErrorResponse, Link, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-reviewers";
import { requireAdminSession } from "../features/auth/session.server";
import { getAdminAssurance } from "../features/auth/admin-assurance.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { commitReviewerAdmin, getReviewerAdminPreview, listReviewerAdmin, prepareReviewerAdmin } from "../features/reviewers/reviewer-admin.server";
import { REVIEWER_CHANGES, REVIEWER_RESULT_CODES, reviewerChangeSchema, type ReviewerItemResult } from "../features/reviewers/reviewer-admin";
import "../styles/admin-home.css";
import "../styles/admin-reviewers.css";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
const STATUS: Record<string, string> = { ALL: "전체", APPLIED: "신청 대기", REVIEWING: "검토 중", ACTIVE: "활동", DORMANT: "휴면", SUSPENDED: "정지", REJECTED: "반려" };
export const headers: Route.HeadersFunction = () => PRIVATE;
export const meta: Route.MetaFunction = () => [{ title: "리뷰어 관리 | Re:Taste" }, { name: "robots", content: "noindex, nofollow" }];
async function formInput(request: Request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) throw new Error("REVIEWER_ADMIN_INPUT_INVALID");
  const reader = request.body?.getReader(); let length = 0; const chunks: Uint8Array[] = [];
  if (reader) try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
    if (length > 16384) { await reader.cancel(); throw new Error("REVIEWER_ADMIN_INPUT_INVALID"); } chunks.push(part.value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const params = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const values: Record<string, unknown> = Object.create(null);
  for (const key of new Set(params.keys())) {
    if (key === "targetIds") values[key] = params.getAll(key);
    else { if (params.getAll(key).length !== 1) throw new Error("REVIEWER_ADMIN_INPUT_INVALID"); values[key] = params.get(key); }
  }
  return values;
}
function message(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (error instanceof z.ZodError || code === "REVIEWER_ADMIN_INPUT_INVALID") return "변경 종류·선택 대상(최대 25명)·사유를 확인해 주세요.";
  if (code === "ADMIN_OPERATION_CONFLICT") return "미리보기 이후 대상이나 근거가 바뀌어 선택한 변경은 모두 적용하지 않았습니다. 다시 조회해 주세요.";
  if (code === "ADMIN_OPERATION_RESULT_UNKNOWN") return "변경 결과를 확인하지 못했습니다. 같은 작업의 영수증을 다시 확인해 주세요.";
  return "작업을 확인할 수 없습니다. 현재 권한과 미리보기 만료 여부를 확인한 뒤 다시 조회해 주세요.";
}
export async function loader({ request }: Route.LoaderArgs) {
  const { user, sessionId } = await requireAdminSession(request), now = new Date();
  const url = new URL(request.url);
  for (const key of ["status", "q", "operation"]) if (url.searchParams.getAll(key).length > 1) throw new Response(null, { status: 400, headers: PRIVATE });
  const status = url.searchParams.get("status") ?? "ALL", query = url.searchParams.get("q") ?? "", operationId = url.searchParams.get("operation");
  if (!Object.hasOwn(STATUS, status) || query.length > 100 || (operationId && !z.uuid().safeParse(operationId).success)) throw new Response(null, { status: 400, headers: PRIVATE });
  const caller = { actorUserId: user.id, sessionId, now: now.toISOString() };
  const rows = await listReviewerAdmin(env.DB, { ...caller, status, query });
  let preview: Awaited<ReturnType<typeof getReviewerAdminPreview>> | null = null;
  let previewUnavailable = false;
  if (operationId) try { preview = await getReviewerAdminPreview(env.DB, { ...caller, operationId }); } catch { previewUnavailable = true; }
  return data({ ...rows, preview, previewUnavailable, assurance: await getAdminAssurance(env.DB, { ...caller, now }) }, { headers: PRIVATE });
}
export async function action({ request }: Route.ActionArgs) {
  const { user, sessionId } = await requireAdminSession(request);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...PRIVATE, Allow: "POST" } });
  if (!isSameOriginMutation(request)) return data({ error: "현재 서비스에서 다시 요청해 주세요.", transient: null, preview: null }, { status: 403, headers: PRIVATE });
  const caller = { actorUserId: user.id, sessionId, now: new Date().toISOString() };
  let operationId: string | null = null;
  try {
    const values = await formInput(request);
    if (values.intent === "prepare") {
      const { intent: _, ...candidate } = values;
      const parsed = reviewerChangeSchema.parse({ ...candidate, targetIds: candidate.targetIds ?? [] });
      const prepared = await prepareReviewerAdmin(env.DB, { ...caller, ...parsed });
      if (!prepared.operationId) return data({ error: null, transient: null, preview: prepared.preview }, { headers: PRIVATE });
      return redirect(`/admin/reviewers?operation=${encodeURIComponent(prepared.operationId)}`, { headers: PRIVATE });
    }
    const parsed = z.object({ intent: z.literal("commit"), operationId: z.uuid() }).strict().parse(values);
    operationId = parsed.operationId;
    await commitReviewerAdmin(env.DB, { ...caller, operationId });
    return redirect(`/admin/reviewers?operation=${encodeURIComponent(operationId)}`, { headers: PRIVATE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (operationId && code === "ADMIN_RECENT_AUTH_REQUIRED") return redirect(`/admin/reauth?returnTo=${encodeURIComponent(`/admin/reviewers?operation=${operationId}`)}`, { headers: PRIVATE });
    let transient: ReviewerItemResult[] | null = null;
    if (operationId && ["ADMIN_OPERATION_CONFLICT", "ADMIN_OPERATION_RESULT_UNKNOWN"].includes(code)) {
      const current = await getReviewerAdminPreview(env.DB, { ...caller, operationId }).catch(() => null);
      if (current?.committed) return redirect(`/admin/reviewers?operation=${encodeURIComponent(operationId)}`, { headers: PRIVATE });
      if (current && !current.committed) transient = current.items.map((item) => ({ targetRef: item.targetRef, outcome: item.outcome === "SKIPPED" ? "SKIPPED" : code === "ADMIN_OPERATION_CONFLICT" ? "NOT_APPLIED" : "UNKNOWN", code: item.outcome === "SKIPPED" ? item.code : code === "ADMIN_OPERATION_CONFLICT" ? "BATCH_CONFLICT" : "RESULT_UNKNOWN" }));
    }
    return data({ error: message(error), transient, preview: null }, { status: code === "ADMIN_OPERATION_CONFLICT" ? 409 : code === "ADMIN_OPERATION_RESULT_UNKNOWN" ? 503 : 400, headers: PRIVATE });
  }
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 503;
  return <main id="main" className="admin-home"><h1>{status === 403 ? "관리자만 조회할 수 있습니다." : "리뷰어 관리를 열 수 없습니다."}</h1><Link to="/admin/reviewers">다시 조회</Link></main>;
}
const outcomeLabels = { READY: "변경 예정", SKIPPED: "제외", APPLIED: "반영", NOT_APPLIED: "미반영", UNKNOWN: "미확인" };
export default function AdminReviewers({ loaderData, actionData }: Route.ComponentProps) {
  const preview = actionData?.preview ?? loaderData.preview;
  const results = actionData?.transient ?? (preview?.committed ? preview.result.results : null);
  const resultNames: Record<string, string> = !preview ? {} : preview.committed ? preview.displayNames : Object.fromEntries(preview.items.map((item) => [item.targetRef, item.name]));
  const conflicted = actionData?.transient?.some((item) => item.outcome === "NOT_APPLIED");
  return <main id="main" className="admin-home reviewer-admin">
    <header className="admin-home__header"><div><p className="admin-home__eyebrow">ADMIN / REVIEWER REGISTRY</p><h1>리뷰어 관리</h1><p>신청 근거와 활동 상태를 확인한 뒤 선택한 변경만 확정합니다.</p></div><Link to="/admin">운영 홈</Link></header>
    <nav className="reviewer-admin__tabs" aria-label="리뷰어 상태">{Object.entries(STATUS).map(([status, label]) => <Link key={status} aria-current={loaderData.status === status ? "page" : undefined} to={`/admin/reviewers?status=${status}`}>{label}</Link>)}</nav>
    <Form method="get" className="admin-home__filter"><input type="hidden" name="status" value={loaderData.status}/><label htmlFor="reviewer-query">이름·이메일 검색</label><input id="reviewer-query" name="q" maxLength={100} defaultValue={loaderData.query}/><button>조회</button></Form>
    <p className="admin-home__note">각 목록은 최대 50명입니다. 한 번에 같은 변경을 최대 25명에게 미리볼 수 있습니다. 일반 승인 기준은 기존과 같이 신청 당시 승인 제안 10곳이며, 현재 수치는 별도로 확인합니다.</p>
    {loaderData.limited && <p>목록 상한에 도달했습니다. 상태나 검색어로 범위를 좁혀 주세요.</p>}
    {actionData?.error && <p className="reviewer-admin__notice" role="alert">{actionData.error}</p>}
    {loaderData.previewUnavailable && <p className="reviewer-admin__notice">미리보기나 영수증을 확인할 수 없습니다. 새로 선택해 주세요.</p>}
    {preview && <section className="reviewer-admin__preview" aria-labelledby="reviewer-preview-title"><h2 id="reviewer-preview-title">{preview.committed ? "작업 영수증" : "변경 미리보기"}</h2>
      {preview.committed ? <p>요청 {preview.result.requestedCount}명 · 반영 {preview.result.appliedCount}명 · 제외 {preview.result.skippedCount}명</p> : <><p>{REVIEWER_CHANGES[preview.change]} · 요청 {preview.requestedCount}명</p>
        <p>활동 재개·휴면·정지는 기존 승인 콘텐츠의 노출과 리뷰어 점수 참여 자격에 영향을 줍니다. 철회·반려된 방문 기록이나 사진의 검수 상태는 바꾸지 않습니다.</p>
        <ul>{preview.items.map((item) => <li key={item.targetRef}><strong>{item.name}</strong> · {outcomeLabels[item.outcome]} · {REVIEWER_RESULT_CODES[item.code] ?? "확인 필요"}
          {item.submittedCount !== null && <span> · 신청 당시 {item.submittedCount} / 미리보기 당시 현재 {item.currentCount}</span>}</li>)}</ul>
        {"operationId" in preview && typeof preview.operationId === "string" && !conflicted && <Form method="post"><input type="hidden" name="intent" value="commit"/><input type="hidden" name="operationId" value={preview.operationId}/><button>{actionData?.transient ? "같은 요청 결과 다시 확인" : "선택한 변경 확정"}</button></Form>}
        {!loaderData.assurance && <p>변경 확정에는 최근 관리자 재인증이 필요합니다.</p>}</>}
      {results && <ul>{results.map((item) => <li key={item.targetRef}>{resultNames[item.targetRef] ?? "대상 확인 불가"} · {item.targetRef} · {outcomeLabels[item.outcome]} · {REVIEWER_RESULT_CODES[item.code] ?? "확인 필요"}</li>)}</ul>}
      <Link to="/admin/reviewers">새로 선택</Link>
    </section>}
    <section className="reviewer-admin__section"><h2>리뷰어 신청</h2><Form method="post"><input type="hidden" name="intent" value="prepare"/>
      <div className="reviewer-admin__controls"><label>변경 <select name="change"><option value="START_REVIEW">검토 시작</option><option value="APPROVE">일반 승인</option><option value="OVERRIDE_APPROVE">예외 승인</option><option value="REJECT">반려</option></select></label><label>사유 <input name="reason" maxLength={300}/></label><button>선택 신청 미리보기</button></div>
      {loaderData.applications.map((row) => <article className="reviewer-admin__row" key={row.id}><label><input type="checkbox" name="targetIds" value={row.id}/>{row.name} 신청 선택</label><p>{STATUS[row.status]} · version {row.version} · 신청 당시 승인 {row.submittedCount} / 현재 승인 {row.currentCount}</p><p>{row.statement}</p><small>{row.occupation} · {row.tasteDirection}</small></article>)}
      {!loaderData.applications.length && <p>현재 조건에 맞는 신청이 없습니다.</p>}</Form></section>
    <section className="reviewer-admin__section"><h2>리뷰어 활동 상태</h2><Form method="post"><input type="hidden" name="intent" value="prepare"/>
      <div className="reviewer-admin__controls"><label>변경 <select name="change"><option value="ACTIVE">활동 재개</option><option value="DORMANT">휴면</option><option value="SUSPENDED">정지</option></select></label><label>사유 <input name="reason" maxLength={300}/></label><button>선택 상태 미리보기</button></div>
      {loaderData.profiles.map((row) => <article className="reviewer-admin__row" key={row.id}><label><input type="checkbox" name="targetIds" value={row.id}/>{row.name} 상태 선택</label><p>{STATUS[row.status]} · version {row.version} · 마지막 활동 {row.lastActivityAt}</p><p>{row.tasteDirection}</p></article>)}
      {!loaderData.profiles.length && <p>현재 조건에 맞는 활동 기록이 없습니다.</p>}</Form>
      <Form method="post"><input type="hidden" name="intent" value="prepare"/><input type="hidden" name="change" value="AUTO_DORMANCY"/><input type="hidden" name="reason" value=""/><button>90일 휴면 후보 최대 25명 미리보기</button></Form>
    </section>
  </main>;
}
