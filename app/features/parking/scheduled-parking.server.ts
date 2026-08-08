import { and, desc, eq } from "drizzle-orm";
import { createDb } from "../../db/client.server";
import { parkingSyncRuns } from "../../db/schema";
import { syncEvDataSnapshot } from "./ev-sync.server";
import { syncParkingDataBatch } from "./parking-sync.server";

export function isParkingSyncDue(lastCompletedAt: string | null, now = new Date()) {
  if (!lastCompletedAt) return true;
  const completed = new Date(lastCompletedAt);
  return Number.isNaN(completed.getTime()) || now.getTime() - completed.getTime() >= 90 * 86_400_000;
}

export async function runScheduledParkingSync(env: Env & { DATA_GO_KR_SERVICE_KEY?: string }, options?: { now?: Date; fetcher?: typeof fetch }) {
  if (!env.DATA_GO_KR_SERVICE_KEY) return { status: "SKIPPED_NO_KEY" as const };
  const db = createDb(env.DB);
  const now = options?.now ?? new Date();
  const [runningParking, latestParking, runningEv, latestEv] = await Promise.all([
    db.query.parkingSyncRuns.findFirst({ where: and(eq(parkingSyncRuns.source, "PARKING"), eq(parkingSyncRuns.status, "RUNNING")), orderBy: desc(parkingSyncRuns.startedAt) }),
    db.query.parkingSyncRuns.findFirst({ where: and(eq(parkingSyncRuns.source, "PARKING"), eq(parkingSyncRuns.status, "COMPLETED")), orderBy: desc(parkingSyncRuns.finishedAt) }),
    db.query.parkingSyncRuns.findFirst({ where: and(eq(parkingSyncRuns.source, "EV"), eq(parkingSyncRuns.status, "RUNNING")), orderBy: desc(parkingSyncRuns.startedAt) }),
    db.query.parkingSyncRuns.findFirst({ where: and(eq(parkingSyncRuns.source, "EV"), eq(parkingSyncRuns.status, "COMPLETED")), orderBy: desc(parkingSyncRuns.finishedAt) }),
  ]);
  const parkingDue = Boolean(runningParking) || isParkingSyncDue(latestParking?.finishedAt ?? null, now);
  const evDue = Boolean(runningEv) || isParkingSyncDue(latestEv?.finishedAt ?? null, now);
  if (!parkingDue && !evDue) return { status: "SKIPPED_NOT_DUE" as const };
  const parking = parkingDue ? await syncParkingDataBatch(db, { serviceKey: env.DATA_GO_KR_SERVICE_KEY, fetcher: options?.fetcher, maxPages: 3, now: now.toISOString() }) : null;
  const ev = evDue ? await syncEvDataSnapshot(db, { serviceKey: env.DATA_GO_KR_SERVICE_KEY, fetcher: options?.fetcher, now: now.toISOString() }) : null;
  return { status: "RAN" as const, result: { parking, ev } };
}
