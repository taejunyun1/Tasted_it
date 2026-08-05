import { env } from "cloudflare:workers";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { Form } from "react-router";
import type { Route } from "./+types/admin-ratings";

import { createDb } from "../db/client.server";
import { goldenPickEvents, integrityCases, places, ratingRecomputeJobs, ratingSnapshots } from "../db/schema";
import { requireAdmin } from "../features/auth/session.server";
import { getActiveRatingConfig } from "../features/ratings/rating-config.server";
import { transitionIntegrityCase } from "../features/ratings/integrity.server";
import { enqueueRatingRecompute, processRatingJobs } from "../features/ratings/recompute.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const db = createDb(env.DB); const now = new Date().toISOString();
  const [config, snapshots, jobs, cases, picks, placeRows] = await Promise.all([
    getActiveRatingConfig(db, now),
    db.select().from(ratingSnapshots).orderBy(desc(ratingSnapshots.computedAt)).limit(100),
    db.select().from(ratingRecomputeJobs).orderBy(desc(ratingRecomputeJobs.createdAt)).limit(100),
    db.select().from(integrityCases).where(inArray(integrityCases.status, ["OPEN", "REVIEWING"])).orderBy(asc(integrityCases.createdAt)).limit(100),
    db.select().from(goldenPickEvents).orderBy(desc(goldenPickEvents.effectiveAt)).limit(200),
    db.select({ id: places.id, name: places.name }).from(places).orderBy(asc(places.name)).limit(500),
  ]);
  const closedPicks = new Set(picks.filter((pick) => pick.eventType !== "GRANT" && pick.previousEventId).map((pick) => pick.previousEventId));
  return {
    config,
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
  const admin = await requireAdmin(request); const form = await request.formData(); const intent = String(form.get("intent") ?? "");
  const db = createDb(env.DB); const now = new Date().toISOString();
  if (intent === "recompute") {
    const placeId = String(form.get("placeId") ?? "");
    await enqueueRatingRecompute(db, { placeId, reason: "ADMIN_REQUEST", now });
    await processRatingJobs(db, { now, limit: 1 });
    return { ok: true, message: "재계산을 완료했습니다." };
  }
  if (intent === "case") {
    const status = String(form.get("status") ?? "");
    if (status !== "REVIEWING" && status !== "DISMISSED" && status !== "CONFIRMED") throw new Response("Invalid status", { status: 400 });
    await transitionIntegrityCase(db, { caseId: String(form.get("caseId") ?? ""), actorUserId: admin.id, status, reason: String(form.get("reason") ?? ""), now });
    return { ok: true, message: "사건 상태를 변경했습니다." };
  }
  throw new Response("Invalid intent", { status: 400 });
}

export function meta() { return [{ title: "평가 운영 — Re:Taste Admin" }]; }

export default function AdminRatings({ loaderData, actionData }: Route.ComponentProps) {
  return <main id="main" className="admin-rating-shell"><header><p className="eyebrow">ADMIN / RATING OPERATIONS</p><h1>평가 운영</h1><p>활성 알고리즘 <strong>{loaderData.config.algorithmVersion}</strong> · 최소 공개 {loaderData.config.minimumVisibleSamples}표</p></header>{actionData?.message && <p className="admin-notice">{actionData.message}</p>}<section className="admin-rating-stats"><Stat label="반영 대기" value={loaderData.stats.stale}/><Stat label="재계산 대기" value={loaderData.stats.pending}/><Stat label="재계산 실패" value={loaderData.stats.failed}/><Stat label="열린 검토" value={loaderData.stats.openCases}/><Stat label="Golden Pick" value={loaderData.stats.activeGoldenPicks}/></section><section className="admin-rating-section"><h2>수동 재계산</h2><Form method="post"><input type="hidden" name="intent" value="recompute"/><select name="placeId" aria-label="재계산 장소">{loaderData.places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select><button>선택 장소 재계산</button></Form></section><section className="admin-rating-section"><h2>재계산 작업</h2>{loaderData.jobs.length ? <div className="admin-rating-table">{loaderData.jobs.map((job) => <article key={job.id}><strong>{job.status}</strong><span>{job.placeId ?? "전체"}</span><span>{job.reason}</span><small>{job.errorSummary ?? job.updatedAt}</small></article>)}</div> : <p>작업 기록이 없습니다.</p>}</section><section className="admin-rating-section"><h2>조작 검토</h2>{loaderData.cases.length ? loaderData.cases.map((item) => <article className="integrity-case" key={item.id}><div><strong>{item.signalType}</strong><p>{item.subjectType} · {item.subjectId}</p><code>{item.evidenceJson}</code></div><Form method="post"><input type="hidden" name="intent" value="case"/><input type="hidden" name="caseId" value={item.id}/><input name="reason" placeholder="처리 사유"/><button name="status" value="REVIEWING">검토 시작</button><button name="status" value="DISMISSED">해제</button><button name="status" value="CONFIRMED">조작 확인</button></Form></article>) : <p>열린 조작 검토가 없습니다.</p>}</section></main>;
}

function Stat({ label, value }: { label: string; value: number }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
