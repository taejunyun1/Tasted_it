import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canonical category slugs", () => {
  it("uses classifier slugs in the week-one seed", () => {
    const sql = readFileSync(new URL("../../scripts/seed-week1.sql", import.meta.url), "utf8");

    expect(sql).toContain("'cat-ramen', 'ramen-detail'");
    expect(sql).toContain("'cat-donkatsu', 'donkatsu-detail'");
    expect(sql).toContain("'cat-gukbap', 'gukbap-detail'");
    expect(sql).toContain("'cat-bakery', 'bakery-detail'");
  });

  it("repairs legacy production slugs without changing category ids", () => {
    const sql = readFileSync(new URL("../../drizzle/0012_repair_category_slugs.sql", import.meta.url), "utf8");

    expect(sql).toContain("UPDATE categories SET slug = 'ramen-detail'");
    expect(sql).toContain("UPDATE categories SET slug = 'donkatsu-detail'");
    expect(sql).toContain("UPDATE categories SET slug = 'gukbap-detail'");
    expect(sql).toContain("UPDATE categories SET slug = 'bakery-detail'");
  });
});
