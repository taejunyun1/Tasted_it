import { and, desc, eq, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { parkingDataSnapshots, parkingFacilities, parkingSyncRuns } from "../../db/schema";
import { buildParkingDataUrl, normalizeParkingItem, parseParkingResponse } from "./parking-data";
import { linkParkingSnapshotToEvSnapshot } from "./ev-sync.server";

export async function syncParkingDataBatch(db: AppDb, input: { serviceKey: string; fetcher?: typeof fetch; maxPages?: number; now?: string }) {
  if (!input.serviceKey.trim()) throw new Error("DATA_GO_KR_SERVICE_KEY_REQUIRED");
  const now = input.now ?? new Date().toISOString();
  const nowDate = new Date(now);
  const fetcher = input.fetcher ?? fetch;
  const existing = await db.query.parkingSyncRuns.findFirst({ where: and(eq(parkingSyncRuns.source, "PARKING"), eq(parkingSyncRuns.status, "RUNNING")), orderBy: desc(parkingSyncRuns.startedAt) });
  const runId = existing?.id ?? crypto.randomUUID();
  const snapshotId = existing?.snapshotId ?? crypto.randomUUID();
  let page = existing?.nextPage ?? 1;
  let totalCount = existing?.totalCount ?? 0;
  let fetched = 0;
  let accepted = 0;
  let skipped = 0;
  if (!existing) await db.batch([
    db.insert(parkingDataSnapshots).values({ id: snapshotId, source: "PARKING", status: "STAGING", rowCount: 0, createdAt: now, updatedAt: now }),
    db.insert(parkingSyncRuns).values({ id: runId, source: "PARKING", status: "RUNNING", snapshotId, nextPage: 1, startedAt: now, createdAt: now, updatedAt: now }),
  ]);
  try {
    for (let count = 0; count < (input.maxPages ?? 3); count += 1) {
      const response = await fetcher(buildParkingDataUrl({ serviceKey: input.serviceKey, page, rows: 100 }), { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`PARKING_DATA_HTTP_${response.status}`);
      const parsed = parseParkingResponse(await response.json());
      totalCount = parsed.totalCount;
      for (const raw of parsed.items) {
        fetched += 1;
        const item = normalizeParkingItem(raw, nowDate);
        if (!item) { skipped += 1; continue; }
        accepted += 1;
        await db.insert(parkingFacilities).values({ id: `${snapshotId}:${item.sourceManagementNo}`, snapshotId, ...item, createdAt: now, updatedAt: now }).onConflictDoUpdate({
          target: [parkingFacilities.snapshotId, parkingFacilities.sourceManagementNo],
          set: { ...item, updatedAt: now },
        });
      }
      page += 1;
      if ((page - 1) * 100 >= totalCount || parsed.items.length === 0) break;
    }
    const completed = totalCount === 0 || (page - 1) * 100 >= totalCount;
    const totals = { fetched: (existing?.fetchedCount ?? 0) + fetched, accepted: (existing?.acceptedCount ?? 0) + accepted, skipped: (existing?.skippedCount ?? 0) + skipped };
    if (completed) {
      const prior = await db.query.parkingDataSnapshots.findFirst({ where: and(eq(parkingDataSnapshots.source, "PARKING"), eq(parkingDataSnapshots.status, "ACTIVE")), orderBy: desc(parkingDataSnapshots.activatedAt) });
      if (prior && totals.accepted < prior.rowCount * 0.7) throw new Error("PARKING_DATA_QUALITY_ROW_DROP");
      const dates = await db.select({ min: sql<string | null>`min(${parkingFacilities.referenceDate})`, max: sql<string | null>`max(${parkingFacilities.referenceDate})` }).from(parkingFacilities).where(eq(parkingFacilities.snapshotId, snapshotId));
      await db.batch([
        db.update(parkingDataSnapshots).set({ status: "RETIRED", updatedAt: now }).where(and(eq(parkingDataSnapshots.source, "PARKING"), eq(parkingDataSnapshots.status, "ACTIVE"))),
        db.update(parkingDataSnapshots).set({ status: "ACTIVE", rowCount: totals.accepted, sourceReferenceDateMin: dates[0]?.min ?? null, sourceReferenceDateMax: dates[0]?.max ?? null, activatedAt: now, updatedAt: now }).where(eq(parkingDataSnapshots.id, snapshotId)),
        db.update(parkingSyncRuns).set({ status: "COMPLETED", nextPage: page, totalCount, fetchedCount: totals.fetched, acceptedCount: totals.accepted, skippedCount: totals.skipped, finishedAt: now, updatedAt: now }).where(eq(parkingSyncRuns.id, runId)),
      ]);
      const activeEv = await db.query.parkingDataSnapshots.findFirst({ where: and(eq(parkingDataSnapshots.source, "EV"), eq(parkingDataSnapshots.status, "ACTIVE")), orderBy: desc(parkingDataSnapshots.activatedAt) });
      if (activeEv) await linkParkingSnapshotToEvSnapshot(db, { parkingSnapshotId: snapshotId, evSnapshotId: activeEv.id, now });
    } else await db.update(parkingSyncRuns).set({ nextPage: page, totalCount, fetchedCount: totals.fetched, acceptedCount: totals.accepted, skippedCount: totals.skipped, updatedAt: now }).where(eq(parkingSyncRuns.id, runId));
    return { runId, snapshotId, completed, nextPage: page, ...totals };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    await db.batch([
      db.update(parkingSyncRuns).set({ status: "FAILED", errorSummary: message, finishedAt: now, updatedAt: now }).where(eq(parkingSyncRuns.id, runId)),
      db.update(parkingDataSnapshots).set({ status: "FAILED", updatedAt: now }).where(eq(parkingDataSnapshots.id, snapshotId)),
    ]);
    throw error;
  }
}
