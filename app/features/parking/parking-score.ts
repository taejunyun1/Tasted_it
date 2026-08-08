import { distanceBurden, isSameDistanceCohort } from "./parking-distance";
import type { EvRequirement, ParkingFacilityCandidate } from "./parking-types";

export type ParkingWeather = "NORMAL" | "RAIN";

export interface SharedParkingCandidate extends ParkingFacilityCandidate {
  firstMeters: number;
  secondMeters: number;
}

export interface RankedSharedParking extends SharedParkingCandidate {
  distanceBurden: number;
  totalWalkingMeters: number;
  warnings: string[];
}

export interface SeparateParkingCandidate extends ParkingFacilityCandidate {
  placeMeters: number;
}

export interface SeparateParkingPlan {
  mode: "SEPARATE";
  first: SeparateParkingCandidate;
  second: SeparateParkingCandidate;
  totalWalkingMeters: number;
  totalFee: number | null;
  parkingOverheadMinutes: 7;
}

function capacityScore(value: number | null) {
  return value == null ? -1 : Math.log1p(Math.min(value, 300));
}

function compareAuxiliary<T extends ParkingFacilityCandidate>(left: T, right: T, ev: EvRequirement) {
  if (left.isPublic !== right.isPublic) return left.isPublic ? -1 : 1;
  const leftCapacity = capacityScore(left.capacity);
  const rightCapacity = capacityScore(right.capacity);
  if (leftCapacity !== rightCapacity) return rightCapacity - leftCapacity;
  if (ev === "PREFERRED" && left.hasOnsiteEv !== right.hasOnsiteEv) return left.hasOnsiteEv ? -1 : 1;
  const leftFee = left.fee ?? Number.POSITIVE_INFINITY;
  const rightFee = right.fee ?? Number.POSITIVE_INFINITY;
  if (leftFee !== rightFee) return leftFee - rightFee;
  const leftMargin = left.closingMarginMinutes ?? -1;
  const rightMargin = right.closingMarginMinutes ?? -1;
  if (leftMargin !== rightMargin) return rightMargin - leftMargin;
  return right.referenceDate.localeCompare(left.referenceDate);
}

export function rankSharedParking(input: {
  candidates: SharedParkingCandidate[];
  evRequirement: EvRequirement;
  weather: ParkingWeather;
  childAccompanied: boolean;
}) {
  const strictLimit = input.weather === "RAIN" || input.childAccompanied ? 500 : 800;
  const eligibleByEv = input.candidates.filter((candidate) => input.evRequirement !== "REQUIRED" || candidate.hasOnsiteEv);
  const strict = eligibleByEv.filter((candidate) => Math.max(candidate.firstMeters, candidate.secondMeters) <= strictLimit);
  const pool = strict.length
    ? strict
    : eligibleByEv.filter((candidate) => Math.max(candidate.firstMeters, candidate.secondMeters) <= 1_200);
  const evaluated: RankedSharedParking[] = pool.map((candidate) => ({
    ...candidate,
    distanceBurden: distanceBurden(candidate.firstMeters, candidate.secondMeters),
    totalWalkingMeters: candidate.firstMeters + candidate.secondMeters,
    warnings: strict.length ? [] : ["LONG_WALKING_DISTANCE"],
  }));
  evaluated.sort((left, right) => left.distanceBurden - right.distanceBurden || left.id.localeCompare(right.id));
  const best = evaluated[0];
  if (!best) return evaluated;
  const cohort = evaluated.filter((candidate) => isSameDistanceCohort(
    { first: best.firstMeters, second: best.secondMeters },
    { first: candidate.firstMeters, second: candidate.secondMeters },
  ));
  const outside = evaluated.filter((candidate) => !cohort.includes(candidate));
  cohort.sort((left, right) => compareAuxiliary(left, right, input.evRequirement)
    || left.distanceBurden - right.distanceBurden
    || left.id.localeCompare(right.id));
  return [...cohort, ...outside];
}

function rankPlaceCandidates(candidates: SeparateParkingCandidate[], ev: EvRequirement) {
  const eligible = candidates
    .filter((candidate) => ev !== "REQUIRED" || candidate.hasOnsiteEv)
    .filter((candidate) => candidate.placeMeters <= 800)
    .sort((left, right) => left.placeMeters - right.placeMeters || left.id.localeCompare(right.id));
  const best = eligible[0];
  if (!best) return eligible;
  const cohort = eligible.filter((candidate) => candidate.placeMeters <= best.placeMeters + 150);
  return [...cohort.sort((left, right) => compareAuxiliary(left, right, ev) || left.placeMeters - right.placeMeters), ...eligible.filter((item) => !cohort.includes(item))];
}

export function rankSeparateParking(input: {
  firstCandidates: SeparateParkingCandidate[];
  secondCandidates: SeparateParkingCandidate[];
  evRequirement: EvRequirement;
}) {
  const first = rankPlaceCandidates(input.firstCandidates, input.evRequirement).slice(0, 10);
  const second = rankPlaceCandidates(input.secondCandidates, input.evRequirement).slice(0, 10);
  const plans: SeparateParkingPlan[] = [];
  for (const firstCandidate of first) for (const secondCandidate of second) {
    if (input.evRequirement === "REQUIRED" && !firstCandidate.hasOnsiteEv && !secondCandidate.hasOnsiteEv) continue;
    plans.push({
      mode: "SEPARATE",
      first: firstCandidate,
      second: secondCandidate,
      totalWalkingMeters: 2 * firstCandidate.placeMeters + 2 * secondCandidate.placeMeters,
      totalFee: firstCandidate.fee == null || secondCandidate.fee == null ? null : firstCandidate.fee + secondCandidate.fee,
      parkingOverheadMinutes: 7,
    });
  }
  return plans.sort((left, right) => left.totalWalkingMeters - right.totalWalkingMeters
    || (left.totalFee ?? Number.POSITIVE_INFINITY) - (right.totalFee ?? Number.POSITIVE_INFINITY)
    || left.first.id.localeCompare(right.first.id)
    || left.second.id.localeCompare(right.second.id));
}

export interface ComparableParkingMode {
  mode: "SHARED" | "SEPARATE";
  totalWalkingMeters: number;
  totalMinutes: number;
  totalFee: number | null;
  parkingOverheadMinutes: number;
}

function modeScore(mode: ComparableParkingMode, weights: { access: number; time: number; fee: number; overhead: number }) {
  const fee = mode.totalFee ?? 20_000;
  const burden = weights.access * Math.min(mode.totalWalkingMeters / 1_200, 1)
    + weights.time * Math.min(mode.totalMinutes / 360, 1)
    + weights.fee * Math.min(fee / 20_000, 1)
    + weights.overhead * Math.min(mode.parkingOverheadMinutes / 30, 1);
  return Math.round((100 - burden) * 10) / 10;
}

export function compareParkingModes(
  shared: ComparableParkingMode,
  separate: ComparableParkingMode,
  context: { weather: ParkingWeather; childAccompanied: boolean; totalStayMinutes: number },
) {
  const weights = context.weather === "RAIN" || context.childAccompanied
    ? { access: 60, time: 20, fee: 10, overhead: 10 }
    : context.totalStayMinutes >= 180
      ? { access: 40, time: 20, fee: 25, overhead: 15 }
      : { access: 45, time: 25, fee: 15, overhead: 15 };
  const sharedScore = modeScore(shared, weights);
  const separateScore = modeScore(separate, weights);
  return {
    sharedScore,
    separateScore,
    recommendedMode: Math.abs(sharedScore - separateScore) < 5
      ? "BOTH_SIMILAR" as const
      : sharedScore > separateScore
        ? "SHARED" as const
        : "SEPARATE" as const,
  };
}
