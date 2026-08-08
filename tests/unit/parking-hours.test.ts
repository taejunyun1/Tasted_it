import { describe, expect, it } from "vitest";
import { isParkingOpenForWindow } from "../../app/features/parking/parking-hours";

describe("parking hours", () => {
  it("requires an exit margin", () => {
    const schedule = { weekday: { opensAt: "09:00", closesAt: "22:00" } };
    expect(isParkingOpenForWindow(schedule, new Date("2026-08-07T10:00:00+09:00"), new Date("2026-08-07T21:20:00+09:00"), 30)).toBe(true);
    expect(isParkingOpenForWindow(schedule, new Date("2026-08-07T10:00:00+09:00"), new Date("2026-08-07T21:40:00+09:00"), 30)).toBe(false);
  });

  it("supports windows crossing midnight", () => {
    const schedule = { weekday: { opensAt: "18:00", closesAt: "02:00" } };
    expect(isParkingOpenForWindow(schedule, new Date("2026-08-07T23:00:00+09:00"), new Date("2026-08-08T01:20:00+09:00"), 30)).toBe(true);
  });

  it("uses saturday and holiday schedules", () => {
    const schedule = {
      weekday: { opensAt: "09:00", closesAt: "18:00" },
      saturday: { opensAt: "10:00", closesAt: "16:00" },
      holiday: { opensAt: "11:00", closesAt: "15:00" },
    };
    expect(isParkingOpenForWindow(schedule, new Date("2026-08-08T11:00:00+09:00"), new Date("2026-08-08T14:00:00+09:00"), 30)).toBe(true);
    expect(isParkingOpenForWindow(schedule, new Date("2026-08-09T11:00:00+09:00"), new Date("2026-08-09T14:40:00+09:00"), 30, true)).toBe(false);
  });
});
