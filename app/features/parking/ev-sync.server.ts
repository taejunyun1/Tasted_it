import { and, desc, eq } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { evChargingStations, parkingDataSnapshots, parkingEvLinks, parkingFacilities, parkingSyncRuns } from "../../db/schema";
import { buildEvDataUrl, classifyParkingEvLink, normalizeEvStations, parseEvResponse, type EvRegionCode } from "./ev-data";

const REGIONS: EvRegionCode[] = ["29", "46"];

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

export async function linkParkingSnapshotToEvSnapshot(db: AppDb, input: { parkingSnapshotId: string; evSnapshotId: string; now: string }) {
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
  for (const group of chunks(links, 100)) await db.insert(parkingEvLinks).values(group).onConflictDoNothing();
  return { linked: links.length };
}

export async function syncEvDataSnapshot(db: AppDb, input: { serviceKey: string; fetcher?: typeof fetch; now?: string }) {
  if (!input.serviceKey.trim()) throw new Error("DATA_GO_KR_SERVICE_KEY_REQUIRED");
  const now = input.now ?? new Date().toISOString();
  const fetcher = input.fetcher ?? fetch;
  const existing = await db.query.parkingSyncRuns.findFirst({
    where: and(eq(parkingSyncRuns.source, "EV"), eq(parkingSyncRuns.status, "RUNNING")),
    orderBy: desc(parkingSyncRuns.startedAt),
  });
  const runId = existing?.id ?? crypto.randomUUID();
  const snapshotId = existing?.snapshotId ?? crypto.randomUUID();

  if (!existing) await db.batch([
    db.insert(parkingDataSnapshots).values({ id: snapshotId, source: "EV", status: "STAGING", rowCount: 0, createdAt: now, updatedAt: now }),
    db.insert(parkingSyncRuns).values({ id: runId, source: "EV", status: "RUNNING", snapshotId, nextPage: 1, startedAt: now, createdAt: now, updatedAt: now }),
  ]);

  try {
    const responses = await Promise.all(REGIONS.map(async (regionCode) => {
      const response = await fetcher(buildEvDataUrl({ serviceKey: input.serviceKey, regionCode }), { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`EV_DATA_HTTP_${response.status}`);
      const parsed = parseEvResponse(await response.json());
      if (parsed.totalCount > parsed.items.length) throw new Error(`EV_DATA_INCOMPLETE_${regionCode}`);
      return parsed;
    }));
    const rawItems = responses.flatMap((response) => response.items);
    const stations = normalizeEvStations(rawItems).filter((station) => !station.isDeleted);
    const prior = await db.query.parkingDataSnapshots.findFirst({ where: and(eq(parkingDataSnapshots.source, "EV"), eq(parkingDataSnapshots.status, "ACTIVE")), orderBy: desc(parkingDataSnapshots.activatedAt) });
    if (prior && stations.length < prior.rowCount * 0.7) throw new Error("EV_DATA_QUALITY_ROW_DROP");

    await db.delete(evChargingStations).where(eq(evChargingStations.snapshotId, snapshotId));
    const stationRows = stations.map((station) => ({ id: `${snapshotId}:${station.sourceStationId}`, snapshotId, ...station, createdAt: now, updatedAt: now }));
    for (const group of chunks(stationRows, 50)) await db.insert(evChargingStations).values(group);

    const activeParking = await db.query.parkingDataSnapshots.findFirst({ where: and(eq(parkingDataSnapshots.source, "PARKING"), eq(parkingDataSnapshots.status, "ACTIVE")), orderBy: desc(parkingDataSnapshots.activatedAt) });
    const links = activeParking ? await linkParkingSnapshotToEvSnapshot(db, { parkingSnapshotId: activeParking.id, evSnapshotId: snapshotId, now }) : { linked: 0 };

    const dates = stations.map((station) => station.referenceDate).sort();
    await db.batch([
      db.update(parkingDataSnapshots).set({ status: "RETIRED", updatedAt: now }).where(and(eq(parkingDataSnapshots.source, "EV"), eq(parkingDataSnapshots.status, "ACTIVE"))),
      db.update(parkingDataSnapshots).set({ status: "ACTIVE", rowCount: stations.length, sourceReferenceDateMin: dates.at(0) ?? null, sourceReferenceDateMax: dates.at(-1) ?? null, activatedAt: now, updatedAt: now }).where(eq(parkingDataSnapshots.id, snapshotId)),
      db.update(parkingSyncRuns).set({ status: "COMPLETED", nextPage: 2, totalCount: responses.reduce((sum, response) => sum + response.totalCount, 0), fetchedCount: rawItems.length, acceptedCount: stations.length, skippedCount: rawItems.length - stations.length, finishedAt: now, updatedAt: now }).where(eq(parkingSyncRuns.id, runId)),
    ]);
    return { runId, snapshotId, completed: true, fetched: rawItems.length, accepted: stations.length, skipped: rawItems.length - stations.length, linked: links.linked };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    await db.batch([
      db.update(parkingSyncRuns).set({ status: "FAILED", errorSummary: message, finishedAt: now, updatedAt: now }).where(eq(parkingSyncRuns.id, runId)),
      db.update(parkingDataSnapshots).set({ status: "FAILED", updatedAt: now }).where(eq(parkingDataSnapshots.id, snapshotId)),
    ]);
    throw error;
  }
}
