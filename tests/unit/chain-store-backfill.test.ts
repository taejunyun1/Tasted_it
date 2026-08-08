import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("chain store exclusion backfill migration", () => {
  it("moves only open pending explicit chains and preserves existing overrides", () => {
    const sql = readFileSync(new URL("../../drizzle/0011_backfill_chain_store_exclusions.sql", import.meta.url), "utf8");

    expect(sql).toContain("INSERT OR IGNORE INTO business_license_exclusions");
    expect(sql).toContain("normalized_status = 'OPEN'");
    expect(sql).toContain("review_status = 'PENDING'");
    expect(sql).toContain("뚜레쥬르");
    expect(sql).toContain("파리바게");
    expect(sql).not.toContain("UPDATE business_license_exclusions");
  });
});
