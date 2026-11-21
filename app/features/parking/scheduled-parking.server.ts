import { createDb } from "../../db/client.server";
import { syncEvDataSnapshot } from "./ev-sync.server";
import { findParkingSourceJob, isParkingSourceDue } from "./parking-job.server";
import { syncParkingDataBatch } from "./parking-sync.server";

export { isParkingSyncDue } from "./parking-job.server";

export async function runScheduledParkingSync(env: Env & { DATA_GO_KR_SERVICE_KEY?: string }, options?: { now?: Date; fetcher?: typeof fetch }) {
  if (!env.DATA_GO_KR_SERVICE_KEY) return { status: "SKIPPED_NO_KEY" as const };
  const db = createDb(env.DB);
  const now = options?.now ?? new Date();
  const [parkingJob, evJob] = await Promise.all([
    findParkingSourceJob(db, "PARKING"),
    findParkingSourceJob(db, "EV"),
  ]);
  const parkingDue = isParkingSourceDue(parkingJob, now);
  const evDue = isParkingSourceDue(evJob, now);
  if (!parkingDue && !evDue) return { status: "SKIPPED_NOT_DUE" as const };
  const parking = parkingDue ? await syncParkingDataBatch(db, { serviceKey: env.DATA_GO_KR_SERVICE_KEY, fetcher: options?.fetcher, maxPages: 3, now: now.toISOString() }) : null;
  const ev = evDue ? await syncEvDataSnapshot(db, { serviceKey: env.DATA_GO_KR_SERVICE_KEY, fetcher: options?.fetcher, now: now.toISOString() }) : null;
  return { status: "RAN" as const, result: { parking, ev } };
}
