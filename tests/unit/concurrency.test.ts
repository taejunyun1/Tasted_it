import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../../app/lib/concurrency";

describe("mapWithConcurrency", () => {
  it("never runs more than the configured number of tasks", async () => {
    let active = 0;
    let peak = 0;
    const values = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    });
    expect(peak).toBe(3);
    expect(values).toEqual([2, 4, 6, 8, 10, 12]);
  });
});
