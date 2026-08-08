import { describe, expect, it } from "vitest";
import { distanceBurden, estimateWalkingMeters, isSameDistanceCohort } from "../../app/features/parking/parking-distance";

describe("parking distance", () => {
  it("applies a walking correction and rounds to 10 meters", () => {
    expect(estimateWalkingMeters({ latitude: 35.1595, longitude: 126.8526 }, { latitude: 35.1605, longitude: 126.8526 }) % 10).toBe(0);
    expect(estimateWalkingMeters({ latitude: 35.1595, longitude: 126.8526 }, { latitude: 35.1605, longitude: 126.8526 })).toBeGreaterThan(100);
  });

  it("penalizes the longest walking leg", () => {
    expect(distanceBurden(430, 450)).toBeLessThan(distanceBurden(50, 850));
  });

  it("keeps auxiliary ranking inside the distance cohort only", () => {
    expect(isSameDistanceCohort({ first: 300, second: 350 }, { first: 430, second: 460 })).toBe(true);
    expect(isSameDistanceCohort({ first: 300, second: 350 }, { first: 500, second: 500 })).toBe(false);
  });
});
