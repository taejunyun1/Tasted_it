import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parsePlaceCsv } from "../../app/features/places/import.server";

describe("week 1 real place intake", () => {
  it("contains 20 valid, uniquely identified public rows", () => {
    const result = parsePlaceCsv(readFileSync("data/week1-places.csv", "utf8"));
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(20);
    expect(new Set(result.rows.map((row) => row.slug)).size).toBe(20);
    expect(result.rows.every((row) => row.status === "PUBLISHED")).toBe(true);
  });
});
