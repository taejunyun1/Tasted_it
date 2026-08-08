import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { AppDb } from "../../db/client.server";
import { evChargingStations, parkingDataSnapshots, parkingEvLinks, parkingFacilities } from "../../db/schema";

export async function getActiveParkingSnapshot(db: AppDb, source: "PARKING" | "EV" = "PARKING") {
  const [snapshot] = await db.select().from(parkingDataSnapshots)
    .where(and(eq(parkingDataSnapshots.source, source), eq(parkingDataSnapshots.status, "ACTIVE")))
    .orderBy(desc(parkingDataSnapshots.activatedAt), desc(parkingDataSnapshots.createdAt))
    .limit(1);
  return snapshot ?? null;
}

export async function listEligibleParking(db: AppDb, bounds: { west: number; south: number; east: number; north: number }) {
  const evSnapshots = alias(parkingDataSnapshots, "active_ev_snapshots");
  const rows = await db.select({
    id: parkingFacilities.id,
    snapshotId: parkingFacilities.snapshotId,
    name: parkingFacilities.name,
    latitude: parkingFacilities.latitude,
    longitude: parkingFacilities.longitude,
    ownershipType: parkingFacilities.ownershipType,
    capacity: parkingFacilities.capacity,
    feeStatus: parkingFacilities.feeStatus,
    baseMinutes: parkingFacilities.baseMinutes,
    baseFee: parkingFacilities.baseFee,
    additionalMinutes: parkingFacilities.additionalMinutes,
    additionalFee: parkingFacilities.additionalFee,
    dailyMaxFee: parkingFacilities.dailyMaxFee,
    weekdayOpen: parkingFacilities.weekdayOpen,
    weekdayClose: parkingFacilities.weekdayClose,
    saturdayOpen: parkingFacilities.saturdayOpen,
    saturdayClose: parkingFacilities.saturdayClose,
    holidayOpen: parkingFacilities.holidayOpen,
    holidayClose: parkingFacilities.holidayClose,
    publicAccessStatus: parkingFacilities.publicAccessStatus,
    reliabilityGrade: parkingFacilities.reliabilityGrade,
    referenceDate: parkingFacilities.referenceDate,
    hasOnsiteEv: sql<boolean>`max(case when ${parkingEvLinks.relationship} = 'ONSITE_CONFIRMED' and ${evSnapshots.id} is not null then 1 else 0 end)`,
  }).from(parkingFacilities)
    .innerJoin(parkingDataSnapshots, eq(parkingDataSnapshots.id, parkingFacilities.snapshotId))
    .leftJoin(parkingEvLinks, eq(parkingEvLinks.parkingFacilityId, parkingFacilities.id))
    .leftJoin(evChargingStations, eq(evChargingStations.id, parkingEvLinks.evStationId))
    .leftJoin(evSnapshots, and(eq(evSnapshots.id, evChargingStations.snapshotId), eq(evSnapshots.source, "EV"), eq(evSnapshots.status, "ACTIVE")))
    .where(and(
      eq(parkingDataSnapshots.status, "ACTIVE"),
      eq(parkingDataSnapshots.source, "PARKING"),
      inArray(parkingFacilities.reliabilityGrade, ["A", "B"]),
      eq(parkingFacilities.publicAccessStatus, "PUBLIC"),
      gte(parkingFacilities.longitude, bounds.west), lte(parkingFacilities.longitude, bounds.east),
      gte(parkingFacilities.latitude, bounds.south), lte(parkingFacilities.latitude, bounds.north),
    )).groupBy(parkingFacilities.id).orderBy(parkingFacilities.id);
  return rows.map((row) => ({ ...row, hasOnsiteEv: Boolean(row.hasOnsiteEv) }));
}
