import { describe, expect, it } from "vitest";
import { compareParkingModes, rankSharedParking, rankSeparateParking } from "../../app/features/parking/parking-score";

const base = {
  name: "주차장",
  isPublic: false,
  capacity: 30,
  fee: 2_000,
  hasOnsiteEv: false,
  reliabilityGrade: "A" as const,
  referenceDate: "2026-07-01",
  closingMarginMinutes: 120,
};

describe("parking ranking", () => {
  it("does not let a distant public lot beat a nearby private lot", () => {
    const ranked = rankSharedParking({
      candidates: [
        { ...base, id: "near", firstMeters: 200, secondMeters: 220 },
        { ...base, id: "far", isPublic: true, capacity: 300, firstMeters: 900, secondMeters: 900 },
      ],
      evRequirement: "NONE",
      weather: "NORMAL",
      childAccompanied: false,
    });
    expect(ranked[0]?.id).toBe("near");
  });

  it("prefers balanced access and then public capacity inside a close cohort", () => {
    const ranked = rankSharedParking({
      candidates: [
        { ...base, id: "imbalanced", firstMeters: 50, secondMeters: 850 },
        { ...base, id: "balanced-private", firstMeters: 430, secondMeters: 450 },
        { ...base, id: "balanced-public", isPublic: true, capacity: 100, firstMeters: 440, secondMeters: 450 },
      ],
      evRequirement: "NONE",
      weather: "NORMAL",
      childAccompanied: false,
    });
    expect(ranked.map((item) => item.id).slice(0, 2)).toEqual(["balanced-public", "balanced-private"]);
  });

  it("requires onsite charging only for REQUIRED", () => {
    const candidates = [
      { ...base, id: "normal", firstMeters: 200, secondMeters: 200 },
      { ...base, id: "ev", hasOnsiteEv: true, firstMeters: 220, secondMeters: 220 },
    ];
    expect(rankSharedParking({ candidates, evRequirement: "REQUIRED", weather: "NORMAL", childAccompanied: false })[0]?.id).toBe("ev");
    expect(rankSharedParking({ candidates, evRequirement: "PREFERRED", weather: "NORMAL", childAccompanied: false })[0]?.id).toBe("ev");
    expect(rankSharedParking({ candidates, evRequirement: "NONE", weather: "NORMAL", childAccompanied: false })[0]?.id).toBe("normal");
  });

  it("includes return walking and seven minutes in separate parking", () => {
    const plans = rankSeparateParking({
      firstCandidates: [{ ...base, id: "first", placeMeters: 100 }],
      secondCandidates: [{ ...base, id: "second", placeMeters: 200 }],
      evRequirement: "NONE",
      weather: "NORMAL",
      childAccompanied: false,
    });
    expect(plans[0]).toMatchObject({ totalWalkingMeters: 600, parkingOverheadMinutes: 7 });
  });

  it("accepts a separate plan when EV is installed at either stop", () => {
    const plans = rankSeparateParking({
      firstCandidates: [{ ...base, id: "first", hasOnsiteEv: true, placeMeters: 120 }],
      secondCandidates: [{ ...base, id: "second", hasOnsiteEv: false, placeMeters: 120 }],
      evRequirement: "REQUIRED",
      weather: "NORMAL",
      childAccompanied: false,
    });
    expect(plans).toHaveLength(1);
  });

  it("tightens separate-parking access for rain and children before using fallback", () => {
    const plans = rankSeparateParking({
      firstCandidates: [{ ...base, id: "near", placeMeters: 480 }, { ...base, id: "far", placeMeters: 760 }],
      secondCandidates: [{ ...base, id: "second", placeMeters: 480 }],
      evRequirement: "NONE",
      weather: "RAIN",
      childAccompanied: true,
    });
    expect(plans[0]?.first.id).toBe("near");
  });

  it("returns BOTH_SIMILAR when normalized mode scores differ by less than five", () => {
    expect(compareParkingModes(
      { mode: "SHARED", totalWalkingMeters: 600, totalMinutes: 150, totalFee: 3_000, parkingOverheadMinutes: 0 },
      { mode: "SEPARATE", totalWalkingMeters: 560, totalMinutes: 153, totalFee: 3_000, parkingOverheadMinutes: 7 },
      { weather: "NORMAL", childAccompanied: false, totalStayMinutes: 120 },
    ).recommendedMode).toBe("BOTH_SIMILAR");
  });
});
