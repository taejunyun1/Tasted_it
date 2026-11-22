import { describe, expect, it } from "vitest";
import { operatingAvailabilityAt } from "../../app/features/courses/operating-hours";

describe("operating hours", () => {
  it("uses KST and includes opening time while excluding closing time", () => {
    const sundayLunch = [{ weekday: 0, opensAt: "11:00", closesAt: "14:00", isClosed: false }];
    expect(operatingAvailabilityAt(sundayLunch, new Date("2026-08-09T02:00:00Z"))).toBe("OPEN");
    expect(operatingAvailabilityAt(sundayLunch, new Date("2026-08-09T05:00:00Z"))).toBe("CLOSED");
  });

  it("starts an overnight interval on its recorded day and carries it through midnight", () => {
    const schedule = [
      { weekday: 6, opensAt: null, closesAt: null, isClosed: true },
      { weekday: 0, opensAt: "18:00", closesAt: "02:00", isClosed: false },
      { weekday: 1, opensAt: null, closesAt: null, isClosed: true },
    ];
    expect(operatingAvailabilityAt(schedule, new Date("2026-08-08T16:00:00Z"))).toBe("CLOSED");
    expect(operatingAvailabilityAt(schedule, new Date("2026-08-09T09:00:00Z"))).toBe("OPEN");
    expect(operatingAvailabilityAt(schedule, new Date("2026-08-09T15:00:00Z"))).toBe("OPEN");
    expect(operatingAvailabilityAt(schedule, new Date("2026-08-09T16:59:00Z"))).toBe("OPEN");
    expect(operatingAvailabilityAt(schedule, new Date("2026-08-09T17:00:00Z"))).toBe("CLOSED");
  });

  it("honors the previous day's overnight record before today's missing schedule", () => {
    const sundayEvening = [{ weekday: 0, opensAt: "18:00", closesAt: "02:00", isClosed: false }];
    expect(operatingAvailabilityAt(sundayEvening, new Date("2026-08-09T16:00:00Z"))).toBe("OPEN");
    expect(operatingAvailabilityAt(sundayEvening, new Date("2026-08-09T17:00:00Z"))).toBe("UNKNOWN");
  });

  it("preserves equal times as a full day starting at the recorded opening", () => {
    const sundayAllDay = [{ weekday: 0, opensAt: "10:00", closesAt: "10:00", isClosed: false }];
    expect(operatingAvailabilityAt(sundayAllDay, new Date("2026-08-09T00:59:00Z"))).toBe("CLOSED");
    expect(operatingAvailabilityAt(sundayAllDay, new Date("2026-08-09T01:00:00Z"))).toBe("OPEN");
    expect(operatingAvailabilityAt(sundayAllDay, new Date("2026-08-10T00:59:00Z"))).toBe("OPEN");
    expect(operatingAvailabilityAt(sundayAllDay, new Date("2026-08-10T01:00:00Z"))).toBe("UNKNOWN");
  });

  it("keeps absent, incomplete, invalid and contradictory days unconfirmed", () => {
    const sunday = new Date("2026-08-09T03:00:00Z");
    const closed = { weekday: 0, opensAt: null, closesAt: null, isClosed: true };
    const open = { weekday: 0, opensAt: "11:00", closesAt: "14:00", isClosed: false };
    expect(operatingAvailabilityAt([], sunday)).toBe("UNKNOWN");
    expect(operatingAvailabilityAt([{ ...open, weekday: 2 }], sunday)).toBe("UNKNOWN");
    expect(operatingAvailabilityAt([{ ...open, closesAt: null }], sunday)).toBe("UNKNOWN");
    expect(operatingAvailabilityAt([{ ...open, opensAt: "24:00" }], sunday)).toBe("UNKNOWN");
    expect(operatingAvailabilityAt([closed, open], sunday)).toBe("UNKNOWN");
    expect(operatingAvailabilityAt([closed], sunday)).toBe("CLOSED");
  });
});
