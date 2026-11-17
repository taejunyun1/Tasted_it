import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { createDb } from "../../db/client.server";
import { places, ratingRecomputeJobs } from "../../db/schema";
import { commitAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";
import { getAdminAssurance } from "../auth/admin-assurance.server";
import { getActiveRatingConfig } from "./rating-config.server";
import { processRatingJob, RATING_JOB_MAX_ATTEMPTS } from "./recompute.server";

const snapshotSchema = z.object({
  placeId: z.string().min(1).max(128),
  placeUpdatedAt: z.string(),
  voteRevision: z.number().int().nonnegative(),
  configId: z.string(),
  configUpdatedAt: z.string(),
  jobId: z.string(),
  existingJob: z.object({ status: z.enum(["PENDING", "RUNNING", "FAILED"]), attempts: z.number().int(), updatedAt: z.string() }).nullable(),
  retry: z.boolean(),
});

const resultSchema = z.object({ jobId: z.string(), placeId: z.string(), configId: z.string(), status: z.literal("PENDING") });
type Operator = { actorUserId: string; sessionId: string; now: string };

export async function prepareRatingRecompute(database: D1Database, input: Operator & { placeId: string; retryJobId?: string }) {
  const parsed = z.object({ placeId: z.string().min(1).max(128), retryJobId: z.string().min(1).max(128).optional() }).safeParse(input);
  if (!parsed.success) throw new Response("재계산할 장소와 작업을 확인해 주세요.", { status: 400 });
  const { placeId } = parsed.data;
  const db = createDb(database);
  const [place, config] = await Promise.all([
    db.query.places.findFirst({ where: eq(places.id, placeId) }),
    getActiveRatingConfig(db, input.now),
  ]);
  if (!place) throw new Response("재계산할 장소를 확인해 주세요.", { status: 404 });
  const job = input.retryJobId
    ? await db.query.ratingRecomputeJobs.findFirst({ where: eq(ratingRecomputeJobs.id, input.retryJobId) })
    : await db.query.ratingRecomputeJobs.findFirst({ where: and(eq(ratingRecomputeJobs.placeId, placeId), eq(ratingRecomputeJobs.configId, config.id), inArray(ratingRecomputeJobs.status, ["PENDING", "RUNNING"])) });
  if (input.retryJobId && (!job || job.status !== "FAILED" || job.placeId !== placeId || job.configId !== config.id || job.attempts >= RATING_JOB_MAX_ATTEMPTS))
    throw new Response("이 실패 작업을 다시 실행할 수 없습니다. 최신 상태를 확인해 주세요.", { status: 409 });
  if (job?.status === "PENDING" && job.attempts >= RATING_JOB_MAX_ATTEMPTS) throw new Response("작업의 재시도 한도에 도달했습니다.", { status: 409 });
  const payload = snapshotSchema.parse({
    placeId, placeUpdatedAt: place.updatedAt, voteRevision: place.voteRevision,
    configId: config.id, configUpdatedAt: config.updatedAt, jobId: job?.id ?? crypto.randomUUID(),
    existingJob: job ? { status: job.status, attempts: job.attempts, updatedAt: job.updatedAt } : null,
    retry: Boolean(input.retryJobId),
  });
  const operation = await prepareAdminOperation(database, {
    ...input, kind: "RATING_RECOMPUTE", payload,
    summary: { title: `${place.name.slice(0, 90)} 평가 재계산${payload.retry ? " 재시도" : ""}`, count: 1 },
  });
  return { ...operation, placeName: place.name, placeId, configId: config.id, jobId: payload.jobId, retry: payload.retry };
}

export async function commitRatingRecompute(database: D1Database, input: Operator & { operationId: string }) {
  const accepted = await commitAdminOperation(database, { ...input, kind: "RATING_RECOMPUTE" }, async (operation) => {
    const snapshot = snapshotSchema.parse(operation.payload);
    if (snapshot.retry && !await getAdminAssurance(database, { ...input, now: new Date(input.now) }))
      throw new Error("ADMIN_RECENT_AUTH_REQUIRED");
    const scope = database.prepare(`INSERT INTO admin_operation_checks (operation_id, check_name, passed)
      SELECT ?, 'rating_scope', CASE WHEN EXISTS(SELECT 1 FROM places WHERE id=? AND updated_at=? AND vote_revision=?)
      AND (SELECT id FROM rating_configs WHERE active_until IS NULL ORDER BY active_from DESC LIMIT 1)=?
      AND EXISTS(SELECT 1 FROM rating_configs WHERE id=? AND updated_at=?) THEN 1 ELSE 0 END`)
      .bind(operation.id, snapshot.placeId, snapshot.placeUpdatedAt, snapshot.voteRevision, snapshot.configId, snapshot.configId, snapshot.configUpdatedAt);
    const check = snapshot.existingJob
      ? database.prepare(`INSERT INTO admin_operation_checks (operation_id, check_name, passed)
          SELECT ?, 'rating_job', CASE WHEN EXISTS(SELECT 1 FROM rating_recompute_jobs WHERE id=? AND place_id=? AND config_id=? AND scope='PLACE' AND status=? AND attempts=? AND updated_at=? AND (?=0 OR (attempts<3 AND NOT EXISTS(SELECT 1 FROM rating_recompute_jobs other WHERE other.place_id=? AND other.config_id=? AND other.id<>? AND other.status IN ('PENDING','RUNNING'))))) THEN 1 ELSE 0 END`)
        .bind(operation.id, snapshot.jobId, snapshot.placeId, snapshot.configId, snapshot.existingJob.status, snapshot.existingJob.attempts, snapshot.existingJob.updatedAt, snapshot.retry ? 1 : 0, snapshot.placeId, snapshot.configId, snapshot.jobId)
      : database.prepare(`INSERT INTO admin_operation_checks (operation_id, check_name, passed)
          SELECT ?, 'rating_job', CASE WHEN NOT EXISTS(SELECT 1 FROM rating_recompute_jobs WHERE id=? OR (place_id=? AND config_id=? AND status IN ('PENDING','RUNNING'))) THEN 1 ELSE 0 END`)
        .bind(operation.id, snapshot.jobId, snapshot.placeId, snapshot.configId);
    const statement = snapshot.existingJob
      ? snapshot.retry
        ? database.prepare("UPDATE rating_recompute_jobs SET status='PENDING', error_summary=NULL, finished_at=NULL, updated_at=? WHERE id=?").bind(input.now, snapshot.jobId)
        : database.prepare("UPDATE rating_recompute_jobs SET updated_at=updated_at WHERE id=?").bind(snapshot.jobId)
      : database.prepare(`INSERT INTO rating_recompute_jobs (id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at)
          VALUES (?,?,?,'PLACE','PENDING','ADMIN_REQUEST',0,?,?)`)
        .bind(snapshot.jobId, snapshot.placeId, snapshot.configId, input.now, input.now);
    const authCheck = database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?, 'rating_retry_auth', CASE WHEN ?=0 OR EXISTS(SELECT 1 FROM admin_session_assurances WHERE session_id=? AND actor_user_id=? AND verified_at<=? AND expires_at>?) THEN 1 ELSE 0 END`)
      .bind(operation.id, snapshot.retry ? 1 : 0, input.sessionId, input.actorUserId, input.now, input.now);
    return { checks: [scope, check, authCheck], statements: [statement], result: { jobId: snapshot.jobId, placeId: snapshot.placeId, configId: snapshot.configId, status: "PENDING" } };
  });
  const job = resultSchema.parse(accepted.result);
  let result;
  try {
    result = await processRatingJob(createDb(database), { ...job, now: input.now });
  } catch {
    // Acceptance is durable; a transport/storage failure is not job completion.
    console.error(JSON.stringify({ event: "ADMIN_RATING_RESULT_UNKNOWN", operationId: accepted.operationId }));
    result = { jobId: job.jobId, job: null, status: "UNKNOWN" as const, claimed: false };
  }
  return { operationId: accepted.operationId, replayed: accepted.replayed, ...result };
}
