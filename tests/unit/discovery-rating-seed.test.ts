import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("discovery rating seed", () => {
  it("is repeatable, isolated to QA identities, and covers rating boundaries", () => {
    const sql = readFileSync(new URL("../../scripts/seed-discovery-ratings.sql", import.meta.url), "utf8");
    expect(sql).toContain("qa-discovery-");
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("WHEN 2 THEN 3");
    expect(sql).toContain("WHEN 3 THEN 7");
    expect(sql).toContain("WHEN 4 THEN 8");
    expect(sql).toContain("WHEN 5 THEN 12");
    expect(sql).toContain("WHEN 6 THEN 25");
    expect(sql).toContain("WHEN 7 THEN 50");
    expect(sql).toContain("golden_pick_events");
  });
});
