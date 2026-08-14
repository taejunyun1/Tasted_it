import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

type Column = { name: string };
type IndexColumn = { name: string };

describe("NAVER 지역검색 카테고리 migration", () => {
  it("stores only a minimal internal category decision", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(naver_local_category_verifications)").all<Column>();
    expect(columns.results.map((column) => column.name)).toEqual([
      "business_license_id",
      "status",
      "mapped_category_id",
      "match_score",
      "specificity_score",
      "confidence_score",
      "evidence_codes_json",
      "rule_version",
      "input_fingerprint",
      "queried_at",
      "expires_at",
      "failure_code",
      "created_at",
      "updated_at",
    ]);
    expect(columns.results.map((column) => column.name)).not.toEqual(expect.arrayContaining([
      "provider_place_id", "raw_response", "image_url", "review_text", "description", "provider_link",
    ]));
  });

  it("enforces bounded statuses, scores, and query indexes", async () => {
    const definition = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'naver_local_category_verifications'",
    ).first<{ sql: string }>();
    expect(definition?.sql).toContain("CHECK(status IN ('VERIFIED','LIKELY','AMBIGUOUS','NO_MATCH','OUT_OF_SCOPE','FAILED','SKIPPED'))");
    expect(definition?.sql).toContain("CHECK(match_score BETWEEN 0 AND 100)");
    expect(definition?.sql).toContain("CHECK(specificity_score BETWEEN 0 AND 20)");
    expect(definition?.sql).toContain("CHECK(confidence_score BETWEEN 0 AND 100)");

    const indexColumns = await env.DB.prepare("PRAGMA index_info(naver_local_category_verifications_status_queried_idx)").all<IndexColumn>();
    expect(indexColumns.results.map((column) => column.name)).toEqual(["status", "queried_at"]);
  });
});
