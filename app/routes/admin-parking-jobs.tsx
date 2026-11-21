import { env } from "cloudflare:workers";
import { count, desc, eq } from "drizzle-orm";
import { data, Form, isRouteErrorResponse, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/admin-parking-jobs";
import { createDb } from "../db/client.server";
import { parkingDataSnapshots, parkingSyncRuns } from "../db/schema";
import { readSessionId, requireAdmin } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { commitParkingJobAction, prepareParkingJobAction, readParkingJobAction, type ParkingJobAction } from "../features/parking/parking-job-admin.server";
import { inspectParkingJob } from "../features/parking/parking-job.server";
import "../styles/admin-home.css";
import "../styles/admin-activity.css";

const PATH = "/admin/jobs/parking";
const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers: Route.HeadersFunction = () => PRIVATE;
export const meta: Route.MetaFunction = () => [{ title: "주차·EV 작업 | Re:Taste Admin" }, { name: "robots", content: "noindex, nofollow" }];

async function authorize(request: Request) {
  try { return await requireAdmin(request); }
  catch (error) {
    if (error instanceof Response) {
      const headers = new Headers(error.headers);
      for (const [key, value] of Object.entries(PRIVATE)) headers.set(key, value);
      throw new Response(null, { status: error.status, statusText: error.statusText, headers });
    }
    throw new Response(null, { status: 503, headers: PRIVATE });
  }
}

function queryId(value: string | null) {
  if (value !== null && (!value || value.length > 128)) throw new Response(null, { status: 400, headers: PRIVATE });
  return value;
}

const snapshotFields = {
  id: parkingDataSnapshots.id, source: parkingDataSnapshots.source, status: parkingDataSnapshots.status,
  rowCount: parkingDataSnapshots.rowCount, activatedAt: parkingDataSnapshots.activatedAt,
  referenceMin: parkingDataSnapshots.sourceReferenceDateMin, referenceMax: parkingDataSnapshots.sourceReferenceDateMax,
};
const jobFields = { job: parkingSyncRuns, snapshot: snapshotFields };

function presentJob(row: { job: typeof parkingSyncRuns.$inferSelect; snapshot: { id: string; source: "PARKING" | "EV"; status: string; rowCount: number; activatedAt: string | null; referenceMin: string | null; referenceMax: string | null } | null }, now: string) {
  // Older error summaries can contain upstream text. Expose only known codes.
  const code = row.job.errorSummary;
  const failure = code && /^(?:PARKING|EV)_(?:SYNC_FAILED|DATA_(?:HTTP_\d{3}|INVALID_PAGE|INCOMPLETE(?:_(?:29|46))?|QUALITY_ROW_DROP))$/.test(code) ? code : code ? "수집 오류 · 상세는 운영 로그에서 확인" : null;
  return { ...row.job, errorSummary: failure, snapshot: row.snapshot, inspection: inspectParkingJob(row.job, now) };
}

export async function loader({ request }: Route.LoaderArgs) {
  const admin = await authorize(request);
  const db = createDb(env.DB), now = new Date().toISOString();
  const url = new URL(request.url);
  const runId = queryId(url.searchParams.get("run")), operationId = queryId(url.searchParams.get("operation"));
  const [rows, snapshots, active] = await Promise.all([
    db.select(jobFields).from(parkingSyncRuns).leftJoin(parkingDataSnapshots, eq(parkingDataSnapshots.id, parkingSyncRuns.snapshotId))
      .orderBy(desc(parkingSyncRuns.createdAt), desc(parkingSyncRuns.id)).limit(50),
    db.select({ source: parkingDataSnapshots.source, status: parkingDataSnapshots.status, count: count() }).from(parkingDataSnapshots)
      .groupBy(parkingDataSnapshots.source, parkingDataSnapshots.status),
    db.select(snapshotFields).from(parkingDataSnapshots).where(eq(parkingDataSnapshots.status, "ACTIVE"))
      .orderBy(desc(parkingDataSnapshots.activatedAt), desc(parkingDataSnapshots.id)).limit(8),
  ]);
  let operation: Awaited<ReturnType<typeof readParkingJobAction>> | null = null;
  let operationError: string | null = null;
  if (operationId) {
    const sessionId = readSessionId(request);
    if (sessionId) {
      try { operation = await readParkingJobAction(env.DB, { actorUserId: admin.id, sessionId, operationId, now }); }
      catch { operationError = "이 변경 요청을 확인할 수 없습니다. 현재 작업에서 다시 검토해 주세요."; }
    }
  }
  const selectedId = operation?.runId ?? runId;
  let selected = selectedId ? rows.find((row) => row.job.id === selectedId) ?? null : null;
  if (selectedId && !selected) {
    const selectedRows = await db.select(jobFields).from(parkingSyncRuns).leftJoin(parkingDataSnapshots, eq(parkingDataSnapshots.id, parkingSyncRuns.snapshotId))
      .where(eq(parkingSyncRuns.id, selectedId)).limit(1);
    selected = selectedRows[0] ?? null;
  }
  return data({ jobs: rows.map((row) => presentJob(row, now)), selected: selected ? presentJob(selected, now) : null,
    missing: Boolean(selectedId && !selected), snapshots, active, queriedAt: now, operation, operationError }, { headers: PRIVATE });
}

function isAction(value: string): value is ParkingJobAction { return value === "CANCEL" || value === "RETRY" || value === "RECOVER"; }
function failureMessage(code: string) {
  if (code === "PARKING_JOB_INPUT_INVALID") return "작업을 확인하고 사유를 5~300자로 입력해 주세요.";
  if (code === "PARKING_JOB_NOT_FOUND") return "작업 또는 수집 자료를 찾을 수 없습니다.";
  if (code === "PARKING_JOB_ACTION_UNAVAILABLE") return "현재 상태에서는 이 변경을 할 수 없습니다. 작업 상태와 실행 한도를 다시 확인해 주세요.";
  if (code === "ADMIN_OPERATION_CONFLICT") return "미리보기 이후 작업이 변경됐습니다. 최신 상태에서 다시 검토해 주세요.";
  if (code === "ADMIN_OPERATION_EXPIRED") return "미리보기가 만료됐습니다. 현재 상태에서 다시 검토해 주세요.";
  if (code === "ADMIN_OPERATION_RESULT_UNKNOWN") return "변경 결과를 확인할 수 없습니다. 같은 요청의 결과를 다시 확인해 주세요.";
  if (code === "ADMIN_REQUIRED") return "관리자 권한과 접속 상태를 다시 확인해 주세요.";
  return "변경을 처리하지 못했습니다. 현재 작업을 다시 조회해 주세요.";
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await authorize(request);
  if (!isSameOriginMutation(request)) return data({ message: "요청 출처를 확인할 수 없습니다.", retryOperationId: null }, { status: 403, headers: PRIVATE });
  const sessionId = readSessionId(request);
  if (!sessionId) throw new Response(null, { status: 401, headers: PRIVATE });
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) throw new Response(null, { status: 413, headers: PRIVATE });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? ""), operationId = String(form.get("operationId") ?? "");
  const operator = { actorUserId: admin.id, sessionId, now: new Date().toISOString() };
  try {
    if (intent === "confirm") {
      const result = await commitParkingJobAction(env.DB, { ...operator, operationId });
      return redirect(`${PATH}?${new URLSearchParams({ run: result.runId, operation: result.operationId })}`, { headers: PRIVATE });
    }
    const jobAction = String(form.get("action") ?? "");
    if (intent !== "prepare" || !isAction(jobAction)) return data({ message: "변경할 작업을 확인해 주세요.", retryOperationId: null }, { status: 400, headers: PRIVATE });
    const prepared = await prepareParkingJobAction(env.DB, { ...operator, runId: String(form.get("runId") ?? ""), action: jobAction, reason: String(form.get("reason") ?? "") });
    return redirect(`${PATH}?${new URLSearchParams({ run: prepared.runId, operation: prepared.operationId })}`, { headers: PRIVATE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ADMIN_RECENT_AUTH_REQUIRED") {
      const returnTo = `${PATH}?${new URLSearchParams({ operation: operationId })}`;
      throw redirect(`/admin/reauth?${new URLSearchParams({ returnTo })}`, { headers: PRIVATE });
    }
    return data({ message: failureMessage(code), retryOperationId: code === "ADMIN_OPERATION_RESULT_UNKNOWN" ? operationId : null }, { status: 400, headers: PRIVATE });
  }
}

const sourceLabel = { PARKING: "주차", EV: "전기차 충전" } as const;
const stateLabel: Record<string, string> = { PENDING: "수집 대기", RUNNING: "수집 중", UNKNOWN: "실행 상태 미확인", STALE: "실행 기한 경과·결과 확인 필요", COMPLETED: "수집 완료", FAILED: "실패", CANCELLED: "취소" };
const snapshotLabel: Record<string, string> = { STAGING: "임시 수집 자료", ACTIVE: "현재 사용 자료", RETIRED: "교체된 자료", FAILED: "수집 중단 자료" };
const actionLabel = { CANCEL: "수집 취소", RETRY: "재시도", RECOVER: "중단 작업 복구" } as const;
function time(value: string | null) {
  if (!value) return "미기록";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" }).format(date) : "미확인";
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 503;
  return <main id="main" className="admin-home"><h1>{status === 403 ? "관리자만 조회할 수 있습니다." : status === 400 ? "조회 조건을 확인해 주세요." : "주차·EV 작업을 불러올 수 없습니다."}</h1><Link to={PATH}>작업 목록 다시 열기</Link></main>;
}

export default function AdminParkingJobs({ loaderData: state, actionData }: Route.ComponentProps) {
  const pending = useNavigation().state !== "idle", job = state.selected, operation = state.operation;
  return <main id="main" className="admin-home admin-activity">
    <header className="admin-home__header"><div><p className="admin-home__eyebrow">RE:TASTE / ADMIN</p><h1>주차·EV 작업</h1><p>수집 상태와 현재 사용 자료를 확인하고, 한 작업의 변경을 검토합니다.</p></div><Link to="/admin">운영 홈</Link></header>
    <nav className="admin-activity__tabs" aria-label="작업 종류"><Link to={PATH} aria-current="page">주차·EV</Link><Link to="/admin/ratings">평가 작업</Link><Link to="/admin/data-sync">공공데이터</Link></nav>
    <p className="admin-home__timestamp">조회 {time(state.queriedAt)} (KST) · 작업 목록 최근 최대 50건</p>
    <p className="admin-home__note">변경 접수는 수집 완료가 아닙니다. 재시도·복구는 대기에 등록하며, 실제 수집은 기존 정기 작업이 처리합니다.</p>
    {actionData?.message && <p role="alert">{actionData.message}</p>}
    {state.operationError && <p role="alert">{state.operationError}</p>}
    {state.missing && <p role="alert">해당 작업을 찾을 수 없습니다.</p>}
    {pending && <p aria-live="polite">요청을 확인하고 있습니다.</p>}
    {actionData?.retryOperationId && <Form method="post" className="admin-home__filter"><input type="hidden" name="intent" value="confirm"/><input type="hidden" name="operationId" value={actionData.retryOperationId}/><button disabled={pending}>같은 변경 요청 결과 확인</button></Form>}
    {operation && <section className="admin-activity__detail" aria-labelledby="parking-preview-title">
      <h2 id="parking-preview-title">{operation.status === "PENDING" ? "작업 변경 미리보기" : "변경 접수 결과"}</h2>
      <p>{sourceLabel[operation.source]} · {actionLabel[operation.action]}</p>
      <dl><div><dt>작업</dt><dd><code>{operation.runId}</code></dd></div><div><dt>대상 자료</dt><dd><code>{operation.snapshotId}</code></dd></div><div><dt>사유</dt><dd>{operation.reason}</dd></div><div><dt>미리보기 만료</dt><dd>{time(operation.expiresAt)}</dd></div></dl>
      {operation.status === "PENDING" ? <>
        <p>아직 작업을 변경하지 않았습니다. 확정 시 최근 인증과 현재 작업 상태를 다시 확인합니다.</p>
        <p>{operation.action === "CANCEL" ? "현재 사용 자료는 유지합니다. 이미 전송한 외부 요청을 되돌리지는 않으며, 취소 이후 추가 반영을 차단합니다." : "임시 자료와 다음 페이지를 보존해 수집 대기에 등록합니다. 지금 외부 데이터를 수집하지 않습니다."}</p>
        <Form method="post" className="admin-home__filter"><input type="hidden" name="intent" value="confirm"/><input type="hidden" name="operationId" value={operation.operationId}/><button disabled={pending}>작업 변경 확정</button></Form>
      </> : <p>변경 요청이 접수됐습니다. 작업 상태를 다시 조회해 실제 결과를 확인하세요. <Link to={`/admin/activity?${new URLSearchParams({ view: "operations", operation: operation.operationId })}`}>변경 영수증 보기</Link></p>}
      <Link to={`${PATH}?${new URLSearchParams({ run: operation.runId })}`}>이 작업 다시 조회</Link>
    </section>}
    <section className="admin-activity__detail" aria-labelledby="parking-active-title">
      <h2 id="parking-active-title">현재 사용 자료</h2>
      <p>수집 중인 임시 자료와 구분합니다. 활성 자료는 최근 최대 8개를 표시합니다.</p>
      {state.active.length ? state.active.map((snapshot) => <div key={snapshot.id}><h3>{sourceLabel[snapshot.source]} · {snapshot.rowCount.toLocaleString("ko-KR")}건</h3><p style={{ overflowWrap: "anywhere" }}><code>{snapshot.id}</code> · 활성화 {time(snapshot.activatedAt)}</p><p>원천 기준일 {snapshot.referenceMin ?? "미기록"} ~ {snapshot.referenceMax ?? "미기록"}</p></div>) : <p>현재 사용 중인 자료가 없습니다.</p>}
      <h3>전체 자료 수</h3><ul>{state.snapshots.map((row) => <li key={`${row.source}-${row.status}`}>{sourceLabel[row.source]} · {snapshotLabel[row.status]} {row.count}개</li>)}</ul>
    </section>
    {job && <section className="admin-activity__detail" aria-labelledby="parking-selected-title">
      <h2 id="parking-selected-title">선택한 작업</h2>
      <p><strong>{stateLabel[job.inspection.status]} ({job.status})</strong> · {sourceLabel[job.source]}</p>
      <dl>
        <div><dt>작업 ID</dt><dd><code>{job.id}</code></dd></div><div><dt>시도</dt><dd>{job.attempts}/{job.inspection.maxAttempts}회</dd></div>
        <div><dt>수집 / 임시 적재 / 제외</dt><dd>{job.fetchedCount} / {job.acceptedCount} / {job.skippedCount}건</dd></div><div><dt>다음 페이지</dt><dd>{job.nextPage}</dd></div>
        <div><dt>시작 / 종료</dt><dd>{time(job.startedAt)} / {time(job.finishedAt)}</dd></div><div><dt>실행 기한</dt><dd>{time(job.leaseExpiresAt)}</dd></div>
        <div><dt>수집 자료</dt><dd><code>{job.snapshotId ?? "미기록"}</code> · {job.snapshot ? snapshotLabel[job.snapshot.status] : "미확인"}</dd></div>
      </dl>
      {job.errorSummary && <p>오류: {job.errorSummary}</p>}
      {job.inspection.blockedReason && <p>{job.inspection.blockedReason}</p>}
      <p><Link to={`${PATH}?${new URLSearchParams({ run: job.id })}`}>이 작업 상태 다시 조회</Link></p>
      {job.inspection.allowedActions.length > 0 && <Form method="post" className="admin-home__filter">
        <input type="hidden" name="intent" value="prepare"/><input type="hidden" name="runId" value={job.id}/>
        <label className="grid gap-2">변경 사유<input name="reason" minLength={5} maxLength={300} required className="rounded-xl border px-3 py-2"/></label>
        {job.inspection.allowedActions.map((value) => <button key={value} name="action" value={value} disabled={pending}>{actionLabel[value]} 미리보기</button>)}
      </Form>}
    </section>}
    <section aria-labelledby="parking-jobs-title"><h2 id="parking-jobs-title">작업 목록</h2><p>현재 {state.jobs.length}건 · 상세에서 조회·변경합니다.</p>
      {state.jobs.length ? <ol className="admin-activity__list">{state.jobs.map((row) => <li key={row.id}><div><h3>{sourceLabel[row.source]} · {stateLabel[row.inspection.status]} ({row.status})</h3><p><code>{row.id}</code></p><p>시도 {row.attempts}/{row.inspection.maxAttempts}회 · 수집 {row.fetchedCount}건 · 임시 적재 {row.acceptedCount}건 · 다음 {row.nextPage}쪽</p><time dateTime={row.updatedAt}>{time(row.updatedAt)}</time></div><div className="admin-activity__row-end"><Link to={`${PATH}?${new URLSearchParams({ run: row.id })}`}>상세 확인</Link></div></li>)}</ol> : <p className="admin-activity__empty">작업 기록이 없습니다.</p>}
    </section>
  </main>;
}
