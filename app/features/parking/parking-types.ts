export interface Coordinate {
  latitude: number;
  longitude: number;
}

export type ParkingFeeStatus = "FREE" | "PAID" | "MIXED" | "UNKNOWN";

export interface ParkingFeeRule {
  status: ParkingFeeStatus;
  baseMinutes?: number | null;
  baseFee?: number | null;
  additionalMinutes?: number | null;
  additionalFee?: number | null;
  dailyMaxFee?: number | null;
}

export interface DailyParkingHours {
  opensAt: string;
  closesAt: string;
}

export interface ParkingSchedule {
  weekday?: DailyParkingHours | null;
  saturday?: DailyParkingHours | null;
  holiday?: DailyParkingHours | null;
}

export type EvRequirement = "NONE" | "PREFERRED" | "REQUIRED";

export interface ParkingFacilityCandidate extends Coordinate {
  id: string;
  name: string;
  isPublic: boolean;
  capacity: number | null;
  fee: number | null;
  hasOnsiteEv: boolean;
  reliabilityGrade: "A" | "B";
  referenceDate: string;
  closingMarginMinutes?: number | null;
}
