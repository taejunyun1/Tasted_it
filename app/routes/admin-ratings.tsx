import { env } from "cloudflare:workers";
import { asc, desc, inArray } from "drizzle-orm";
import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/admin-ratings";

import { createDb } from "../db/client.server";
import { goldenPickEvents, integrityCases, places, ratingRecomputeJobs, ratingSnapshots } from "../db/schema";
import { readSessionId, requireAdmin } from "../features/auth/session.server";
import { getActiveRatingConfig } from "../features/ratings/rating-config.server";
import { commitIntegrityOperation, prepareIntegrityOperation, readIntegrityOperation, type IntegrityOperationKind } from "../features/ratings/admin-integrity.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { getRatingJobResult } from "../features/ratings/recompute.server";
import { commitRatingRecompute, prepareRatingRecompute } from "../features/ratings/admin-recompute.server";
import { commitRatingJobAction, inspectRatingJob, prepareRatingJobAction, readRatingJobAction, type RatingJobAction } from "../features/ratings/rating-job-admin.server";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export const headers: Route.HeadersFunction = () => PRIVATE_HEADERS;

export async function loader({ request }: Route.LoaderArgs) {
  const admin = await requireAdmin(request);
  const db = createDb(env.DB); const now = new Date().toISOString();
  const [config, snapshots, jobs, cases, picks, placeRows] = await Promise.all([
    getActiveRatingConfig(db, now),
    db.select().from(ratingSnapshots).orderBy(desc(ratingSnapshots.computedAt)).limit(100),
    db.select().from(ratingRecomputeJobs).orderBy(desc(ratingRecomputeJobs.createdAt)).limit(100),
    db.select().from(integrityCases).where(inArray(integrityCases.status, ["OPEN", "REVIEWING", "CONFIRMED"])).orderBy(asc(integrityCases.createdAt)).limit(100),
    db.select().from(goldenPickEvents).orderBy(desc(goldenPickEvents.effectiveAt)).limit(200),
    db.select({ id: places.id, name: places.name }).from(places).orderBy(asc(places.name)).limit(500),
  ]);
  const closedPicks = new Set(picks.filter((pick) => pick.eventType !== "GRANT" && pick.previousEventId).map((pick) => pick.previousEventId));
  const requestedJobId = new URL(request.url).searchParams.get("jobId");
  const requestedJob = requestedJobId && requestedJobId.length <= 128
    ? await getRatingJobResult(db, requestedJobId) : null;
  let integrityPreview: Awaited<ReturnType<typeof readIntegrityOperation>> | null = null;
  let integrityError: string | null = null;
  let jobPreview: Awaited<ReturnType<typeof readRatingJobAction>> | null = null;
  let jobPreviewError: string | null = null;
  const url = new URL(request.url), operationId = url.searchParams.get("operation");
  const kind = url.searchParams.get("operationKind");
  if (operationId && isIntegrityKind(kind)) {
    const sessionId = readSessionId(request);
    if (sessionId) {
      try { integrityPreview = await readIntegrityOperation(env.DB, { actorUserId: admin.id, sessionId, operationId, kind, now }); }
      catch { integrityError = "실행 확인을 재개할 수 없습니다. 현재 대상에서 다시 검토해 주세요."; }
    }
  }
  const jobOperationId = url.searchParams.get("jobOperation");
  if (jobOperationId) {
    const sessionId = readSessionId(request);
    if (sessionId) {
      try { jobPreview = await readRatingJobAction(env.DB, { actorUserId: admin.id, sessionId, operationId: jobOperationId, now }); }
      catch { jobPreviewError = "작업 변경 확인을 재개할 수 없습니다. 현재 상태에서 다시 검토해 주세요."; }
    }
  }
  return {
    config,
    queriedAt: now,
    integrityPreview,
    integrityError,
    jobPreview,
    jobPreviewError,
    requestedJob,
    stats: {
      stale: snapshots.filter((snapshot) => snapshot.isStale).length,
      pending: jobs.filter((job) => job.status === "PENDING").length,
      failed: jobs.filter((job) => job.status === "FAILED").length,
      openCases: cases.length,
      activeGoldenPicks: picks.filter((pick) => pick.eventType === "GRANT" && !closedPicks.has(pick.id) && pick.expiresAt && pick.expiresAt > now).length,
    },
    jobs: jobs.map((job) => ({ ...job, inspection: inspectRatingJob(job, now, config.id) })),
    cases,
    places: placeRows,
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const admin = await requireAdmin(request); const form = await request.formData(); const intent = String(form.get("intent") ?? "");
  const db = createDb(env.DB); const now = new Date().toISOString();
  if (intent === "prepare-rating-job" || intent === "confirm-rating-job") {
    const sessionId = readSessionId(request);
    if (!sessionId) throw new Response("세션을 확인해 주세요.", { status: 401 });
    const operator = { actorUserId: admin.id, sessionId, now };
    const operationId = String(form.get("operationId") ?? "");
    try {
      if (intent === "confirm-rating-job") {
        const requestedJob = await commitRatingJobAction(env.DB, { ...operator, operationId });
        return {
          ok: requestedJob.status !== "UNKNOWN", message: ratingJobMessage(requestedJob.status),
          requestedJob, jobPreview: null, jobOperationId: operationId,
          jobRetryOperationId: requestedJob.status === "UNKNOWN" ? operationId : null,
        };
      }
      const jobAction = String(form.get("jobAction") ?? "");
      if (!isRatingJobAction(jobAction)) return { ok: false, message: "작업 변경 종류를 확인해 주세요.", jobPreview: null };
      const prepared = await prepareRatingJobAction(env.DB, {
        ...operator, jobId: String(form.get("jobId") ?? ""),
        action: jobAction, reason: String(form.get("reason") ?? ""),
      });
      const jobPreview = await readRatingJobAction(env.DB, { ...operator, operationId: prepared.operationId });
      return { ok: true, message: null, jobPreview };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "ADMIN_RECENT_AUTH_REQUIRED") {
        const returnTo = `/admin/ratings?jobOperation=${encodeURIComponent(operationId)}`;
        throw redirect(`/admin/reauth?returnTo=${encodeURIComponent(returnTo)}`);
      }
      if (error instanceof Response) return { ok: false, message: await error.text(), jobPreview: null };
      return {
        ok: false, message: ratingJobFailureMessage(code), jobPreview: null,
        jobRetryOperationId: code === "ADMIN_OPERATION_RESULT_UNKNOWN" ? operationId : null,
      };
    }
  }
  if (intent === "recompute" || intent === "retry-recompute" || intent === "confirm-recompute") {
    const sessionId = readSessionId(request);
    if (!sessionId) throw new Response("세션을 확인해 주세요.", { status: 401 });
    const operator = { actorUserId: admin.id, sessionId, now };
    if (intent === "confirm-recompute") {
      const operationId = String(form.get("operationId") ?? "");
      try {
        const requestedJob = await commitRatingRecompute(env.DB, { ...operator, operationId });
        return {
          ok: requestedJob.status === "COMPLETED", message: ratingJobMessage(requestedJob.status), requestedJob,
          operationRetryId: requestedJob.status === "UNKNOWN" ? operationId : null,
        };
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        const messages: Record<string, string> = {
          ADMIN_OPERATION_CONFLICT: "검토 후 대상이 변경됐습니다. 최신 상태에서 다시 검토해 주세요.",
          ADMIN_OPERATION_EXPIRED: "실행 확인 시간이 지났습니다. 다시 검토해 주세요.",
          ADMIN_OPERATION_UNAVAILABLE: "이 확인 요청을 사용할 수 없습니다. 최신 상태에서 다시 검토해 주세요.",
          ADMIN_OPERATION_INPUT_INVALID: "실행 요청을 확인해 주세요.",
          ADMIN_REQUIRED: "현재 관리자 권한을 확인할 수 없습니다. 다시 로그인해 주세요.",
          ADMIN_RECENT_AUTH_REQUIRED: "실패 작업 재시도에는 최근 인증이 필요합니다. 아래 작업 목록에서 사유를 입력해 다시 검토해 주세요.",
          ADMIN_OPERATION_RESULT_UNKNOWN: "접수 결과를 확인할 수 없습니다. 같은 요청의 결과를 다시 확인해 주세요.",
        };
        if (!messages[code]) throw error;
        return { ok: false, message: messages[code], operationRetryId: code === "ADMIN_OPERATION_RESULT_UNKNOWN" ? operationId : null };
      }
    }
    const placeId = String(form.get("placeId") ?? "");
    const preview = await prepareRatingRecompute(env.DB, { ...operator, placeId, ...(intent === "retry-recompute" ? { retryJobId: String(form.get("jobId") ?? "") } : {}) });
    return { ok: true, message: null, preview };
  }
  if (intent === "case" || intent === "invalidate" || intent === "confirm-integrity") {
    const sessionId = readSessionId(request);
    if (!sessionId) throw new Response("세션을 확인해 주세요.", { status: 401 });
    const operator = { actorUserId: admin.id, sessionId, now };
    const kind = intent === "case" ? "INTEGRITY_CASE_TRANSITION" : intent === "invalidate" ? "VOTE_INVALIDATE" : String(form.get("operationKind") ?? "");
    if (!isIntegrityKind(kind)) throw new Response("잘못된 작업 종류입니다.", { status: 400 });
    const operationId = String(form.get("operationId") ?? "");
    try {
      if (intent === "confirm-integrity") {
        const result = await commitIntegrityOperation(env.DB, { ...operator, operationId, kind });
        return { ok: true, integrityPreview: null, message: result.replayed ? "이미 반영된 요청의 결과를 확인했습니다." : kind === "VOTE_INVALIDATE" ? "투표 원본을 보존하고 무효화와 재계산 대기 등록을 완료했습니다." : "사건 상태 변경을 반영했습니다." };
      }
      const prepared = await prepareIntegrityOperation(env.DB, { ...operator, kind, caseId: String(form.get("caseId") ?? ""), status: String(form.get("status") ?? ""), voteEventId: String(form.get("voteEventId") ?? ""), reason: String(form.get("reason") ?? "") });
      const integrityPreview = await readIntegrityOperation(env.DB, { ...operator, operationId: prepared.operationId, kind });
      return { ok: true, integrityPreview, message: "대상과 변경 내용을 확인해 주세요. 아직 반영하지 않았습니다." };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "ADMIN_RECENT_AUTH_REQUIRED") {
        const returnTo = `/admin/ratings?operation=${encodeURIComponent(operationId)}&operationKind=${kind}`;
        throw redirect(`/admin/reauth?returnTo=${encodeURIComponent(returnTo)}`);
      }
      return { ok: false, message: integrityFailureMessage(code), integrityRetry: code === "ADMIN_OPERATION_RESULT_UNKNOWN" ? { operationId, kind } : null };
    }
  }
  throw new Response("Invalid intent", { status: 400 });
}

export function meta() { return [{ title: "평가 운영 — Re:Taste Admin" }]; }

function isIntegrityKind(value: unknown): value is IntegrityOperationKind {
  return value === "INTEGRITY_CASE_TRANSITION" || value === "VOTE_INVALIDATE";
}
function integrityFailureMessage(code: string) {
  if (code === "ADMIN_OPERATION_EXPIRED") return "실행 확인 시간이 지났습니다. 다시 검토해 주세요.";
  if (code === "ADMIN_OPERATION_CONFLICT" || code === "INTEGRITY_CASE_CHANGED") return "검토 후 대상이 변경됐습니다. 현재 상태를 다시 확인해 주세요.";
  if (code === "INTEGRITY_EVENT_SCOPE_MISMATCH") return "이 사건과 연결된 투표만 무효화할 수 있습니다.";
  if (code === "VOTE_ALREADY_INVALIDATED") return "이미 무효화된 투표입니다.";
  if (code === "INVALIDATION_REASON_REQUIRED" || code === "INTEGRITY_REASON_REQUIRED") return "처리 사유를 입력해 주세요.";
  if (code === "ADMIN_OPERATION_RESULT_UNKNOWN") return "반영 결과를 확인할 수 없습니다. 같은 요청을 다시 확인해 주세요.";
  return "요청을 반영하지 못했습니다. 대상·사유와 현재 권한을 확인해 주세요.";
}

function ratingJobMessage(status: string) {
  switch (status) {
    case "COMPLETED": return "요청한 장소의 재계산이 완료됐습니다.";
    case "RUNNING": return "요청한 작업을 처리 중입니다. 작업 상태를 다시 확인해 주세요.";
    case "PENDING": return "요청한 작업이 대기 중입니다.";
    case "FAILED": return "요청한 작업이 실패했습니다. 작업 기록을 확인해 주세요.";
    case "CANCELLED": return "대기 작업을 취소했습니다. 기존 평가는 변경하지 않았습니다.";
    default: return "요청한 작업의 결과를 확인할 수 없습니다. 상태를 다시 확인해 주세요.";
  }
}

function ratingJobFailureMessage(code: string) {
  if (code === "RATING_JOB_INPUT_INVALID") return "작업과 변경 종류를 확인하고 사유를 5~300자로 입력해 주세요.";
  if (code === "RATING_JOB_NOT_FOUND") return "해당 작업을 찾을 수 없습니다. 목록을 다시 조회해 주세요.";
  if (code === "RATING_JOB_ACTION_UNAVAILABLE") return "현재 상태에서는 이 작업을 변경할 수 없습니다. 최신 상태와 실행 한도를 확인해 주세요.";
  if (code === "ADMIN_OPERATION_EXPIRED") return "실행 확인 시간이 지났습니다. 현재 작업에서 다시 검토해 주세요.";
  if (code === "ADMIN_OPERATION_CONFLICT") return "검토한 뒤 작업 상태가 변경됐습니다. 최신 상태에서 다시 검토해 주세요.";
  if (code === "ADMIN_OPERATION_RESULT_UNKNOWN") return "변경 결과를 확인할 수 없습니다. 같은 요청의 결과를 다시 확인해 주세요.";
  if (code === "ADMIN_OPERATION_UNAVAILABLE") return "이 확인 요청을 사용할 수 없습니다. 현재 작업에서 다시 검토해 주세요.";
  if (code === "ADMIN_REQUIRED") return "현재 관리자 권한을 확인할 수 없습니다. 다시 로그인해 주세요.";
  return "작업을 변경하지 못했습니다. 현재 상태와 변경 사유를 확인해 주세요.";
}

const jobActionLabel = { CANCEL: "대기 작업 취소", RETRY: "실패 작업 재시도", RECOVER: "중단 작업 복구" } as const;
function isRatingJobAction(value: string): value is RatingJobAction {
  return value === "CANCEL" || value === "RETRY" || value === "RECOVER";
}
const jobStateLabel: Record<string, string> = { PENDING: "접수·대기", RUNNING: "실행 중", STALE: "실행 기한 경과·결과 확인 필요", COMPLETED: "완료", FAILED: "실패", CANCELLED: "취소" };
function jobTime(value: string | null) {
  if (!value) return "미기록";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" }).format(date)
    : "미확인";
}

export default function AdminRatings({ loaderData, actionData }: Route.ComponentProps) {
  const pending = useNavigation().state !== "idle";
  const integrityPreview = actionData && "integrityPreview" in actionData ? actionData.integrityPreview : loaderData.integrityPreview;
  const jobPreview = actionData && "jobPreview" in actionData ? actionData.jobPreview : loaderData.jobPreview;
  const preview = actionData && "preview" in actionData ? actionData.preview : null;
  const requestedJob = actionData && "requestedJob" in actionData ? actionData.requestedJob : loaderData.requestedJob;
  return <main id="main" className="admin-rating-shell"><header><p className="eyebrow">ADMIN / RATING OPERATIONS</p><h1>평가 운영</h1><Link to="/admin/reviewer-visits">방문 리뷰 검수 대기열</Link><p>활성 알고리즘 <strong>{loaderData.config.algorithmVersion}</strong> · 최소 공개 {loaderData.config.minimumVisibleSamples}표</p></header>{actionData?.message && <p className="admin-notice">{actionData.message}</p>}<section className="admin-rating-stats"><Stat label="반영 대기" value={loaderData.stats.stale}/><Stat label="재계산 대기" value={loaderData.stats.pending}/><Stat label="재계산 실패" value={loaderData.stats.failed}/><Stat label="검토·확인" value={loaderData.stats.openCases}/><Stat label="Golden Pick" value={loaderData.stats.activeGoldenPicks}/></section><section className="admin-rating-section"><h2>수동 재계산</h2><Form method="post"><input type="hidden" name="intent" value="recompute"/><select name="placeId" aria-label="재계산 장소">{loaderData.places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select><button>선택 장소 재계산</button></Form>
      {actionData && "operationRetryId" in actionData && actionData.operationRetryId && <Form method="post">
        <input type="hidden" name="intent" value="confirm-recompute" />
        <input type="hidden" name="operationId" value={actionData.operationRetryId} />
        <button>같은 요청 결과 다시 확인</button>
      </Form>}
      {preview && <div className="admin-notice" role="status">
        <h3>재계산 실행 확인</h3>
        <p>{preview.placeName} 1곳 · 설정 {preview.configId}</p>
        <p style={{ overflowWrap: "anywhere" }}>작업 ID <code>{preview.jobId}</code></p>
        <p>아직 재계산을 실행하지 않았습니다. 확인하면 이 작업만 {preview.retry ? "다시 " : ""}처리합니다.</p>
        <Form method="post">
          <input type="hidden" name="intent" value="confirm-recompute" />
          <input type="hidden" name="operationId" value={preview.operationId} />
          <button>확인 후 {preview.retry ? "재시도" : "재계산"}</button>
        </Form>
        <Link to="/admin/ratings">취소</Link>
      </div>}
      {requestedJob && <div role="status" aria-live="polite" className="admin-notice">
        <p>{ratingJobMessage(requestedJob.status)}</p>
        <p style={{ overflowWrap: "anywhere" }}>작업 ID <code>{requestedJob.jobId}</code> · {requestedJob.status}</p>
        <Link to={`?jobId=${encodeURIComponent(requestedJob.jobId)}`}>이 작업 상태 다시 확인</Link>
        {requestedJob.job && <>
          <p style={{ overflowWrap: "anywhere" }}>장소 <code>{requestedJob.job.placeId}</code> · 설정 <code>{requestedJob.job.configId}</code> · 시도 {requestedJob.job.attempts}회</p>
          <p>변경 가능한 작업과 사유 입력은 아래 작업 목록에서 확인하세요.</p>
        </>}
      </div>}
    </section><section className="admin-rating-section" aria-labelledby="rating-jobs-title">
      <h2 id="rating-jobs-title">재계산 작업</h2>
      <p>최근 최대 100건 · 현재 {loaderData.jobs.length}건 · 조회 {jobTime(loaderData.queriedAt)} (KST)</p>
      <p>접수와 완료는 구분됩니다. 실행 중인 작업은 즉시 취소할 수 없으며, 변경 전에 상태와 사유를 확인합니다.</p>
      {pending && <p aria-live="polite">요청을 확인하고 있습니다.</p>}
      {loaderData.jobPreviewError && <p role="alert">{loaderData.jobPreviewError}</p>}
      {actionData && "jobOperationId" in actionData && actionData.jobOperationId &&
        <p><Link to={`/admin/activity?view=operations&operation=${encodeURIComponent(actionData.jobOperationId)}`}>작업 변경 영수증 보기</Link></p>}
      {actionData && "jobRetryOperationId" in actionData && actionData.jobRetryOperationId && <Form method="post">
        <input type="hidden" name="intent" value="confirm-rating-job" />
        <input type="hidden" name="operationId" value={actionData.jobRetryOperationId} />
        <button disabled={pending}>같은 작업 변경 결과 확인</button>
      </Form>}
      {jobPreview && <section className="admin-notice" aria-labelledby="rating-job-preview-title" style={{ overflowWrap: "anywhere" }}>
        <h3 id="rating-job-preview-title">작업 변경 미리보기</h3>
        <p>{jobActionLabel[jobPreview.action]} · {jobPreview.placeName} 1곳</p>
        <p>작업 ID <code>{jobPreview.jobId}</code> · 설정 <code>{jobPreview.configId}</code></p>
        <p>현재 {jobStateLabel[jobPreview.previousStatus] ?? jobPreview.previousStatus} · 시도 {jobPreview.attempts}회</p>
        <p>미리보기 만료 {jobTime(jobPreview.expiresAt)} (KST)</p>
        <p>사유: {jobPreview.reason}</p>
        {jobPreview.status === "PENDING" ? <>
          <p>아직 작업을 변경하지 않았습니다. 확정 시 최근 인증과 최신 작업 상태를 다시 확인합니다.</p>
          {jobPreview.action === "CANCEL" ? <p>대기 작업만 취소하며 기존 평가와 투표는 보존합니다.</p> : <p>이 작업 1건만 다시 처리합니다. 이전 결과를 완료로 간주하지 않습니다.</p>}
          <Form method="post">
            <input type="hidden" name="intent" value="confirm-rating-job" />
            <input type="hidden" name="operationId" value={jobPreview.operationId} />
            <button disabled={pending}>작업 변경 확정</button>
          </Form>
        </> : <p>이미 확정된 요청입니다. 작업 상태와 영수증에서 결과를 확인하세요.</p>}
        <Link to={`/admin/ratings?jobId=${encodeURIComponent(jobPreview.jobId)}`}>미리보기 닫기</Link>
      </section>}
      {loaderData.jobs.length ? <div className="admin-rating-table">{loaderData.jobs.map((job) => <article key={job.id} aria-label={`재계산 작업 ${job.id}`} style={{ overflowWrap: "anywhere", gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div><strong>{jobStateLabel[job.inspection.status]} ({job.status})</strong> · 시도 {job.attempts}/{job.inspection.maxAttempts}회</div>
        <div>작업 ID <Link to={`?jobId=${encodeURIComponent(job.id)}`}>{job.id}</Link></div>
        <div>장소 <code>{job.placeId ?? "전체"}</code> · 설정 <code>{job.configId}</code></div>
        <div>접수 사유: {job.reason}</div>
        <div>접수 {jobTime(job.createdAt)} · 시작 {jobTime(job.startedAt)} · 종료 {jobTime(job.finishedAt)}</div>
        {job.inspection.leaseExpiresAt && <div>실행 기한 {jobTime(job.inspection.leaseExpiresAt)}</div>}
        {job.errorSummary && <div>실패 기록: {job.errorSummary}</div>}
        {job.inspection.blockedReason && <p>{job.inspection.blockedReason}</p>}
        {job.inspection.allowedActions.map((jobAction) => <Form method="post" key={jobAction}>
          <input type="hidden" name="intent" value="prepare-rating-job" />
          <input type="hidden" name="jobId" value={job.id} />
          <input type="hidden" name="jobAction" value={jobAction} />
          <label>작업 변경 사유<input name="reason" minLength={5} maxLength={300} required /></label>
          <button disabled={pending}>{jobActionLabel[jobAction]} 검토</button>
        </Form>)}
      </article>)}</div> : <p>작업 기록이 없습니다.</p>}
    </section><section className="admin-rating-section"><h2>조작 검토</h2>
      {loaderData.integrityError && <p role="alert">{loaderData.integrityError}</p>}
      {actionData && "integrityRetry" in actionData && actionData.integrityRetry && <Form method="post">
        <input type="hidden" name="intent" value="confirm-integrity"/>
        <input type="hidden" name="operationId" value={actionData.integrityRetry.operationId}/>
        <input type="hidden" name="operationKind" value={actionData.integrityRetry.kind}/>
        <button>같은 사건 처리 결과 다시 확인</button>
      </Form>}
      {integrityPreview && <div className="admin-notice" role="status" style={{ overflowWrap: "anywhere" }}>
        <h3>사건 처리 실행 확인</h3><p>{integrityPreview.summary.title} · {integrityPreview.summary.count}건</p>
        <p>사건 {integrityPreview.caseId} · {integrityPreview.previousStatus}{integrityPreview.nextStatus ? ` → ${integrityPreview.nextStatus}` : ""}</p>
        {integrityPreview.voteEventId && <p>투표 {integrityPreview.voteEventId}</p>}
        {integrityPreview.reason && <p>사유: {integrityPreview.reason}</p>}
        {integrityPreview.status === "PENDING" ? <><p>확정 시 최근 인증을 확인하고 이 대상만 변경합니다.</p><Form method="post">
          <input type="hidden" name="intent" value="confirm-integrity"/><input type="hidden" name="operationId" value={integrityPreview.operationId}/><input type="hidden" name="operationKind" value={integrityPreview.kind}/>
          <button>확인 후 반영</button>
        </Form></> : <p>이미 처리된 요청입니다.</p>}
        <Link to="/admin/ratings">확인 닫기</Link>
      </div>}
      {loaderData.cases.length ? loaderData.cases.map((item) => <article className="integrity-case" key={item.id}><div><strong>{item.status} · {item.signalType}</strong><p>{item.subjectType} · {item.subjectId}</p><code>{item.evidenceJson}</code></div>{item.status === "CONFIRMED" ? <Form method="post"><input type="hidden" name="intent" value="invalidate"/><input type="hidden" name="caseId" value={item.id}/><input name="voteEventId" placeholder="무효화할 vote event ID" required/><input name="reason" placeholder="무효화 사유" required/><button>투표 무효화·재계산</button></Form> : <Form method="post"><input type="hidden" name="intent" value="case"/><input type="hidden" name="caseId" value={item.id}/><input name="reason" placeholder="처리 사유"/><button name="status" value="REVIEWING">검토 시작</button><button name="status" value="DISMISSED">해제</button><button name="status" value="CONFIRMED">조작 확인</button></Form>}</article>) : <p>열린 조작 검토가 없습니다.</p>}</section></main>;
}

function Stat({ label, value }: { label: string; value: number }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
