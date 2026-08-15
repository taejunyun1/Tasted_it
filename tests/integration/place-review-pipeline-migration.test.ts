import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("place review pipeline migration", () => {
  it("stores exactly one subject and bounded workflow values", async () => {
    const table = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'place_review_work_items'",
    ).first<{ sql: string }>();

    expect(table?.sql).toContain("business_license_id IS NOT NULL AND place_id IS NULL");
    expect(table?.sql).toContain("CHECK(stage IN ('SOURCE_REVIEW','NAVER_VERIFICATION','CATEGORY_CONFIRMATION','DUPLICATE_REVIEW','FINAL_APPROVAL'))");
    expect(table?.sql).toContain("CHECK(status IN ('ACTIVE','ON_HOLD','COMPLETED','EXCLUDED'))");
  });

  it("prevents two active cycles for the same subject", async () => {
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'place_review_work_items'",
    ).all<{ name: string }>();

    expect(indexes.results.map((row) => row.name)).toEqual(expect.arrayContaining([
      "place_review_active_business_idx",
      "place_review_active_place_idx",
    ]));
  });

  it("stores one review decision per work item and candidate place", async () => {
    const table = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'place_review_duplicate_resolutions'",
    ).first<{ sql: string }>();

    expect(table?.sql).toContain("CHECK(decision IN ('LINK_EXISTING','MERGE','DISTINCT'))");
    expect(table?.sql).toContain("UNIQUE(work_item_id, candidate_place_id)");
  });
});
