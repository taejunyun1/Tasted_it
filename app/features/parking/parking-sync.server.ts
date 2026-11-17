import { and, desc, eq, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { parkingDataSnapshots, parkingFacilities } from "../../db/schema";
import { buildParkingDataUrl, normalizeParkingItem, parseParkingResponse } from "./parking-data";
import { linkParkingSnapshotToEvSnapshot } from "./ev-sync.server";
import { activateParkingJob, assertParkingLease, checkpointParkingJob, claimParkingJob, failParkingJob, insertParkingRows, parkingJobResult } from "./parking-job.server";

export async function syncParkingDataBatch(db: AppDb, input: { serviceKey: string; fetcher?: typeof fetch; maxPages?: number; now?: string; runId?: string }) {
  if (!input.serviceKey.trim()) throw new Error("DATA_GO_KR_SERVICE_KEY_REQUIRED");
  const now = input.now ?? new Date().toISOString(), fetcher = input.fetcher ?? fetch;
  const { job, lease } = await claimParkingJob(db, "PARKING", now, input.runId);
  if (!lease) return parkingJobResult(db, job.id);
  let page = job.nextPage, totalCount = job.totalCount;
  let fetched = job.fetchedCount;
  try {
    for (let count = 0; count < Math.max(1, Math.min(input.maxPages ?? 3, 3)); count += 1) {
      await assertParkingLease(db, lease);
      const response = await fetcher(buildParkingDataUrl({ serviceKey: input.serviceKey, page, rows: 100 }), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`PARKING_DATA_HTTP_${response.status}`);
      const parsed = parseParkingResponse(await response.json());
      if (!Number.isSafeInteger(parsed.totalCount) || parsed.totalCount < 0 || parsed.items.length > 100) throw new Error("PARKING_DATA_INVALID_PAGE");
      // Freeze the source's declared count for the whole run. A short page or
      // moving total cannot prove that the snapshot covers the whole dataset.
      if (totalCount !== null && totalCount !== parsed.totalCount) throw new Error("PARKING_DATA_INCOMPLETE");
      totalCount = parsed.totalCount;
      const expectedRows = Math.min(100, Math.max(0, totalCount - (page - 1) * 100));
      if (parsed.items.length !== expectedRows) throw new Error("PARKING_DATA_INCOMPLETE");
      await assertParkingLease(db, lease);
      const rows = [];
      for (const raw of parsed.items) {
        fetched += 1;
        const item = normalizeParkingItem(raw, new Date(now));
        if (!item) continue;
        rows.push({ id: `${lease.snapshotId}:${item.sourceManagementNo}`, snapshotId: lease.snapshotId, ...item, createdAt: now, updatedAt: now });
      }
      await insertParkingRows(db, parkingFacilities, rows, lease, true);
      page += 1;
      if ((page - 1) * 100 >= totalCount) break;
    }
    const [{ count: accepted, min, max }] = await db.select({ count: sql<number>`count(*)`, min: sql<string | null>`min(${parkingFacilities.referenceDate})`, max: sql<string | null>`max(${parkingFacilities.referenceDate})` })
      .from(parkingFacilities).where(eq(parkingFacilities.snapshotId, lease.snapshotId));
    if (totalCount === null || accepted > fetched) throw new Error("PARKING_DATA_INCOMPLETE");
    // Accepted is the unique staged facility count, not the count of repeated
    // source IDs. Invalid and duplicate source rows are both excluded.
    const counts = { fetched, accepted, skipped: fetched - accepted, totalCount, nextPage: page };
    const completed = (page - 1) * 100 >= totalCount;
    if (completed) {
      if (fetched !== totalCount) throw new Error("PARKING_DATA_INCOMPLETE");
      const prior = await db.query.parkingDataSnapshots.findFirst({ where: and(eq(parkingDataSnapshots.source, "PARKING"), eq(parkingDataSnapshots.status, "ACTIVE")), orderBy: desc(parkingDataSnapshots.activatedAt) });
      if (prior && accepted < prior.rowCount * 0.7) throw new Error("PARKING_DATA_QUALITY_ROW_DROP");
      const activeEv = await db.query.parkingDataSnapshots.findFirst({ where: and(eq(parkingDataSnapshots.source, "EV"), eq(parkingDataSnapshots.status, "ACTIVE")), orderBy: desc(parkingDataSnapshots.activatedAt) });
      if (activeEv) await linkParkingSnapshotToEvSnapshot(db, { parkingSnapshotId: lease.snapshotId, evSnapshotId: activeEv.id, now, lease });
      await activateParkingJob(db, lease, now, counts, { min, max });
    } else await checkpointParkingJob(db, lease, now, counts);
    return parkingJobResult(db, job.id, true);
  } catch (error) {
    if (error instanceof Error && error.message === "PARKING_JOB_OWNERSHIP_LOST") return parkingJobResult(db, job.id, true);
    const message = error instanceof Error && /^PARKING_DATA_(HTTP_\d{3}|INVALID_PAGE|INCOMPLETE|QUALITY_ROW_DROP)$/.test(error.message) ? error.message : "PARKING_SYNC_FAILED";
    await failParkingJob(db, lease, now, message);
    const current = await parkingJobResult(db, job.id, true);
    if (current.status !== "FAILED" || current.job?.leaseVersion !== lease.version) return current;
    throw new Error(message);
  }
}
