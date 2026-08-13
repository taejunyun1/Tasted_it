import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

type IndexInfo = {
  name: string;
};

type IndexColumn = {
  name: string;
};

type TableDefinition = {
  sql: string;
};

type LivenessState = {
  kakaoStatus: string;
  recommendationExcluded: number;
  status: string;
};

async function insertPlace(id: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at) VALUES (?, ?, ?, 'PUBLISHED', '광주', '동명동', 35.15, 126.92, '영업 검증 테스트', '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z')",
  ).bind(id, `${id}-slug`, `장소 ${id}`).run();
}

describe("place liveness migration", () => {
  beforeAll(async () => {
    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name === "0025_place_liveness_states.sql");
    if (!migration) throw new Error("PLACE_LIVENESS_MIGRATION_MISSING");

    await env.DB.exec("DROP TABLE place_liveness_states");
    await applyD1Migrations(env.DB, [migration], "place_liveness_migration_contracts");
  });

  it("applies 0025 to the schema already migrated through 0024", async () => {
    await expect(env.DB.prepare("SELECT id FROM places LIMIT 1").all()).resolves.toBeDefined();
    await expect(env.DB.prepare("SELECT place_id FROM place_liveness_states LIMIT 1").all()).resolves.toBeDefined();
    await expect(env.DB.prepare(
      "SELECT name FROM place_liveness_migration_contracts WHERE name = '0025_place_liveness_states.sql'",
    ).first<{ name: string }>()).resolves.toEqual({ name: "0025_place_liveness_states.sql" });
  });

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

  it("enforces the fixed enum, boolean, default, and cascade boundaries", async () => {
    const definition = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'place_liveness_states'",
    ).first<TableDefinition>();
    expect(definition?.sql).toContain("CHECK(status IN ('VERIFIED', 'MONITORING', 'SUSPECTED', 'HIDDEN'))");
    expect(definition?.sql).toContain("CHECK(kakao_status IN ('MATCHED', 'AMBIGUOUS', 'NOT_FOUND', 'ERROR', 'SKIPPED'))");
    expect(definition?.sql).toContain("recommendation_excluded INTEGER NOT NULL DEFAULT 0 CHECK(recommendation_excluded IN (0, 1))");

    const defaultsId = `liveness-defaults-${crypto.randomUUID()}`;
    await insertPlace(defaultsId);
    await env.DB.prepare(
      "INSERT INTO place_liveness_states (place_id, updated_at) VALUES (?, '2026-08-13T00:00:00.000Z')",
    ).bind(defaultsId).run();
    await expect(env.DB.prepare(
      "SELECT status, kakao_status AS kakaoStatus, recommendation_excluded AS recommendationExcluded FROM place_liveness_states WHERE place_id = ?",
    ).bind(defaultsId).first<LivenessState>()).resolves.toEqual({
      status: "MONITORING",
      kakaoStatus: "SKIPPED",
      recommendationExcluded: 0,
    });

    const invalidStatusId = `liveness-invalid-status-${crypto.randomUUID()}`;
    await insertPlace(invalidStatusId);
    await expect(env.DB.prepare(
      "INSERT INTO place_liveness_states (place_id, status, updated_at) VALUES (?, 'INVALID', '2026-08-13T00:00:00.000Z')",
    ).bind(invalidStatusId).run()).rejects.toThrow();

    const invalidKakaoStatusId = `liveness-invalid-kakao-${crypto.randomUUID()}`;
    await insertPlace(invalidKakaoStatusId);
    await expect(env.DB.prepare(
      "INSERT INTO place_liveness_states (place_id, kakao_status, updated_at) VALUES (?, 'INVALID', '2026-08-13T00:00:00.000Z')",
    ).bind(invalidKakaoStatusId).run()).rejects.toThrow();

    const invalidExcludedId = `liveness-invalid-excluded-${crypto.randomUUID()}`;
    await insertPlace(invalidExcludedId);
    await expect(env.DB.prepare(
      "INSERT INTO place_liveness_states (place_id, recommendation_excluded, updated_at) VALUES (?, 2, '2026-08-13T00:00:00.000Z')",
    ).bind(invalidExcludedId).run()).rejects.toThrow();

    const cascadeId = `liveness-cascade-${crypto.randomUUID()}`;
    await insertPlace(cascadeId);
    await env.DB.prepare(
      "INSERT INTO place_liveness_states (place_id, updated_at) VALUES (?, '2026-08-13T00:00:00.000Z')",
    ).bind(cascadeId).run();
    await env.DB.prepare("DELETE FROM places WHERE id = ?").bind(cascadeId).run();
    await expect(env.DB.prepare("SELECT place_id FROM place_liveness_states WHERE place_id = ?")
      .bind(cascadeId).all()).resolves.toMatchObject({ results: [] });
  });
});
