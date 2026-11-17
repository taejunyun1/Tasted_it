import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../../db/client.server";
import { publicDataSyncRuns } from "../../db/schema";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";
import { describePublicSync, findResumablePublicSync, PUBLIC_SYNC_MAX_FAILURES, publicSyncScope, syncPublicDataBatch } from "./sync.server";

type Operator = { actorUserId: string; sessionId: string; now: string };
const actionSchema = z.enum(["START", "RESUME", "CANCEL"]);
const previousSchema = z.object({ status: z.string(), attempts: z.number().int(), retryCount: z.number().int(), nextPage: z.number().int(),
  leaseId: z.string().nullable(), leaseExpiresAt: z.string().nullable(), updatedAt: z.string() });
const payloadSchema = publicSyncScope.extend({ action: actionSchema, runId: z.string().min(1).max(128), previous: previousSchema.nullable(), reason: z.string().trim().min(1).max(300) });
const resultSchema = publicSyncScope.extend({ action: actionSchema, runId: z.string(), observedAttempts: z.number().int(), reason: z.string().max(300) });

export async function preparePublicSyncOperation(database: D1Database, input: Operator & { action: string; sourceType?: string; addressField?: string; runId?: string; reason: string }) {
  const action = actionSchema.parse(input.action), db = createDb(database);
  if (action !== "CANCEL" && await database.prepare("SELECT id FROM public_data_sync_runs WHERE status='RUNNING' AND lease_id IS NULL LIMIT 1").first())
    throw new Error("PUBLIC_SYNC_LEGACY_UNVERIFIED");
  let run = input.runId ? await db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.id, input.runId) }) : undefined;
  const scope = action === "START" ? publicSyncScope.parse(input) : run ? publicSyncScope.parse(run) : null;
  if (!scope) throw new Error("PUBLIC_SYNC_NOT_FOUND");
  if (action === "START" && await findResumablePublicSync(db, scope)) throw new Error("PUBLIC_SYNC_EXISTS");
  if (action !== "START") {
    if (!run) throw new Error("PUBLIC_SYNC_NOT_FOUND");
    const state = describePublicSync(run, input.now);
    if (action === "RESUME" && !state.canResume || action === "CANCEL" && !state.canCancel) throw new Error("PUBLIC_SYNC_ACTION_UNAVAILABLE");
    if (action === "RESUME" && await database.prepare(`SELECT id FROM public_data_sync_runs WHERE id<>? AND source_type=? AND address_field=?
      AND region_code='GWANGJU_JEONNAM' AND status IN ('PENDING','RUNNING') LIMIT 1`).bind(run.id, run.sourceType, run.addressField).first())
      throw new Error("PUBLIC_SYNC_ACTION_UNAVAILABLE");
  }
  const previous = run ? previousSchema.parse(run) : null;
  const payload = payloadSchema.parse({ ...scope, action, runId: run?.id ?? crypto.randomUUID(), previous, reason: input.reason });
  const operation = await prepareAdminOperation(database, { ...input, kind: "PUBLIC_SYNC_CONTROL", payload,
    summary: { title: `공공 동기화 ${action === "START" ? "시작" : action === "RESUME" ? "재개" : "취소"}`, count: 1 } });
  return { ...operation, ...payload, status: "PENDING" as const };
}

export async function readPublicSyncOperation(database: D1Database, input: Operator & { operationId: string }) {
  const operation = await getVerifiedAdminOperation(database, { ...input, kind: "PUBLIC_SYNC_CONTROL" });
  const payload = operation.status === "PENDING" ? payloadSchema.parse(operation.payload) : resultSchema.parse(operation.result);
  return { operationId: operation.id, status: operation.status, expiresAt: operation.expiresAt, ...payload };
}

export async function commitPublicSyncOperation(database: D1Database, input: Operator & { operationId: string }, options: { serviceKey: string; fetcher?: typeof fetch }) {
  const currentOperation = await getVerifiedAdminOperation(database, { ...input, kind: "PUBLIC_SYNC_CONTROL" });
  if (currentOperation.status === "PENDING" && payloadSchema.parse(currentOperation.payload).action !== "CANCEL" && !options.serviceKey.trim())
    throw new Error("PUBLIC_SYNC_NOT_CONFIGURED");
  const receipt = await commitAdminOperation(database, { ...input, kind: "PUBLIC_SYNC_CONTROL" }, (operation) => {
    const p = payloadSchema.parse(operation.payload), old = p.previous;
    const checks = [database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?,'public_sync_scope',CASE WHEN ${old
        ? "EXISTS(SELECT 1 FROM public_data_sync_runs WHERE id=? AND source_type=? AND address_field=? AND status=? AND attempts=? AND retry_count=? AND next_page=? AND lease_id IS ? AND lease_expires_at IS ? AND updated_at=?)"
        : "NOT EXISTS(SELECT 1 FROM public_data_sync_runs WHERE source_type=? AND address_field=? AND region_code='GWANGJU_JEONNAM' AND status IN ('PENDING','RUNNING','FAILED'))"} THEN 1 ELSE 0 END`)
      .bind(operation.id, ...(old ? [p.runId, p.sourceType, p.addressField, old.status, old.attempts, old.retryCount, old.nextPage, old.leaseId, old.leaseExpiresAt, old.updatedAt] : [p.sourceType, p.addressField]))];
    if (p.action !== "CANCEL") checks.push(database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?,'public_sync_legacy',CASE WHEN NOT EXISTS(SELECT 1 FROM public_data_sync_runs WHERE status='RUNNING' AND lease_id IS NULL) THEN 1 ELSE 0 END`)
      .bind(operation.id));
    if (p.action === "RESUME") checks.push(database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?,'public_sync_resume',CASE WHEN EXISTS(SELECT 1 FROM public_data_sync_runs WHERE id=? AND status IN ('PENDING','RUNNING','FAILED')
        AND cancel_requested_at IS NULL AND (status<>'RUNNING' OR lease_id IS NOT NULL) AND retry_count+CASE WHEN status='RUNNING' AND lease_id IS NOT NULL THEN 1 ELSE 0 END<?
        AND (lease_id IS NULL OR lease_expires_at<=?)) AND NOT EXISTS(SELECT 1 FROM public_data_sync_runs other
        WHERE other.id<>? AND other.source_type=? AND other.address_field=? AND other.region_code='GWANGJU_JEONNAM'
        AND other.status IN ('PENDING','RUNNING')) THEN 1 ELSE 0 END`)
      .bind(operation.id, p.runId, PUBLIC_SYNC_MAX_FAILURES, input.now, p.runId, p.sourceType, p.addressField));
    if (p.action === "CANCEL") checks.push(database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
      SELECT ?,'public_sync_cancel',CASE WHEN EXISTS(SELECT 1 FROM public_data_sync_runs WHERE id=?
        AND status IN ('PENDING','RUNNING','FAILED') AND (status<>'RUNNING' OR lease_id IS NOT NULL)) THEN 1 ELSE 0 END`)
      .bind(operation.id, p.runId));
    const statements = p.action === "START" ? [database.prepare(`INSERT INTO public_data_sync_runs(id,source_type,region_code,address_field,status,started_at,created_at,updated_at)
      VALUES(?,?,'GWANGJU_JEONNAM',?,'PENDING',?,?,?)`).bind(p.runId, p.sourceType, p.addressField, input.now, input.now, input.now)]
      : p.action === "CANCEL" ? [database.prepare(`UPDATE public_data_sync_runs SET status='CANCELLED',cancel_requested_at=?,finished_at=?,lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?`)
        .bind(input.now, input.now, input.now, p.runId)]
      : [database.prepare(`UPDATE public_data_sync_runs SET retry_count=retry_count+CASE WHEN status='RUNNING' AND lease_id IS NOT NULL THEN 1 ELSE 0 END,
          status='PENDING',lease_id=NULL,lease_expires_at=NULL,finished_at=NULL,error_summary=NULL,updated_at=? WHERE id=?`).bind(input.now, p.runId)];
    return { checks, statements, result: { action: p.action, runId: p.runId, sourceType: p.sourceType, addressField: p.addressField, observedAttempts: old?.attempts ?? 0, reason: p.reason } };
  });
  await getVerifiedAdminOperation(database, { ...input, kind: "PUBLIC_SYNC_CONTROL" });
  const accepted = resultSchema.parse(receipt.result), db = createDb(database);
  if (accepted.action !== "CANCEL") {
    // The same receipt can recover a pre-execution lost response, but it can
    // never start the next batch after its original attempt has been claimed.
    try { await syncPublicDataBatch(db, { ...accepted, serviceKey: options.serviceKey, fetcher: options.fetcher, expectedAttempts: accepted.observedAttempts }); }
    catch { /* Durable job state, not the transport result, is shown below. */ }
  }
  const run = await db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.id, accepted.runId) });
  return { ...receipt, accepted, run: run ? describePublicSync(run, new Date().toISOString()) : null };
}
