import type { AppDb } from "../../db/client.server";
import { estimateWalkingMeters } from "./parking-distance";
import { calculateEstimatedFee } from "./parking-fee";
import { isParkingOpenForWindow } from "./parking-hours";
import { getActiveParkingSnapshot, listEligibleParking } from "./parking-repository.server";
import { compareParkingModes, rankSeparateParking, rankSharedParking, type ParkingWeather } from "./parking-score";
import type { Coordinate, EvRequirement, ParkingFacilityCandidate } from "./parking-types";

export interface ParkingCourseInput {
  first: Coordinate & { id: string };
  second: Coordinate & { id: string };
  startsAt: string;
  firstStayMinutes: number;
  secondStayMinutes: number;
  weather: ParkingWeather;
  childAccompanied: boolean;
  evRequirement: EvRequirement;
  parkingMode: "auto" | "shared" | "separate";
}

function bounds(first: Coordinate, second: Coordinate) {
  const margin = 0.035;
  return {
    west: Math.min(first.longitude, second.longitude) - margin,
    east: Math.max(first.longitude, second.longitude) + margin,
    south: Math.min(first.latitude, second.latitude) - margin,
    north: Math.max(first.latitude, second.latitude) + margin,
  };
}

type RepositoryParking = Awaited<ReturnType<typeof listEligibleParking>>[number];

function schedule(row: RepositoryParking) {
  const hours = (opensAt: string | null, closesAt: string | null) => opensAt && closesAt ? { opensAt, closesAt } : null;
  return {
    weekday: hours(row.weekdayOpen, row.weekdayClose),
    saturday: hours(row.saturdayOpen, row.saturdayClose),
    holiday: hours(row.holidayOpen, row.holidayClose),
  };
}

function candidate(row: RepositoryParking, stayMinutes: number): ParkingFacilityCandidate {
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    isPublic: row.ownershipType === "PUBLIC" || row.ownershipType === "STORE_FREE",
    capacity: row.capacity,
    fee: calculateEstimatedFee({
      status: row.feeStatus,
      baseMinutes: row.baseMinutes,
      baseFee: row.baseFee,
      additionalMinutes: row.additionalMinutes,
      additionalFee: row.additionalFee,
      dailyMaxFee: row.dailyMaxFee,
    }, stayMinutes),
    hasOnsiteEv: Boolean(row.hasOnsiteEv),
    reliabilityGrade: row.reliabilityGrade as "A" | "B",
    referenceDate: row.referenceDate,
  };
}

export async function recommendParkingForCourse(db: AppDb, input: ParkingCourseInput) {
  const [snapshot, evSnapshot] = await Promise.all([getActiveParkingSnapshot(db, "PARKING"), getActiveParkingSnapshot(db, "EV")]);
  const base = {
    algorithmVersion: "parking-course-v1" as const,
    snapshot: snapshot ? { id: snapshot.id, referenceDate: snapshot.sourceReferenceDateMax } : null,
    evSnapshot: evSnapshot ? { id: evSnapshot.id, referenceDate: evSnapshot.sourceReferenceDateMax } : null,
  };
  if (!snapshot) return { ...base, status: "PARKING_DATA_UNAVAILABLE" as const, shared: null, separate: null, recommendedMode: null, warnings: ["주차 데이터가 아직 준비되지 않았습니다."] };

  const rows = await listEligibleParking(db, bounds(input.first, input.second));
  const startsAt = new Date(input.startsAt);
  const betweenMeters = estimateWalkingMeters(input.first, input.second);
  const baseMinutes = input.firstStayMinutes + input.secondStayMinutes + Math.ceil(betweenMeters / 80);
  const endsAt = new Date(startsAt.getTime() + (baseMinutes + 60) * 60_000);
  const openRows = rows.filter((row) => isParkingOpenForWindow(schedule(row), startsAt, endsAt, 30));
  const sharedCandidates = openRows.map((row) => ({
    ...candidate(row, baseMinutes),
    firstMeters: estimateWalkingMeters(row, input.first),
    secondMeters: estimateWalkingMeters(row, input.second),
  }));
  const shared = rankSharedParking({ candidates: sharedCandidates, evRequirement: input.evRequirement, weather: input.weather, childAccompanied: input.childAccompanied })[0] ?? null;
  const firstCandidates = openRows.map((row) => ({ ...candidate(row, input.firstStayMinutes), placeMeters: estimateWalkingMeters(row, input.first) }));
  const secondCandidates = openRows.map((row) => ({ ...candidate(row, input.secondStayMinutes), placeMeters: estimateWalkingMeters(row, input.second) }));
  const separate = rankSeparateParking({ firstCandidates, secondCandidates, evRequirement: input.evRequirement, weather: input.weather, childAccompanied: input.childAccompanied })[0] ?? null;
  if (!shared && !separate) return { ...base, status: "NO_ELIGIBLE_PARKING" as const, shared: null, separate: null, recommendedMode: null, warnings: ["조건에 맞는 주차장을 찾지 못했습니다."] };

  const sharedResult = shared ? {
    parking: shared,
    totalWalkingMeters: shared.totalWalkingMeters,
    totalFee: shared.fee,
    totalMinutes: baseMinutes + Math.ceil(shared.totalWalkingMeters / 80),
    warnings: [...shared.warnings, ...(shared.fee == null ? ["FEE_UNKNOWN"] : []), ...(shared.capacity == null ? ["CAPACITY_UNKNOWN"] : [])],
  } : null;
  const separateResult = separate ? {
    ...separate,
    totalMinutes: baseMinutes + Math.ceil(separate.totalWalkingMeters / 80) + separate.parkingOverheadMinutes,
    warnings: separate.totalFee == null ? ["FEE_UNKNOWN"] : [],
  } : null;
  let recommendedMode: "SHARED" | "SEPARATE" | "BOTH_SIMILAR" | null = sharedResult ? "SHARED" : separateResult ? "SEPARATE" : null;
  let modeScores: ReturnType<typeof compareParkingModes> | null = null;
  if (sharedResult && separateResult) {
    modeScores = compareParkingModes(
      { mode: "SHARED", totalWalkingMeters: sharedResult.totalWalkingMeters, totalMinutes: sharedResult.totalMinutes, totalFee: sharedResult.totalFee, parkingOverheadMinutes: 0 },
      { mode: "SEPARATE", totalWalkingMeters: separateResult.totalWalkingMeters, totalMinutes: separateResult.totalMinutes, totalFee: separateResult.totalFee, parkingOverheadMinutes: 7 },
      { weather: input.weather, childAccompanied: input.childAccompanied, totalStayMinutes: input.firstStayMinutes + input.secondStayMinutes },
    );
    recommendedMode = modeScores.recommendedMode;
  }
  if (input.parkingMode === "shared" && sharedResult) recommendedMode = "SHARED";
  if (input.parkingMode === "separate" && separateResult) recommendedMode = "SEPARATE";
  return { ...base, status: "READY" as const, shared: sharedResult, separate: separateResult, recommendedMode, modeScores, warnings: [] as string[] };
}
