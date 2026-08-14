import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

type IndexInfo = { name: string };
type IndexColumn = { name: string };
type TableDefinition = { sql: string };

describe("rate limit migration", () => {
  beforeAll(async () => {
    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name === "0028_rate_limit_windows.sql");
    if (!migration) throw new Error("RATE_LIMIT_MIGRATION_MISSING");

    await env.DB.exec("DROP TABLE rate_limit_windows");
    await applyD1Migrations(env.DB, [migration], "rate_limit_migration_contracts");
  });

  it("applies 0028 after the reviewer photo cleanup schema", async () => {
    await expect(env.DB.prepare("SELECT review_id FROM reviewer_photo_cleanup_jobs LIMIT 1").all()).resolves.toBeDefined();
    await expect(env.DB.prepare("SELECT bucket_hash FROM rate_limit_windows LIMIT 1").all()).resolves.toBeDefined();
    await expect(env.DB.prepare(
      "SELECT name FROM rate_limit_migration_contracts WHERE name = '0028_rate_limit_windows.sql'",
    ).first<{ name: string }>()).resolves.toEqual({ name: "0028_rate_limit_windows.sql" });
  });

  it("stores only hashed buckets and a non-negative counter", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(rate_limit_windows)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toEqual([
      "bucket_hash",
      "window_started_at",
      "attempt_count",
    ]);

    const definition = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rate_limit_windows'",
    ).first<TableDefinition>();
    expect(definition?.sql).toContain("PRIMARY KEY (bucket_hash, window_started_at)");
    expect(definition?.sql).toContain("CHECK(attempt_count >= 0)");
    expect(definition?.sql).not.toContain("email");
    expect(definition?.sql).not.toContain("ip");

    const indexes = await env.DB.prepare("PRAGMA index_list(rate_limit_windows)").all<IndexInfo>();
    expect(indexes.results.map((index) => index.name)).toEqual(expect.arrayContaining([
      "rate_limit_windows_started_idx",
    ]));
    const startedColumns = await env.DB.prepare("PRAGMA index_info(rate_limit_windows_started_idx)").all<IndexColumn>();
    expect(startedColumns.results.map((column) => column.name)).toEqual(["window_started_at"]);
  });
});
