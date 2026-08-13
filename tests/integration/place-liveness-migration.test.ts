import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

type IndexInfo = {
  name: string;
};

type IndexColumn = {
  name: string;
};

describe("place liveness migration", () => {
  it("creates the liveness state table and its query indexes", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(place_liveness_states)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toEqual([
      "place_id",
      "status",
      "kakao_status",
      "matched_kakao_place_id",
      "match_score",
      "consecutive_not_found",
      "first_not_found_at",
      "last_matched_at",
      "last_checked_at",
      "next_check_at",
      "recommendation_excluded",
      "protected_until",
      "lease_token",
      "lease_expires_at",
      "evidence_json",
      "updated_at",
    ]);

    const indexes = await env.DB.prepare("PRAGMA index_list(place_liveness_states)").all<IndexInfo>();
    expect(indexes.results.map((index) => index.name)).toEqual(expect.arrayContaining([
      "place_liveness_due_idx",
      "place_liveness_status_idx",
    ]));

    const dueColumns = await env.DB.prepare("PRAGMA index_info(place_liveness_due_idx)").all<IndexColumn>();
    expect(dueColumns.results.map((column) => column.name)).toEqual([
      "next_check_at",
      "lease_expires_at",
    ]);

    const statusColumns = await env.DB.prepare("PRAGMA index_info(place_liveness_status_idx)").all<IndexColumn>();
    expect(statusColumns.results.map((column) => column.name)).toEqual([
      "status",
      "recommendation_excluded",
    ]);
  });
});
