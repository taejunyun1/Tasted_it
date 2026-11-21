import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../../db/client.server";
import { places, ratingRecomputeJobs } from "../../db/schema";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";
import { getActiveRatingConfig } from "./rating-config.server";
import { CURRENT_RATING_CONFIG_ID_SQL } from "./rating-config-eligibility";
import { getRatingJobResult, processRatingJob, RATING_JOB_MAX_ATTEMPTS, type RatingRecomputeJob } from "./recompute.server";

type Operator = { actorUserId: string; sessionId: string; now: string };
export type RatingJobAction = "CANCEL" | "RETRY" | "RECOVER";

export function inspectRatingJob(job: RatingRecomputeJob, now: string, activeConfigId?: string) {
  const stale = job.status === "RUNNING" && job.leaseExpiresAt !== null && job.leaseExpiresAt <= now;
  let blockedReason: string | null = null;
  let allowedActions: RatingJobAction[] = [];
  if (job.scope !== "PLACE" || !job.placeId) blockedReason = "장소 단위 작업만 조작할 수 있습니다.";
  else if (job.status === "PENDING") allowedActions = ["CANCEL"];
  else if (job.status === "COMPLETED" || job.status === "CANCELLED") blockedReason = "종료된 작업입니다.";
  else if (job.status === "RUNNING" && !job.leaseExpiresAt) blockedReason = "이전 실행의 소유권을 확인할 수 없어 자동 재실행할 수 없습니다.";
  else if (job.status === "RUNNING" && !stale) blockedReason = "실행 중에는 취소하거나 다시 실행할 수 없습니다.";
  else if (activeConfigId && job.configId !== activeConfigId) blockedReason = "활성 평가 설정이 달라 이 작업을 다시 실행할 수 없습니다.";
  else if (job.attempts >= RATING_JOB_MAX_ATTEMPTS) blockedReason = "재시도 한도에 도달했습니다. 원인을 확인해 주세요.";
  else if (job.status === "FAILED") allowedActions = ["RETRY"];
  else if (stale) allowedActions = ["RECOVER"];
  return { status: job.status === "RUNNING" && !job.leaseExpiresAt ? "UNKNOWN" as const : stale ? "STALE" as const : job.status, allowedActions, blockedReason,
    leaseExpiresAt: job.leaseExpiresAt, maxAttempts: RATING_JOB_MAX_ATTEMPTS };
}

const snapshotSchema = z.object({
  jobId: z.string().min(1).max(128), placeId: z.string().min(1).max(128), placeName: z.string(),
  configId: z.string(), action: z.enum(["CANCEL", "RETRY", "RECOVER"]), reason: z.string().min(5).max(300),
  previousStatus: z.enum(["PENDING", "RUNNING", "FAILED"]), attempts: z.number().int().nonnegative(),
  updatedAt: z.string(), leaseExpiresAt: z.string().nullable(),
});

export async function prepareRatingJobAction(database: D1Database, input: Operator & { jobId: string; action: RatingJobAction; reason: string }) {
  const parsed = z.object({ jobId: z.string().min(1).max(128), action: z.enum(["CANCEL", "RETRY", "RECOVER"]), reason: z.string().trim().min(5).max(300) }).safeParse(input);
  if (!parsed.success) throw new Error("RATING_JOB_INPUT_INVALID");
  const db = createDb(database);
  const job = await db.query.ratingRecomputeJobs.findFirst({ where: eq(ratingRecomputeJobs.id, parsed.data.jobId) });
  if (!job) throw new Error("RATING_JOB_NOT_FOUND");
  const config = await getActiveRatingConfig(db, input.now);
  if (!inspectRatingJob(job, input.now, config.id).allowedActions.includes(parsed.data.action)) throw new Error("RATING_JOB_ACTION_UNAVAILABLE");
  const place = await db.query.places.findFirst({ where: eq(places.id, job.placeId!) });
  if (!place) throw new Error("RATING_JOB_NOT_FOUND");
  const payload = snapshotSchema.parse({ ...parsed.data, placeId: job.placeId, placeName: place.name.slice(0, 90),
    configId: job.configId, previousStatus: job.status, attempts: job.attempts, updatedAt: job.updatedAt, leaseExpiresAt: job.leaseExpiresAt });
  const labels = { CANCEL: "대기 취소", RETRY: "실패 재시도", RECOVER: "정체 복구" };
  const prepared = await prepareAdminOperation(database, { ...input, kind: "RATING_JOB_CONTROL", payload,
    summary: { title: `${payload.placeName} 평가 작업 ${labels[payload.action]}`, count: 1 } });
  return { ...prepared, ...payload };
}

export async function readRatingJobAction(database: D1Database, input: Operator & { operationId: string }) {
  const operation = await getVerifiedAdminOperation(database, { ...input, kind: "RATING_JOB_CONTROL" });
  const payload = snapshotSchema.parse(operation.status === "COMMITTED" ? operation.result : operation.payload);
  return { ...payload, operationId: operation.id, status: operation.status, expiresAt: operation.expiresAt, result: operation.result };
}

export async function commitRatingJobAction(database: D1Database, input: Operator & { operationId: string }) {
  const accepted = await commitAdminOperation(database, { ...input, kind: "RATING_JOB_CONTROL" }, (operation) => {
    const s = snapshotSchema.parse(operation.payload);
    const checks = [database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?, 'rating_job_state', CASE WHEN EXISTS(SELECT 1 FROM rating_recompute_jobs WHERE id=? AND place_id=? AND config_id=?
        AND scope='PLACE' AND status=? AND attempts=? AND updated_at=? AND lease_expires_at IS ?) THEN 1 ELSE 0 END`)
      .bind(operation.id, s.jobId, s.placeId, s.configId, s.previousStatus, s.attempts, s.updatedAt, s.leaseExpiresAt)];
    if (s.action !== "CANCEL") checks.push(database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?, 'rating_job_retry', CASE WHEN ?<?
        AND ${CURRENT_RATING_CONFIG_ID_SQL}=?
        AND NOT EXISTS(SELECT 1 FROM rating_recompute_jobs WHERE place_id=? AND config_id=? AND id<>? AND status IN ('PENDING','RUNNING'))
        AND (?='RETRY' AND ?='FAILED' OR ?='RECOVER' AND ?='RUNNING' AND ? IS NOT NULL AND ?<=?) THEN 1 ELSE 0 END`)
      .bind(operation.id, s.attempts, RATING_JOB_MAX_ATTEMPTS, input.now, s.configId, s.placeId, s.configId, s.jobId,
        s.action, s.previousStatus, s.action, s.previousStatus, s.leaseExpiresAt, s.leaseExpiresAt, input.now));
    else checks.push(database.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) VALUES(?, 'rating_job_pending', ?='PENDING')")
      .bind(operation.id, s.previousStatus));
    const statement = s.action === "CANCEL"
      ? database.prepare("UPDATE rating_recompute_jobs SET status='CANCELLED',finished_at=?,lease_expires_at=NULL,updated_at=? WHERE id=?").bind(input.now, input.now, s.jobId)
      : database.prepare("UPDATE rating_recompute_jobs SET status='PENDING',finished_at=NULL,error_summary=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").bind(input.now, s.jobId);
    return { checks, statements: [statement], result: s };
  });
  await getVerifiedAdminOperation(database, { ...input, kind: "RATING_JOB_CONTROL" });
  const payload = snapshotSchema.parse(accepted.result);
  try {
    const result = payload.action === "CANCEL"
      ? await getRatingJobResult(createDb(database), payload.jobId)
      : await processRatingJob(createDb(database), { jobId: payload.jobId, placeId: payload.placeId, configId: payload.configId, now: input.now });
    return { operationId: accepted.operationId, replayed: accepted.replayed, ...result };
  } catch {
    console.error(JSON.stringify({ event: "ADMIN_RATING_JOB_RESULT_UNKNOWN", operationId: accepted.operationId }));
    return { operationId: accepted.operationId, replayed: accepted.replayed, jobId: payload.jobId, job: null, status: "UNKNOWN" as const, claimed: false };
  }
}
