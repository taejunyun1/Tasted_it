import { describe, expect, it, vi } from "vitest";
import { isParkingSyncDue } from "../../app/features/parking/scheduled-parking.server";

describe("parking sync gate", () => {
  it("does not refresh before 90 days", () => {
    expect(isParkingSyncDue("2026-07-01T00:00:00Z", new Date("2026-08-08T00:00:00Z"))).toBe(false);
  });

  it("refreshes after 90 days or when never completed", () => {
    expect(isParkingSyncDue("2026-01-01T00:00:00Z", new Date("2026-08-08T00:00:00Z"))).toBe(true);
    expect(isParkingSyncDue(null, new Date("2026-08-08T00:00:00Z"))).toBe(true);
    expect(vi.isMockFunction(isParkingSyncDue)).toBe(false);
  });
});
