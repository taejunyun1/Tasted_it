import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

type Table = { name: string };
type Definition = { sql: string };

describe("Workers AI 제거 migration", () => {
  it("removes persisted AI classification history", async () => {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<Table>();

    expect(tables.results.map((table) => table.name)).not.toContain("ai_classification_runs");
  });

  it("keeps only non-AI operational alert types", async () => {
    const definition = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'operational_alerts'",
    ).first<Definition>();

    expect(definition?.sql).toContain("'NAVER_LOCAL_SEARCH'");
    expect(definition?.sql).not.toContain("'AI_CLASSIFICATION'");
  });
});
