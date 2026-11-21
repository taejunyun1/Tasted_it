import { and, desc, eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { AppDb } from "../../db/client.server";
import { parkingDataSnapshots, parkingSyncRuns } from "../../db/schema";

export const PARKING_JOB_MAX_ATTEMPTS = 3;
export const PARKING_JOB_LEASE_MS = 10 * 60 * 1000;
const PARKING_SYNC_INTERVAL_MS = 90 * 86_400_000;
export type ParkingJobSource = "PARKING" | "EV";
export type ParkingJob = typeof parkingSyncRuns.$inferSelect;
export type ParkingLease = { runId: string; snapshotId: string; source: ParkingJobSource; version: number };
export const parkingOwnership = "EXISTS(SELECT 1 FROM parking_sync_runs WHERE id=? AND status='RUNNING' AND lease_version=? AND lease_expires_at IS NOT NULL)";
export const leaseValues = (lease: ParkingLease) => [lease.runId, lease.version];

export function isParkingSyncDue(lastFinishedAt: string | null, now = new Date()) {
  if (!lastFinishedAt) return true;
  const finished = Date.parse(lastFinishedAt);
  return Number.isNaN(finished) || now.getTime() - finished >= PARKING_SYNC_INTERVAL_MS;
}

function isActiveParkingJob(job: ParkingJob | undefined) {
  return job?.status === "PENDING" || job?.status === "RUNNING";
}

function isParkingCycleDue(job: ParkingJob | undefined, now: Date) {
  return isParkingSyncDue(job?.finishedAt ?? job?.updatedAt ?? null, now);
}

export function isParkingSourceDue(job: ParkingJob | undefined, now: Date) {
  return isActiveParkingJob(job) || isParkingCycleDue(job, now);
}

export function findParkingSourceJob(db: AppDb, source: ParkingJobSource) {
  const active = sql`${parkingSyncRuns.status} in ('PENDING','RUNNING')`;
  const cycleAt = sql`case when ${active} then ${parkingSyncRuns.createdAt}
    else coalesce(${parkingSyncRuns.finishedAt}, ${parkingSyncRuns.updatedAt}) end`;
  return db.query.parkingSyncRuns.findFirst({
    where: eq(parkingSyncRuns.source, source),
    orderBy: [desc(active), desc(sql`julianday(${cycleAt})`), desc(sql`rowid`)],
  });
}

export function inspectParkingJob(job: ParkingJob, now: string) {
  const legacy = job.status === "RUNNING" && !job.leaseExpiresAt;
  const stale = job.status === "RUNNING" && Boolean(job.leaseExpiresAt && job.leaseExpiresAt <= now);
  const allowedActions: ("CANCEL" | "RETRY" | "RECOVER")[] = [];
  if (job.status === "PENDING" || job.status === "RUNNING" && !legacy) allowedActions.push("CANCEL");
  if ((job.status === "FAILED" || job.status === "CANCELLED") && job.attempts < PARKING_JOB_MAX_ATTEMPTS) allowedActions.push("RETRY");
  if (stale && job.attempts < PARKING_JOB_MAX_ATTEMPTS) allowedActions.push("RECOVER");
  return { status: legacy ? "UNKNOWN" as const : stale ? "STALE" as const : job.status,
    allowedActions, maxAttempts: PARKING_JOB_MAX_ATTEMPTS, leaseExpiresAt: job.leaseExpiresAt,
    blockedReason: legacy ? "이전 실행의 소유권을 확인할 수 없어 자동 재실행할 수 없습니다."
      : !allowedActions.length ? job.attempts >= PARKING_JOB_MAX_ATTEMPTS ? "재시도 한도에 도달했습니다." : "종료된 작업입니다." : null };
}

export async function parkingJobResult(db: AppDb, runId: string, claimed = false) {
  const job = await db.query.parkingSyncRuns.findFirst({ where: eq(parkingSyncRuns.id, runId) });
  return { runId, snapshotId: job?.snapshotId ?? null, job: job ?? null, status: job?.status ?? "UNKNOWN" as const,
    completed: job?.status === "COMPLETED", claimed, nextPage: job?.nextPage ?? 1,
    fetched: job?.fetchedCount ?? 0, accepted: job?.acceptedCount ?? 0, skipped: job?.skippedCount ?? 0 };
}

/** Create/reuse the source's one active run and claim one bounded batch. */
export async function claimParkingJob(db: AppDb, source: ParkingJobSource, now: string, exactRunId?: string) {
  let job = exactRunId
    ? await db.query.parkingSyncRuns.findFirst({ where: eq(parkingSyncRuns.id, exactRunId) })
    : await findParkingSourceJob(db, source);
  if (job && job.source !== source) throw new Error("PARKING_JOB_SCOPE_MISMATCH");
  if (!exactRunId && !isActiveParkingJob(job) && isParkingCycleDue(job, new Date(now))) {
    const id = crypto.randomUUID(), snapshotId = crypto.randomUUID();
    const cutoff = new Date(Date.parse(now) - PARKING_SYNC_INTERVAL_MS).toISOString();
    // A concurrent caller can finish before this batch runs. Its terminal row still blocks a second cycle.
    await db.$client.batch([
      db.$client.prepare(`INSERT INTO parking_data_snapshots(id,source,status,row_count,created_at,updated_at)
        SELECT ?,?,'STAGING',0,?,? WHERE NOT EXISTS(
          SELECT 1 FROM parking_sync_runs WHERE source=?
            AND (status IN ('PENDING','RUNNING') OR julianday(coalesce(finished_at,updated_at))>julianday(?))
        )`).bind(snapshotId, source, now, now, source, cutoff),
      db.$client.prepare(`INSERT INTO parking_sync_runs(id,source,status,snapshot_id,started_at,created_at,updated_at,attempts,lease_version)
        SELECT ?,?,'PENDING',?,?,?,?,1,0 WHERE EXISTS(SELECT 1 FROM parking_data_snapshots WHERE id=?)`)
        .bind(id, source, snapshotId, now, now, now, snapshotId),
    ]);
    job = await findParkingSourceJob(db, source);
  }
  if (!job?.snapshotId) throw new Error("PARKING_JOB_NOT_FOUND");
  if (job.status !== "PENDING") return { job, lease: null };
  const [claimed] = await db.update(parkingSyncRuns).set({ status: "RUNNING", leaseVersion: job.leaseVersion + 1,
    leaseExpiresAt: new Date(Date.parse(now) + PARKING_JOB_LEASE_MS).toISOString(), updatedAt: now })
    .where(and(eq(parkingSyncRuns.id, job.id), eq(parkingSyncRuns.status, "PENDING"), eq(parkingSyncRuns.leaseVersion, job.leaseVersion), sql`not exists(select 1 from parking_sync_runs other where other.source=${source} and other.id<>${job.id} and other.status in ('PENDING','RUNNING'))`))
    .returning();
  if (!claimed) return { job: (await parkingJobResult(db, job.id)).job!, lease: null };
  return { job: claimed, lease: { runId: claimed.id, snapshotId: claimed.snapshotId!, source, version: claimed.leaseVersion } satisfies ParkingLease };
}

export async function assertParkingLease(db: AppDb, lease: ParkingLease) {
  if (!await db.$client.prepare(`SELECT 1 WHERE ${parkingOwnership}`).bind(...leaseValues(lease)).first()) throw new Error("PARKING_JOB_OWNERSHIP_LOST");
}

/** Column names are generated only from fixed Drizzle schema, never request data. */
export async function insertParkingRows(db: AppDb, table: SQLiteTable, rows: Record<string, unknown>[], lease: ParkingLease, upsert = false) {
  const columns = getTableColumns(table);
  const encoder = new TextEncoder();
  let statements: D1PreparedStatement[] = [];
  let payloadBytes = 0;
  const flush = async () => {
    if (!statements.length) return;
    // D1 counts a batch as one subrequest. Keep the ownership probe in the
    // same transaction as its fenced writes, so it needs no extra request.
    const results = await db.$client.batch([...statements,
      db.$client.prepare(`SELECT 1 WHERE ${parkingOwnership}`).bind(...leaseValues(lease)),
    ]);
    if (!results.at(-1)?.results.length) throw new Error("PARKING_JOB_OWNERSHIP_LOST");
    statements = [];
    payloadBytes = 0;
  };
  for (const row of rows) {
    const entries = Object.entries(row).map(([key, value]) => {
      const column = columns[key];
      if (!column) throw new Error("PARKING_ROW_FIELD_INVALID");
      return [column.name, typeof value === "boolean" ? Number(value) : value] as const;
    });
    const names = entries.map(([name]) => `"${name}"`);
    const values = entries.map(([, value]) => value as string | number | null);
    const conflict = upsert ? `DO UPDATE SET ${entries.filter(([name]) => !["id", "snapshot_id", "created_at"].includes(name)).map(([name]) => `"${name}"=excluded."${name}"`).join(",")}` : "DO NOTHING";
    const query = `INSERT INTO "${getTableName(table)}" (${names.join(",")}) SELECT ${entries.map(() => "?").join(",")}
      WHERE ${parkingOwnership} ON CONFLICT ${conflict}`;
    const parameters = [...values, ...leaseValues(lease)];
    const bytes = encoder.encode(JSON.stringify({ sql: query, params: parameters })).byteLength;
    // Leave room for the ownership probe and transport envelope under 1 MB.
    if (parameters.length > 100 || bytes > 900_000) throw new Error("PARKING_ROW_TOO_LARGE");
    if (statements.length >= 100 || payloadBytes + bytes > 900_000) await flush();
    statements.push(db.$client.prepare(query).bind(...parameters));
    payloadBytes += bytes;
  }
  if (statements.length) await flush();
  else if (!rows.length) await assertParkingLease(db, lease);
}

export async function failParkingJob(db: AppDb, lease: ParkingLease, now: string, errorSummary: string) {
  await db.$client.batch([
    db.$client.prepare(`UPDATE parking_data_snapshots SET status='FAILED',updated_at=? WHERE id=? AND status='STAGING' AND ${parkingOwnership}`)
      .bind(now, lease.snapshotId, ...leaseValues(lease)),
    db.$client.prepare(`UPDATE parking_sync_runs SET status='FAILED',finished_at=?,error_summary=?,lease_expires_at=NULL,updated_at=? WHERE id=? AND ${parkingOwnership}`)
      .bind(now, errorSummary, now, lease.runId, ...leaseValues(lease)),
  ]);
}

export type ParkingCounts = { fetched: number; accepted: number; skipped: number; totalCount: number; nextPage: number };
export async function checkpointParkingJob(db: AppDb, lease: ParkingLease, now: string, counts: ParkingCounts) {
  await db.$client.prepare(`UPDATE parking_sync_runs SET status='PENDING',next_page=?,total_count=?,fetched_count=?,accepted_count=?,skipped_count=?,lease_expires_at=NULL,updated_at=?
    WHERE id=? AND ${parkingOwnership}`).bind(counts.nextPage, counts.totalCount, counts.fetched, counts.accepted, counts.skipped, now, lease.runId, ...leaseValues(lease)).run();
}

export async function activateParkingJob(db: AppDb, lease: ParkingLease, now: string, counts: ParkingCounts, dates: { min: string | null; max: string | null }) {
  await db.$client.batch([
    db.$client.prepare(`UPDATE parking_data_snapshots SET status='RETIRED',updated_at=? WHERE source=? AND status='ACTIVE' AND ${parkingOwnership}`).bind(now, lease.source, ...leaseValues(lease)),
    db.$client.prepare(`UPDATE parking_data_snapshots SET status='ACTIVE',row_count=?,source_reference_date_min=?,source_reference_date_max=?,activated_at=?,updated_at=?
      WHERE id=? AND status='STAGING' AND ${parkingOwnership}`).bind(counts.accepted, dates.min, dates.max, now, now, lease.snapshotId, ...leaseValues(lease)),
    db.$client.prepare(`UPDATE parking_sync_runs SET status='COMPLETED',next_page=?,total_count=?,fetched_count=?,accepted_count=?,skipped_count=?,finished_at=?,error_summary=NULL,lease_expires_at=NULL,updated_at=?
      WHERE id=? AND ${parkingOwnership}`).bind(counts.nextPage, counts.totalCount, counts.fetched, counts.accepted, counts.skipped, now, now, lease.runId, ...leaseValues(lease)),
  ]);
}
