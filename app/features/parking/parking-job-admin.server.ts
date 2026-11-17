import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../../db/client.server";
import { parkingSyncRuns } from "../../db/schema";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";
import { inspectParkingJob, PARKING_JOB_MAX_ATTEMPTS, parkingJobResult } from "./parking-job.server";

type Operator = { actorUserId: string; sessionId: string; now: string };
export type ParkingJobAction = "CANCEL" | "RETRY" | "RECOVER";
const snapshotSchema = z.object({
  runId: z.string().min(1).max(128), snapshotId: z.string().min(1).max(128), source: z.enum(["PARKING", "EV"]),
  action: z.enum(["CANCEL", "RETRY", "RECOVER"]), reason: z.string().trim().min(5).max(300),
  previousStatus: z.enum(["PENDING", "RUNNING", "FAILED", "CANCELLED"]), attempts: z.number().int().min(1).max(3),
  leaseVersion: z.number().int().nonnegative(), leaseExpiresAt: z.string().nullable(), updatedAt: z.string(), nextPage: z.number().int().positive(),
});

export async function prepareParkingJobAction(database: D1Database, input: Operator & { runId: string; action: ParkingJobAction; reason: string }) {
  const parsed = z.object({ runId: z.string().min(1).max(128), action: z.enum(["CANCEL", "RETRY", "RECOVER"]), reason: z.string().trim().min(5).max(300) }).safeParse(input);
  if (!parsed.success) throw new Error("PARKING_JOB_INPUT_INVALID");
  const job = await createDb(database).query.parkingSyncRuns.findFirst({ where: eq(parkingSyncRuns.id, input.runId) });
  if (!job?.snapshotId) throw new Error("PARKING_JOB_NOT_FOUND");
  if (!inspectParkingJob(job, input.now).allowedActions.includes(parsed.data.action)) throw new Error("PARKING_JOB_ACTION_UNAVAILABLE");
  const payload = snapshotSchema.parse({ ...parsed.data, snapshotId: job.snapshotId, source: job.source, previousStatus: job.status, attempts: job.attempts,
    leaseVersion: job.leaseVersion, leaseExpiresAt: job.leaseExpiresAt, updatedAt: job.updatedAt, nextPage: job.nextPage });
  const labels = { CANCEL: "수집 취소", RETRY: "실패 재시도", RECOVER: "정체 복구" };
  return { ...await prepareAdminOperation(database, { ...input, kind: "PARKING_SYNC_CONTROL", payload, summary: { title: `${job.source === "PARKING" ? "주차" : "EV"} ${labels[payload.action]}`, count: 1 } }), ...payload };
}

export async function readParkingJobAction(database: D1Database, input: Operator & { operationId: string }) {
  const operation = await getVerifiedAdminOperation(database, { ...input, kind: "PARKING_SYNC_CONTROL" });
  return { ...snapshotSchema.parse(operation.status === "COMMITTED" ? operation.result : operation.payload), operationId: operation.id,
    status: operation.status, result: operation.result, expiresAt: operation.expiresAt };
}

export async function commitParkingJobAction(database: D1Database, input: Operator & { operationId: string }) {
  const receipt = await commitAdminOperation(database, { ...input, kind: "PARKING_SYNC_CONTROL" }, (operation) => {
    const s = snapshotSchema.parse(operation.payload);
    const checks = [database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?, 'parking_job_state', CASE WHEN EXISTS(SELECT 1 FROM parking_sync_runs WHERE id=? AND source=? AND snapshot_id=?
        AND status=? AND attempts=? AND lease_version=? AND lease_expires_at IS ? AND updated_at=? AND next_page=?)
        AND EXISTS(SELECT 1 FROM parking_data_snapshots WHERE id=? AND status IN ('STAGING','FAILED')) THEN 1 ELSE 0 END`)
      .bind(operation.id, s.runId, s.source, s.snapshotId, s.previousStatus, s.attempts, s.leaseVersion, s.leaseExpiresAt, s.updatedAt, s.nextPage, s.snapshotId)];
    if (s.action === "CANCEL") checks.push(database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?, 'parking_cancel', CASE WHEN ?='PENDING' OR (?='RUNNING' AND ? IS NOT NULL) THEN 1 ELSE 0 END`)
      .bind(operation.id, s.previousStatus, s.previousStatus, s.leaseExpiresAt));
    else checks.push(database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?, 'parking_retry', CASE WHEN ?<? AND NOT EXISTS(SELECT 1 FROM parking_sync_runs WHERE source=? AND id<>? AND status IN ('PENDING','RUNNING'))
      AND ((?='RETRY' AND ? IN ('FAILED','CANCELLED')) OR (?='RECOVER' AND ?='RUNNING' AND ? IS NOT NULL AND ?<=?)) THEN 1 ELSE 0 END`)
      .bind(operation.id, s.attempts, PARKING_JOB_MAX_ATTEMPTS, s.source, s.runId, s.action, s.previousStatus, s.action, s.previousStatus, s.leaseExpiresAt, s.leaseExpiresAt, input.now));
    const statements = s.action === "CANCEL" ? [
      database.prepare("UPDATE parking_data_snapshots SET status='FAILED',updated_at=? WHERE id=? AND status='STAGING'").bind(input.now, s.snapshotId),
      database.prepare("UPDATE parking_sync_runs SET status='CANCELLED',lease_version=lease_version+1,lease_expires_at=NULL,finished_at=?,updated_at=? WHERE id=?").bind(input.now, input.now, s.runId),
    ] : [
      database.prepare("UPDATE parking_data_snapshots SET status='STAGING',updated_at=? WHERE id=? AND status='FAILED'").bind(input.now, s.snapshotId),
      database.prepare("UPDATE parking_sync_runs SET status='PENDING',attempts=attempts+1,lease_version=lease_version+1,lease_expires_at=NULL,finished_at=NULL,error_summary=NULL,updated_at=? WHERE id=?").bind(input.now, s.runId),
    ];
    return { checks, statements, result: s };
  });
  await getVerifiedAdminOperation(database, { ...input, kind: "PARKING_SYNC_CONTROL" });
  const payload = snapshotSchema.parse(receipt.result);
  return { operationId: receipt.operationId, replayed: receipt.replayed, ...await parkingJobResult(createDb(database), payload.runId) };
}
