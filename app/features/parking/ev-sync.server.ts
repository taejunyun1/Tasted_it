import { and, desc, eq } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { evChargingStations, parkingDataSnapshots, parkingEvLinks, parkingFacilities, parkingSyncRuns } from "../../db/schema";
import { evZcodesForActivePacks } from "../regions/region-pack";
import { activateParkingJob, assertParkingLease, claimParkingJob, failParkingJob, insertParkingRows, parkingJobResult, parkingOwnership, leaseValues, type ParkingLease } from "./parking-job.server";
import { buildEvDataUrl, classifyParkingEvLink, normalizeEvStations, parseEvResponse, type EvRegionCode } from "./ev-data";

const REGIONS: EvRegionCode[] = evZcodesForActivePacks();

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function gridKey(latitude: number, longitude: number) {
  return `${Math.floor(latitude / 0.003)}:${Math.floor(longitude / 0.003)}`;
}

function nearbyParking<T extends { latitude: number; longitude: number }>(grid: Map<string, T[]>, latitude: number, longitude: number) {
  const lat = Math.floor(latitude / 0.003);
  const lng = Math.floor(longitude / 0.003);
  const result: T[] = [];
  for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) result.push(...(grid.get(`${lat + y}:${lng + x}`) ?? []));
  return result;
}

export async function linkParkingSnapshotToEvSnapshot(db: AppDb, input: { parkingSnapshotId: string; evSnapshotId: string; now: string; lease?: ParkingLease }) {
  const parking = await db.select({
    id: parkingFacilities.id, name: parkingFacilities.name, roadAddress: parkingFacilities.roadAddress, lotAddress: parkingFacilities.lotAddress,
    latitude: parkingFacilities.latitude, longitude: parkingFacilities.longitude,
  }).from(parkingFacilities).where(eq(parkingFacilities.snapshotId, input.parkingSnapshotId));
  const stations = await db.select({
    id: evChargingStations.id, name: evChargingStations.name, address: evChargingStations.address,
    latitude: evChargingStations.latitude, longitude: evChargingStations.longitude,
  }).from(evChargingStations).where(and(eq(evChargingStations.snapshotId, input.evSnapshotId), eq(evChargingStations.isDeleted, false)));
  const grid = new Map<string, typeof parking>();
  for (const facility of parking) {
    const key = gridKey(facility.latitude, facility.longitude);
    grid.set(key, [...(grid.get(key) ?? []), facility]);
  }
  const links = stations.flatMap((station) => nearbyParking(grid, station.latitude, station.longitude).flatMap((facility) => {
    const match = classifyParkingEvLink(facility, station);
    return match ? [{ parkingFacilityId: facility.id, evStationId: station.id, relationship: match.relationship, matchMethod: match.matchMethod, confidence: match.confidence, createdAt: input.now }] : [];
  }));
  for (const group of chunks(links, 100)) {
    if (input.lease) await insertParkingRows(db, parkingEvLinks, group, input.lease);
    else await db.insert(parkingEvLinks).values(group).onConflictDoNothing();
  }
  return { linked: links.length };
}

export async function syncEvDataSnapshot(db: AppDb, input: { serviceKey: string; fetcher?: typeof fetch; now?: string; runId?: string }) {
  if (!input.serviceKey.trim()) throw new Error("DATA_GO_KR_SERVICE_KEY_REQUIRED");
  const now = input.now ?? new Date().toISOString(), fetcher = input.fetcher ?? fetch;
  const { job, lease } = await claimParkingJob(db, "EV", now, input.runId);
  if (!lease) return { ...await parkingJobResult(db, job.id), linked: 0 };
  try {
    const responses = [];
    // Sequential requests give cancellation a boundary before each fixed region.
    for (const regionCode of REGIONS) {
      await assertParkingLease(db, lease);
      const response = await fetcher(buildEvDataUrl({ serviceKey: input.serviceKey, regionCode }), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`EV_DATA_HTTP_${response.status}`);
      const parsed = parseEvResponse(await response.json());
      if (!Number.isSafeInteger(parsed.totalCount) || parsed.totalCount < 0 || parsed.items.length > 9_999) throw new Error("EV_DATA_INVALID_PAGE");
      if (parsed.totalCount > parsed.items.length) throw new Error(`EV_DATA_INCOMPLETE_${regionCode}`);
      responses.push(parsed);
    }
    await assertParkingLease(db, lease);
    const rawItems = responses.flatMap((response) => response.items);
    const stations = normalizeEvStations(rawItems).filter((station) => !station.isDeleted);
    const prior = await db.query.parkingDataSnapshots.findFirst({ where: and(eq(parkingDataSnapshots.source, "EV"), eq(parkingDataSnapshots.status, "ACTIVE")), orderBy: desc(parkingDataSnapshots.activatedAt) });
    if (prior && stations.length < prior.rowCount * 0.7) throw new Error("EV_DATA_QUALITY_ROW_DROP");
    await db.$client.prepare(`DELETE FROM ev_charging_stations WHERE snapshot_id=? AND ${parkingOwnership}`).bind(lease.snapshotId, ...leaseValues(lease)).run();
    await insertParkingRows(db, evChargingStations, stations.map((station) => ({ id: `${lease.snapshotId}:${station.sourceStationId}`, snapshotId: lease.snapshotId, ...station, createdAt: now, updatedAt: now })), lease);
    const activeParking = await db.query.parkingDataSnapshots.findFirst({ where: and(eq(parkingDataSnapshots.source, "PARKING"), eq(parkingDataSnapshots.status, "ACTIVE")), orderBy: desc(parkingDataSnapshots.activatedAt) });
    const links = activeParking ? await linkParkingSnapshotToEvSnapshot(db, { parkingSnapshotId: activeParking.id, evSnapshotId: lease.snapshotId, now, lease }) : { linked: 0 };
    const dates = stations.map((station) => station.referenceDate).sort();
    await activateParkingJob(db, lease, now, { nextPage: 2, totalCount: responses.reduce((sum, response) => sum + response.totalCount, 0), fetched: rawItems.length, accepted: stations.length, skipped: rawItems.length - stations.length }, { min: dates.at(0) ?? null, max: dates.at(-1) ?? null });
    return { ...await parkingJobResult(db, job.id, true), linked: links.linked };
  } catch (error) {
    if (error instanceof Error && error.message === "PARKING_JOB_OWNERSHIP_LOST") return { ...await parkingJobResult(db, job.id, true), linked: 0 };
    const message = error instanceof Error && /^EV_DATA_(HTTP_\d{3}|INVALID_PAGE|QUALITY_ROW_DROP|INCOMPLETE_(29|46))$/.test(error.message) ? error.message : "EV_SYNC_FAILED";
    await failParkingJob(db, lease, now, message);
    const current = await parkingJobResult(db, job.id, true);
    if (current.status !== "FAILED" || current.job?.leaseVersion !== lease.version) return { ...current, linked: 0 };
    throw new Error(message);
  }
}
