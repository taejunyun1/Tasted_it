import type { ParkingFeeRule } from "./parking-types";

export function calculateEstimatedFee(rule: ParkingFeeRule, stayMinutes: number) {
  if (rule.status === "FREE") return 0;
  if (rule.status === "UNKNOWN") return null;
  if (rule.baseMinutes == null || rule.baseFee == null) return null;

  let fee = rule.baseFee;
  const additionalStay = Math.max(0, stayMinutes - rule.baseMinutes);
  if (additionalStay > 0) {
    if (!rule.additionalMinutes || rule.additionalFee == null) return null;
    fee += Math.ceil(additionalStay / rule.additionalMinutes) * rule.additionalFee;
  }
  return rule.dailyMaxFee == null ? fee : Math.min(fee, rule.dailyMaxFee);
}
