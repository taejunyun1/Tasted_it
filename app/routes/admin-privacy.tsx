import { env } from "cloudflare:workers";
import { data, Form, isRouteErrorResponse, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/admin-privacy";
import { readSessionId, requireAdmin } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { commitPrivacyRequestUpdate, listPrivacyRequests, preparePrivacyRequestUpdate, readPrivacyRequestUpdate } from "../features/privacy/privacy-request.server";
import { commitPhotoCleanupRetry, listPhotoCleanupJobs, preparePhotoCleanupRetry, readPhotoCleanupRetry } from "../features/privacy/photo-cleanup-admin.server";
import { cleanupStatusLabels, privacyDecisionLabels, privacyKindLabels, privacyStatusLabels, privacyTime } from "../features/privacy/privacy";
import "../styles/admin-home.css";
import "../styles/admin-activity.css";

const PATH = "/admin/privacy";
const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers: Route.HeadersFunction = () => PRIVATE;
export const meta: Route.MetaFunction = () => [{ title: "개인정보 요청·사진 정리 | Re:Taste Admin" }];
async function authorize(request: Request) {
  try { return await requireAdmin(request); }
  catch (error) { if (error instanceof Response) { const headers = new Headers(error.headers); for (const [key, value] of Object.entries(PRIVATE)) headers.set(key, value); throw new Response(null, { status: error.status, headers }); } throw new Response(null, { status: 503, headers: PRIVATE }); }
}
function isKind(value: string | null): value is "PHOTO_CLEANUP_RETRY" | "PRIVACY_REQUEST_UPDATE" { return value === "PHOTO_CLEANUP_RETRY" || value === "PRIVACY_REQUEST_UPDATE"; }
export async function loader({ request }: Route.LoaderArgs) {
  const admin = await authorize(request), now = new Date().toISOString(), url = new URL(request.url);
  let lists;
  try { lists = await Promise.all([listPrivacyRequests(env.DB, url.searchParams.get("requestsCursor")), listPhotoCleanupJobs(env.DB, url.searchParams.get("cleanupCursor"), now)]); }
  catch (error) { throw new Response(null, { status: error instanceof Error && error.message === "PRIVACY_CURSOR_INVALID" ? 400 : 503, headers: PRIVATE }); }
  const operationId = url.searchParams.get("operation"), kind = url.searchParams.get("kind"), sessionId = readSessionId(request);
  let preview = null, previewError = null;
  if (operationId && isKind(kind) && sessionId) {
    try { const operator = { actorUserId: admin.id, sessionId, now, operationId }; preview = kind === "PHOTO_CLEANUP_RETRY" ? { operationKind: kind, ...await readPhotoCleanupRetry(env.DB, operator) } : { operationKind: kind, ...await readPrivacyRequestUpdate(env.DB, operator) }; }
    catch { previewError = "이 확인을 재개할 수 없습니다. 현재 상태에서 다시 검토해 주세요."; }
  }
  return data({ requests: lists[0], cleanup: lists[1], preview, previewError, now }, { headers: PRIVATE });
}
export async function action({ request }: Route.ActionArgs) {
  const admin = await authorize(request);
  if (!isSameOriginMutation(request)) return data({ error: "요청 출처를 확인할 수 없습니다." }, { status: 403, headers: PRIVATE });
  const sessionId = readSessionId(request); if (!sessionId) throw new Response(null, { status: 401, headers: PRIVATE });
  const form = await request.formData(), intent = String(form.get("intent") ?? ""), operationId = String(form.get("operationId") ?? ""), requestedKind = String(form.get("kind") ?? "");
  const operator = { actorUserId: admin.id, sessionId, now: new Date().toISOString() };
  let kind: "PHOTO_CLEANUP_RETRY" | "PRIVACY_REQUEST_UPDATE";
  try {
    if (intent === "confirm" && isKind(requestedKind)) {
      kind = requestedKind;
      if (kind === "PHOTO_CLEANUP_RETRY") await commitPhotoCleanupRetry(env.DB, { ...operator, operationId });
      else await commitPrivacyRequestUpdate(env.DB, { ...operator, operationId });
      return redirect(`${PATH}?${new URLSearchParams({ kind, operation: operationId })}`, { headers: PRIVATE });
    }
    const result = intent === "prepare-cleanup" ? (kind = "PHOTO_CLEANUP_RETRY", await preparePhotoCleanupRetry(env.DB, { ...operator, reviewId: String(form.get("reviewId") ?? "") }))
      : intent === "prepare-request" ? (kind = "PRIVACY_REQUEST_UPDATE", await preparePrivacyRequestUpdate(env.DB, { ...operator, requestId: String(form.get("requestId") ?? ""), decision: String(form.get("decision") ?? "") })) : null;
    if (!result) return data({ error: "작업 종류를 확인해 주세요." }, { status: 400, headers: PRIVATE });
    return redirect(`${PATH}?${new URLSearchParams({ kind: kind!, operation: result.operationId })}`, { headers: PRIVATE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ADMIN_RECENT_AUTH_REQUIRED" && isKind(requestedKind)) {
      const returnTo = `${PATH}?${new URLSearchParams({ kind: requestedKind, operation: operationId })}`;
      throw redirect(`/admin/reauth?${new URLSearchParams({ returnTo })}`, { headers: PRIVATE });
    }
    return data({ error: code === "ADMIN_OPERATION_CONFLICT" ? "확인 후 대상이 변경됐습니다. 현재 상태에서 다시 검토해 주세요." : code === "ADMIN_OPERATION_RESULT_UNKNOWN" ? "반영 결과가 미확인입니다. 같은 확인 번호를 다시 조회해 주세요." : "대상 상태와 권한을 다시 확인해 주세요." }, { status: 400, headers: PRIVATE });
  }
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { const status = isRouteErrorResponse(error) ? error.status : 503; return <main id="main" className="admin-home"><h1>{status === 403 ? "관리자만 조회할 수 있습니다." : "개인정보 운영 상태를 불러올 수 없습니다."}</h1><Link to={PATH}>처음부터 다시 조회</Link></main>; }
export default function AdminPrivacy({ loaderData: state, actionData }: Route.ComponentProps) {
  const pending = useNavigation().state !== "idle", preview = state.preview;
  return <main id="main" className="admin-home admin-activity"><header className="admin-home__header"><div><p className="admin-home__eyebrow">RE:TASTE / ADMIN</p><h1>개인정보 요청·사진 정리</h1><p>요청 접수·처리 기록과 기존 본인 삭제 요청의 재시도를 확인합니다.</p></div><Link to="/admin">운영 홈</Link></header>
    <p className="admin-home__note">보유기간·추가 삭제 범위는 정책 확인이 필요합니다. 안내 기록이나 재시도 접수는 개인정보 전체 삭제 완료를 뜻하지 않습니다. 관리자 공개 회수는 사진을 보존합니다.</p>
    <p>조회 {privacyTime(state.now)} (KST)</p>
    {actionData?.error && <p role="alert">{actionData.error}</p>}{state.previewError && <p role="alert">{state.previewError}</p>}
    {preview && <section className="admin-activity__detail" aria-labelledby="privacy-preview-title"><h2 id="privacy-preview-title">변경 미리보기</h2>
      {preview.operationKind === "PHOTO_CLEANUP_RETRY" ? <><p>본인 요청 사진 정리 · 대상 {preview.count}개</p><p style={{ overflowWrap: "anywhere" }}>작업 참조 {preview.reviewId}</p><p>현재 계획을 재시도 대기에 등록합니다. 복원할 수 없는 파일 삭제는 기존 정리 작업이 수행하며, 이 확인 자체가 삭제 완료는 아닙니다.</p></> : <><p>{privacyKindLabels[preview.kind]} · {privacyDecisionLabels[preview.decision]}</p><p>요청 참조 {preview.requestId}</p><p>처리 상태만 기록합니다. 자료를 열람·정정·삭제하지 않습니다.</p></>}
      {preview.status === "PENDING" ? <Form method="post" className="admin-home__filter"><input type="hidden" name="intent" value="confirm"/><input type="hidden" name="kind" value={preview.operationKind}/><input type="hidden" name="operationId" value={preview.operationId}/><button disabled={pending}>변경 확정</button></Form> : <p>처리 기록이 반영됐습니다. <Link to={`/admin/activity?${new URLSearchParams({ view: "operations", operation: preview.operationId })}`}>영수증 보기</Link></p>}
      <Link to={PATH}>확인 닫기</Link></section>}
    <section aria-labelledby="privacy-requests-title"><h2 id="privacy-requests-title">개인정보 요청 · 최대 50건</h2><p>인증된 계정의 요청 유형만 받으며 신분증·사진·자유 문안은 받지 않습니다.</p>
      {state.requests.rows.length ? <ol className="admin-activity__list">{state.requests.rows.map((row) => <li key={row.id}><div><h3>{privacyKindLabels[row.kind]} · {privacyStatusLabels[row.status]}</h3><p>접수 {privacyTime(row.receivedAt)} · 갱신 {privacyTime(row.updatedAt)}</p><p><code>{row.id}</code></p></div>{row.status !== "GUIDANCE_RECORDED" && <Form method="post" className="admin-home__filter"><input type="hidden" name="intent" value="prepare-request"/><input type="hidden" name="requestId" value={row.id}/><label>처리 기록<select name="decision">{Object.entries(privacyDecisionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button disabled={pending}>요청 상태 미리보기</button></Form>}</li>)}</ol> : <p>접수된 요청이 없습니다.</p>}
      {state.requests.nextCursor && <Link to={`${PATH}?${new URLSearchParams({ requestsCursor: state.requests.nextCursor })}`}>요청 다음 50건</Link>}
    </section>
    <section aria-labelledby="privacy-cleanup-title"><h2 id="privacy-cleanup-title">사진 정리 대기 · 최대 25건</h2><p>원본 사진과 저장소 키는 표시하지 않습니다. 실행 소유권을 확인하지 못한 작업은 결과 미확인으로 보존합니다.</p>
      {state.cleanup.rows.length ? <ol className="admin-activity__list">{state.cleanup.rows.map((row) => <li key={row.id}><div><h3>{row.purpose === "DELETE" ? "본인 요청 삭제" : "미참조 업로드 보상"} · {cleanupStatusLabels[row.status]}</h3><p>계획 {row.revision} · 대상 {row.count ?? "미확인"}개 · 시도 {row.attemptCount}회</p><p>다음 시도 {privacyTime(row.nextAttemptAt)} · 갱신 {privacyTime(row.updatedAt)}</p><p><code>{row.id}</code></p>{row.status === "UNKNOWN" && <p>이전 실행 결과를 확인해야 합니다. 자동으로 다시 삭제하지 않습니다.</p>}{row.purpose === "DELETE" && !row.authorized && <p>본인 철회·탈퇴 근거를 확인할 수 없어 실행하지 않습니다.</p>}</div>{row.canRetry && <Form method="post" className="admin-home__filter"><input type="hidden" name="intent" value="prepare-cleanup"/><input type="hidden" name="reviewId" value={row.id}/><button disabled={pending}>사진 정리 재시도 미리보기</button></Form>}</li>)}</ol> : <p>대기 중인 사진 정리 작업이 없습니다.</p>}
      {state.cleanup.nextCursor && <Link to={`${PATH}?${new URLSearchParams({ cleanupCursor: state.cleanup.nextCursor })}`}>정리 다음 25건</Link>}
      <h3>최근 완료 증거 · 최대 10건</h3>{state.cleanup.completed.length ? <ul>{state.cleanup.completed.map((row) => <li key={row.id}>정리 결과 기록 · {privacyTime(row.createdAt)} · <code>{row.target}</code></li>)}</ul> : <p>확인된 정리 완료 기록이 없습니다.</p>}
    </section></main>;
}
