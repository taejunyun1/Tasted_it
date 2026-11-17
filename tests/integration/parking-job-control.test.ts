import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { evChargingStations } from "../../app/db/schema";
import { grantAdminAssurance } from "../../app/features/auth/admin-assurance.server";
import { syncParkingDataBatch } from "../../app/features/parking/parking-sync.server";
import { syncEvDataSnapshot } from "../../app/features/parking/ev-sync.server";
import { checkpointParkingJob, claimParkingJob, inspectParkingJob, insertParkingRows } from "../../app/features/parking/parking-job.server";
import { commitParkingJobAction, prepareParkingJobAction } from "../../app/features/parking/parking-job-admin.server";
import { runScheduledParkingSync } from "../../app/features/parking/scheduled-parking.server";

const now = "2026-11-18T01:00:00.000Z";
const item = (id: string) => ({ prkplceNo: id, prkplceNm: `합성 주차장 ${id}`, rdnmadr: "광주광역시 동구 동명로 12", latitude: "35.15", longitude: "126.85", referenceDate: "2026-11-01" });
const response = (id: string) => new Response(JSON.stringify({ response: { body: { totalCount: 1, items: [item(id)] } } }));
async function fixture() {
  await env.DB.prepare("DELETE FROM parking_ev_links").run();
  await env.DB.prepare("DELETE FROM parking_sync_runs").run();
  await env.DB.prepare("DELETE FROM parking_facilities").run();
  await env.DB.prepare("DELETE FROM ev_charging_stations").run();
  await env.DB.prepare("DELETE FROM parking_data_snapshots").run();
  const id = crypto.randomUUID(), sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES (?,?,'합성 관리자','ADMIN',?,?)").bind(id, `${id}@example.test`, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z')").bind(sessionId, id, now).run();
  const operator = { actorUserId: id, sessionId, now };
  await grantAdminAssurance(env.DB, { ...operator, now: new Date(now), method: "PASSWORD" });
  await env.DB.prepare("INSERT INTO parking_data_snapshots(id,source,status,row_count,activated_at,created_at,updated_at) VALUES ('old-parking','PARKING','ACTIVE',1,?,?,?)").bind(now, now, now).run();
  return { db: createDb(env.DB), operator };
}
const active = () => env.DB.prepare("SELECT id,status,row_count FROM parking_data_snapshots WHERE status='ACTIVE' ORDER BY id").all();

describe("B10 parking/EV source-owned jobs", () => {
  it("lets only one concurrent caller fetch and activate a source", async () => {
    const f = await fixture();
    let started!: () => void, release!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => { started(); await paused; return response("winner"); });
    const first = syncParkingDataBatch(f.db, { serviceKey: "synthetic", fetcher, now });
    await began;
    const second = await syncParkingDataBatch(f.db, { serviceKey: "synthetic", fetcher, now });
    expect(second).toMatchObject({ status: "RUNNING", claimed: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toMatchObject({ status: "COMPLETED", claimed: true, accepted: 1 });
    expect((await active()).results).toHaveLength(1);
  });

  it("keeps ACTIVE data on failure and does not auto-create unbounded failed retries", async () => {
    const f = await fixture(), before = (await active()).results;
    const fetcher = vi.fn(async () => new Response("upstream", { status: 503 }));
    await expect(syncParkingDataBatch(f.db, { serviceKey: "synthetic", fetcher, now })).rejects.toThrow("PARKING_DATA_HTTP_503");
    expect((await active()).results).toEqual(before);
    expect(await syncParkingDataBatch(f.db, { serviceKey: "synthetic", fetcher, now })).toMatchObject({ status: "FAILED", claimed: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["short-first", "short-tail", "changed-total"])("preserves ACTIVE when page coverage is incomplete: %s", async (mode) => {
    const f = await fixture(), before = (await active()).results;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const page = Number(new URL(String(input)).searchParams.get("pageNo"));
      const totalCount = mode === "short-tail" ? 102 : mode === "changed-total" && page === 2 ? 100 : 101;
      const size = page === 1 ? mode === "short-first" ? 1 : 100 : mode === "changed-total" ? 0 : 1;
      return new Response(JSON.stringify({ response: { body: { totalCount, items: Array.from({ length: size }, (_, i) => item(`page-${page}-${i}`)) } } }));
    });
    await expect(syncParkingDataBatch(f.db, { serviceKey: "synthetic", fetcher, now })).rejects.toThrow("PARKING_DATA_INCOMPLETE");
    expect((await active()).results).toEqual(before);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM parking_sync_runs WHERE status='COMPLETED'").first()).toEqual({ n: 0 });
    expect(fetcher).toHaveBeenCalledTimes(mode === "short-first" ? 1 : 2);
  });

  it("counts complete source coverage separately from unique accepted facility IDs", async () => {
    const f = await fixture();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const page = Number(new URL(String(input)).searchParams.get("pageNo"));
      const items = page === 1 ? Array.from({ length: 100 }, () => item("repeated-id")) : [item("last-id")];
      return new Response(JSON.stringify({ response: { body: { totalCount: 101, items } } }));
    });
    expect(await syncParkingDataBatch(f.db, { serviceKey: "synthetic", fetcher, now })).toMatchObject({
      status: "COMPLETED", fetched: 101, accepted: 2, skipped: 99,
    });
    expect((await active()).results).toMatchObject([{ row_count: 2 }]);
  });

  it.each([200, 503])("invalidates an in-flight %s response on cancellation without publishing", async (status) => {
    const f = await fixture(), before = (await active()).results;
    let started!: () => void, release!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => { started(); await paused; return status === 200 ? response("cancelled") : new Response("failed", { status }); });
    const running = syncParkingDataBatch(f.db, { serviceKey: "synthetic", fetcher, now });
    await began;
    const job = await f.db.query.parkingSyncRuns.findFirst();
    const preview = await prepareParkingJobAction(env.DB, { ...f.operator, runId: job!.id, action: "CANCEL", reason: "합성 수집 취소 검증" });
    const command = { ...f.operator, operationId: preview.operationId };
    expect(await commitParkingJobAction(env.DB, command)).toMatchObject({ status: "CANCELLED", completed: false });
    expect(await commitParkingJobAction(env.DB, command)).toMatchObject({ status: "CANCELLED", replayed: true });
    release();
    expect(await running).toMatchObject({ status: "CANCELLED" });
    expect((await active()).results).toEqual(before);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM parking_facilities").first()).toEqual({ n: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fences a stale response after exact-job recovery and a newer activation", async () => {
    const f = await fixture();
    let started!: () => void, release!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const old = syncParkingDataBatch(f.db, { serviceKey: "synthetic", now, fetcher: async () => { started(); await paused; return response("old-attempt"); } });
    await began;
    const job = await f.db.query.parkingSyncRuns.findFirst();
    await env.DB.prepare("UPDATE parking_sync_runs SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(job!.id).run();
    const preview = await prepareParkingJobAction(env.DB, { ...f.operator, runId: job!.id, action: "RECOVER", reason: "합성 정체 복구 검증" });
    expect(await commitParkingJobAction(env.DB, { ...f.operator, operationId: preview.operationId })).toMatchObject({ status: "PENDING", completed: false, job: { attempts: 2 } });
    expect(await syncParkingDataBatch(f.db, { serviceKey: "synthetic", runId: job!.id, now, fetcher: async () => response("new-attempt") })).toMatchObject({ status: "COMPLETED" });
    const before = (await active()).results;
    release();
    expect(await old).toMatchObject({ status: "COMPLETED", job: { attempts: 2 } });
    expect((await active()).results).toEqual(before);
    expect((await env.DB.prepare("SELECT source_management_no FROM parking_facilities ORDER BY source_management_no").all()).results).toEqual([{ source_management_no: "new-attempt" }]);
  });

  it("rejects incomplete EV data before activation and preserves ACTIVE snapshots", async () => {
    const f = await fixture();
    await env.DB.prepare("INSERT INTO parking_data_snapshots(id,source,status,row_count,created_at,updated_at) VALUES ('old-ev','EV','ACTIVE',1,?,?)").bind(now, now).run();
    const before = (await active()).results;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ totalCount: 2, items: { item: [] } })));
    await expect(syncEvDataSnapshot(f.db, { serviceKey: "synthetic", fetcher, now })).rejects.toThrow("EV_DATA_INCOMPLETE_29");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await active()).results).toEqual(before);
  });

  it("keeps continuation separate from retry attempts and blocks legacy leases and the retry ceiling", async () => {
    const f = await fixture();
    const first = await claimParkingJob(f.db, "PARKING", now);
    await checkpointParkingJob(f.db, first.lease!, now, { nextPage: 4, totalCount: 500, fetched: 300, accepted: 0, skipped: 300 });
    const next = await claimParkingJob(f.db, "PARKING", now, first.job.id);
    expect(next.job).toMatchObject({ attempts: 1, leaseVersion: 2, nextPage: 4 });
    expect(inspectParkingJob({ ...next.job, leaseExpiresAt: null }, now)).toMatchObject({ status: "UNKNOWN", allowedActions: [] });
    await env.DB.prepare("UPDATE parking_sync_runs SET status='FAILED',attempts=3,lease_expires_at=NULL WHERE id=?").bind(next.job.id).run();
    await expect(prepareParkingJobAction(env.DB, { ...f.operator, runId: next.job.id, action: "RETRY", reason: "합성 한도 초과 검증" })).rejects.toThrow("PARKING_JOB_ACTION_UNAVAILABLE");
  });

  it("drains an explicitly pending job despite a recently completed source run", async () => {
    const f = await fixture();
    const job = await claimParkingJob(f.db, "PARKING", now);
    await checkpointParkingJob(f.db, job.lease!, now, { nextPage: 1, totalCount: 1, fetched: 0, accepted: 0, skipped: 0 });
    for (const source of ["PARKING", "EV"]) {
      await env.DB.prepare("INSERT INTO parking_sync_runs(id,source,status,started_at,finished_at,created_at,updated_at) VALUES (?,?,'COMPLETED',?,?,?,?)")
        .bind(`recent-${source}`, source, now, now, now, now).run();
    }
    const fetcher = vi.fn(async () => response("explicit-pending"));
    const result = await runScheduledParkingSync({ ...env, DATA_GO_KR_SERVICE_KEY: "synthetic" }, { now: new Date(now), fetcher });
    expect(result).toMatchObject({ status: "RAN", result: { parking: { runId: job.job.id, status: "COMPLETED" }, ev: null } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("writes a large EV fixture in bounded batches instead of per-row subrequests", async () => {
    const f = await fixture();
    const claim = await claimParkingJob(f.db, "EV", now);
    const rows = Array.from({ length: 1_200 }, (_, index) => ({
      id: `${claim.lease!.snapshotId}:${index}`, snapshotId: claim.lease!.snapshotId, sourceStationId: String(index),
      name: "합성 충전소", latitude: 35.15, longitude: 126.85, referenceDate: "2026-11-01", rawPayload: "{}", createdAt: now, updatedAt: now,
    }));
    const batches = vi.spyOn(f.db.$client, "batch");
    const individualRuns = vi.spyOn(Object.getPrototypeOf(f.db.$client.prepare("SELECT 1")), "run");
    try {
      await insertParkingRows(f.db, evChargingStations, rows, claim.lease!);
      expect(batches).toHaveBeenCalledTimes(12);
      expect(batches.mock.calls.every(([statements]) => statements.length === 101)).toBe(true);
      expect(individualRuns).not.toHaveBeenCalled();
      expect(await env.DB.prepare("SELECT count(*) AS n FROM ev_charging_stations").first()).toEqual({ n: 1_200 });
      await expect(insertParkingRows(f.db, evChargingStations, [{ ...rows[0]!, id: "oversized", rawPayload: "x".repeat(900_000) }], claim.lease!))
        .rejects.toThrow("PARKING_ROW_TOO_LARGE");
      expect(batches).toHaveBeenCalledTimes(12);
    } finally { batches.mockRestore(); individualRuns.mockRestore(); }
  });

  it("stops fenced batch writes after another actor cancels between batches", async () => {
    const f = await fixture();
    const claim = await claimParkingJob(f.db, "EV", now);
    const rows = Array.from({ length: 120 }, (_, index) => ({
      id: `${claim.lease!.snapshotId}:${index}`, snapshotId: claim.lease!.snapshotId, sourceStationId: String(index),
      name: "합성 충전소", latitude: 35.15, longitude: 126.85, referenceDate: "2026-11-01", rawPayload: "{}", createdAt: now, updatedAt: now,
    }));
    const original = f.db.$client.batch.bind(f.db.$client);
    const batches = vi.spyOn(f.db.$client, "batch").mockImplementationOnce(async (statements) => {
      const result = await original(statements);
      await env.DB.prepare("UPDATE parking_sync_runs SET status='CANCELLED',lease_version=lease_version+1,lease_expires_at=NULL WHERE id=?").bind(claim.job.id).run();
      return result;
    });
    try {
      await expect(insertParkingRows(f.db, evChargingStations, rows, claim.lease!)).rejects.toThrow("PARKING_JOB_OWNERSHIP_LOST");
      expect(await env.DB.prepare("SELECT count(*) AS n FROM ev_charging_stations").first()).toEqual({ n: 100 });
      expect((await active()).results).toEqual([{ id: "old-parking", status: "ACTIVE", row_count: 1 }]);
    } finally { batches.mockRestore(); }
  });
});
