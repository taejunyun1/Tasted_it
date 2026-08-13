import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

type IndexInfo = { name: string };
type IndexColumn = { name: string };
type TableDefinition = { sql: string };

describe("reviewer photo migration", () => {
  beforeAll(async () => {
    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name === "0026_reviewer_visit_photos.sql");
    if (!migration) throw new Error("REVIEWER_PHOTO_MIGRATION_MISSING");

    await env.DB.exec("DROP TABLE reviewer_visit_photos");
    await applyD1Migrations(env.DB, [migration], "reviewer_photo_migration_contracts");
  });

  it("applies 0026 after the reviewer visit review schema", async () => {
    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_reviews LIMIT 1").all()).resolves.toBeDefined();
    await expect(env.DB.prepare("SELECT id FROM reviewer_visit_photos LIMIT 1").all()).resolves.toBeDefined();
    await expect(env.DB.prepare(
      "SELECT name FROM reviewer_photo_migration_contracts WHERE name = '0026_reviewer_visit_photos.sql'",
    ).first<{ name: string }>()).resolves.toEqual({ name: "0026_reviewer_visit_photos.sql" });
  });

  it("creates ordered metadata with immutable storage constraints", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(reviewer_visit_photos)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toEqual([
      "id",
      "review_id",
      "object_key",
      "content_type",
      "byte_size",
      "position",
      "created_at",
      "updated_at",
    ]);

    const definition = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reviewer_visit_photos'",
    ).first<TableDefinition>();
    expect(definition?.sql).toContain("REFERENCES reviewer_visit_reviews(id) ON DELETE CASCADE");
    expect(definition?.sql).toContain("CHECK(content_type = 'image/jpeg')");
    expect(definition?.sql).toContain("CHECK(byte_size BETWEEN 1 AND 8388608)");
    expect(definition?.sql).toContain("CHECK(position BETWEEN 0 AND 4)");

    const indexes = await env.DB.prepare("PRAGMA index_list(reviewer_visit_photos)").all<IndexInfo>();
    expect(indexes.results.map((index) => index.name)).toEqual(expect.arrayContaining([
      "reviewer_visit_photos_object_key_uidx",
      "reviewer_visit_photos_review_position_uidx",
    ]));
    const positionColumns = await env.DB.prepare("PRAGMA index_info(reviewer_visit_photos_review_position_uidx)").all<IndexColumn>();
    expect(positionColumns.results.map((column) => column.name)).toEqual(["review_id", "position"]);
  });
});
