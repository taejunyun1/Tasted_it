import { describe, expect, it } from "vitest";
import { calculateEstimatedFee } from "../../app/features/parking/parking-fee";

describe("parking fee", () => {
  it("does not treat unknown pricing as free", () => {
    expect(calculateEstimatedFee({ status: "UNKNOWN" }, 120)).toBeNull();
  });

  it("rounds up additional units and honors the daily cap", () => {
    const rule = { status: "PAID" as const, baseMinutes: 30, baseFee: 1_000, additionalMinutes: 10, additionalFee: 500, dailyMaxFee: 3_000 };
    expect(calculateEstimatedFee(rule, 31)).toBe(1_500);
    expect(calculateEstimatedFee(rule, 180)).toBe(3_000);
  });

  it("returns zero only when the source says free", () => {
    expect(calculateEstimatedFee({ status: "FREE" }, 1_000)).toBe(0);
  });
});
