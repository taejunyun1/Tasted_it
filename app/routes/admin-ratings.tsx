import { env } from "cloudflare:workers";
import { asc, desc, inArray } from "drizzle-orm";
import { Form, Link } from "react-router";
import type { Route } from "./+types/admin-ratings";

import { createDb } from "../db/client.server";
import { goldenPickEvents, integrityCases, places, ratingRecomputeJobs, ratingSnapshots } from "../db/schema";
import { readSessionId, requireAdmin } from "../features/auth/session.server";
import { getActiveRatingConfig } from "../features/ratings/rating-config.server";
import { invalidateVoteEvent, transitionIntegrityCase } from "../features/ratings/integrity.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { getRatingJobResult } from "../features/ratings/recompute.server";
import { commitRatingRecompute, prepareRatingRecompute } from "../features/ratings/admin-recompute.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
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
  return {
    config,
    requestedJob,
    stats: {
      stale: snapshots.filter((snapshot) => snapshot.isStale).length,
      pending: jobs.filter((job) => job.status === "PENDING").length,
      failed: jobs.filter((job) => job.status === "FAILED").length,
      openCases: cases.length,
      activeGoldenPicks: picks.filter((pick) => pick.eventType === "GRANT" && !closedPicks.has(pick.id) && pick.expiresAt && pick.expiresAt > now).length,
    },
    jobs,
    cases,
    places: placeRows,
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const admin = await requireAdmin(request); const form = await request.formData(); const intent = String(form.get("intent") ?? "");
  const db = createDb(env.DB); const now = new Date().toISOString();
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
  if (intent === "case") {
    const status = String(form.get("status") ?? "");
    if (status !== "REVIEWING" && status !== "DISMISSED" && status !== "CONFIRMED") throw new Response("Invalid status", { status: 400 });
    await transitionIntegrityCase(db, { caseId: String(form.get("caseId") ?? ""), actorUserId: admin.id, status, reason: String(form.get("reason") ?? ""), now });
    return { ok: true, message: "사건 상태를 변경했습니다." };
  }
  if (intent === "invalidate") {
    await invalidateVoteEvent(db, {
      voteEventId: String(form.get("voteEventId") ?? ""),
      integrityCaseId: String(form.get("caseId") ?? ""),
      actorUserId: admin.id,
      reason: String(form.get("reason") ?? ""),
      now,
    });
    return { ok: true, message: "원본은 보존하고 해당 투표를 집계에서 무효화했습니다." };
  }
  throw new Response("Invalid intent", { status: 400 });
}

export function meta() { return [{ title: "평가 운영 — Re:Taste Admin" }]; }

function ratingJobMessage(status: string) {
  switch (status) {
    case "COMPLETED": return "요청한 장소의 재계산이 완료됐습니다.";
    case "RUNNING": return "요청한 작업을 처리 중입니다. 작업 상태를 다시 확인해 주세요.";
    case "PENDING": return "요청한 작업이 대기 중입니다.";
    case "FAILED": return "요청한 작업이 실패했습니다. 작업 기록을 확인해 주세요.";
    default: return "요청한 작업의 결과를 확인할 수 없습니다. 상태를 다시 확인해 주세요.";
  }
}

export default function AdminRatings({ loaderData, actionData }: Route.ComponentProps) {
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
          {requestedJob.status === "FAILED" && <Form method="post">
            <input type="hidden" name="intent" value="retry-recompute" />
            <input type="hidden" name="jobId" value={requestedJob.job.id} />
            <input type="hidden" name="placeId" value={requestedJob.job.placeId ?? ""} />
            <button>이 실패 작업 재시도 검토</button>
          </Form>}
        </>}
      </div>}
    </section><section className="admin-rating-section"><h2>재계산 작업</h2>{loaderData.jobs.length ? <div className="admin-rating-table">{loaderData.jobs.map((job) => <article key={job.id}><strong>{job.status}</strong><span>작업 ID <Link to={`?jobId=${encodeURIComponent(job.id)}`}>{job.id}</Link></span><span>{job.placeId ?? "전체"} · {job.configId} · {job.attempts}회</span><span>{job.reason}</span><small>{job.errorSummary ?? job.updatedAt}</small></article>)}</div> : <p>작업 기록이 없습니다.</p>}</section><section className="admin-rating-section"><h2>조작 검토</h2>{loaderData.cases.length ? loaderData.cases.map((item) => <article className="integrity-case" key={item.id}><div><strong>{item.status} · {item.signalType}</strong><p>{item.subjectType} · {item.subjectId}</p><code>{item.evidenceJson}</code></div>{item.status === "CONFIRMED" ? <Form method="post"><input type="hidden" name="intent" value="invalidate"/><input type="hidden" name="caseId" value={item.id}/><input name="voteEventId" placeholder="무효화할 vote event ID" required/><input name="reason" placeholder="무효화 사유" required/><button>투표 무효화·재계산</button></Form> : <Form method="post"><input type="hidden" name="intent" value="case"/><input type="hidden" name="caseId" value={item.id}/><input name="reason" placeholder="처리 사유"/><button name="status" value="REVIEWING">검토 시작</button><button name="status" value="DISMISSED">해제</button><button name="status" value="CONFIRMED">조작 확인</button></Form>}</article>) : <p>열린 조작 검토가 없습니다.</p>}</section></main>;
}

function Stat({ label, value }: { label: string; value: number }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
