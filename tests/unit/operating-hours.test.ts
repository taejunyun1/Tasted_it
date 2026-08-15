import { describe, expect, it } from "vitest";
import { operatingAvailabilityAt } from "../../app/features/courses/operating-hours";

describe("operating hours", () => {
  it("evaluates KST, closed days, and midnight-spanning intervals", () => {
    expect(operatingAvailabilityAt([], new Date("2026-08-09T03:00:00Z"))).toBe("UNKNOWN");
    expect(operatingAvailabilityAt([{ weekday: 0, opensAt: "11:00", closesAt: "14:00", isClosed: false }], new Date("2026-08-09T03:00:00Z"))).toBe("OPEN");
    expect(operatingAvailabilityAt([{ weekday: 0, opensAt: "11:00", closesAt: "14:00", isClosed: false }], new Date("2026-08-09T06:00:00Z"))).toBe("CLOSED");
    expect(operatingAvailabilityAt([{ weekday: 0, opensAt: "18:00", closesAt: "02:00", isClosed: false }], new Date("2026-08-09T16:00:00Z"))).toBe("OPEN");
  });
});
