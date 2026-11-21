import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";
import {
  B17_PRESERVATION_COLUMNS,
  buildB17PreservationCatalogQuery,
  collectB17PreservationSnapshot,
  planB17PreservationCapture,
} from "../../scripts/b17-preservation-evidence.mjs";

const identifier = (name: string) => {
  if (!/^[a-z][a-z0-9_]{0,127}$/.test(name)) throw Error("UNEXPECTED_TEST_IDENTIFIER");
  return `"${name}"`;
};

it("atomically freezes all checked 0049 app tables and isolates late old writes from a separate destination", async () => {
  const source = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  const destination = env.DB;
  const ownerId = "b17-isolated-owner", placeId = "b17-isolated-place", sessionId = "b17-isolated-session";
  const now = "2026-11-18T01:00:00.000Z", later = "2026-12-18T01:00:00.000Z";
  await applyD1Migrations(source, env.TEST_MIGRATIONS.filter(migration => migration.name < "0050"));
  const catalog = (await source.prepare(buildB17PreservationCatalogQuery().sql).all()).results;
  // This verifies the committed 0049 schema hash, including indexes/triggers,
  // before deriving any SQL identifier or choosing the complete table set.
  const capturePlan = planB17PreservationCapture({ phase: "before", catalog });
  const tables = catalog.filter(row => row.kind === "object" && row.type === "table").map(row => String(row.name)).sort();
  expect(tables).toEqual(Object.keys(B17_PRESERVATION_COLUMNS).sort());
  expect(tables).toHaveLength(82);
  expect(Object.values(B17_PRESERVATION_COLUMNS).reduce((count, columns) => count + columns.length, 0)).toBe(853);

  const guards = tables.flatMap(table => ["INSERT", "UPDATE", "DELETE"].map(operation => ({
    name: `b17_isolated_freeze_${table}_${operation.toLowerCase()}`,
    sql: `CREATE TRIGGER ${identifier(`b17_isolated_freeze_${table}_${operation.toLowerCase()}`)} BEFORE ${operation} ON ${identifier(table)} BEGIN SELECT RAISE(ABORT, 'B17_SOURCE_FROZEN'); END;`,
  })));
  // LOCAL feasibility proof only: source freeze costs 82 × 3 = 246 DDL SQL
  // statements, and its removal another 246. Neither is part of the currently
  // approved B17 admin180/migration201 budget. No production freeze is implied.
  expect(guards).toHaveLength(246);
  const capture = async () => {
    const results: Record<string, unknown[]> = {};
    for (const query of capturePlan.queries) results[query.id] = (await source.prepare(query.sql).all()).results;
    return collectB17PreservationSnapshot(capturePlan, results);
  };
  const ownedGuards = async () => (await source.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'b17_isolated_freeze_*' ORDER BY name").all()).results.map(row => String(row.name));
  const seed = async (db: D1Database, label: string) => db.batch([
    db.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,'b17-isolated@example.test',?,'USER',?,?)").bind(ownerId, label, now, now),
    db.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sessionId, ownerId, later, now),
    db.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,'b17-isolated-place',?,'PUBLISHED','Synthetic','Synthetic',35.1,126.9,'Synthetic',?,?)").bind(placeId, label, now, now),
  ]);

  try {
    await seed(source, "old source");
    await seed(destination, "new destination");

    // The final DDL duplicates a name created earlier in this same batch.
    // A failure must roll back all 246 earlier CREATEs, not leave a partial fence.
    await expect(source.batch([...guards, guards[0]].map(guard => source.prepare(guard.sql)))).rejects.toThrow(/already exists/i);
    expect(await ownedGuards()).toEqual([]);
    await source.prepare("UPDATE places SET name='source after rollback' WHERE id=?").bind(placeId).run();
    expect(await source.prepare("SELECT name FROM places WHERE id=?").bind(placeId).first("name")).toBe("source after rollback");
    const before = await capture();

    // Keep the full 246-statement atomic batch: a local size-limit failure is
    // evidence against this proposal, never permission to silently split it.
    const installed = await source.batch(guards.map(guard => source.prepare(guard.sql)));
    expect(installed).toHaveLength(246);
    expect(installed.every(result => result.success)).toBe(true);
    expect(await ownedGuards()).toEqual(guards.map(guard => guard.name).sort());

    await expect(source.prepare("UPDATE places SET name='late old provider result' WHERE id=?").bind(placeId).run()).rejects.toThrow("B17_SOURCE_FROZEN");
    await expect(source.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES('b17-isolated-late-login',?,?,?)").bind(ownerId, later, now).run()).rejects.toThrow("B17_SOURCE_FROZEN");
    await expect(source.prepare("DELETE FROM users WHERE id=?").bind(ownerId).run()).rejects.toThrow("B17_SOURCE_FROZEN");
    const after = await capture();
    expect(after.tables).toEqual(before.tables);
    expect(Object.keys(after.tables)).toHaveLength(82);

    // Both databases contain the same keys. A normal write to the destination
    // succeeds while the old database's user/session/place values stay frozen.
    expect(await destination.prepare("SELECT name FROM places WHERE id=?").bind(placeId).first("name")).toBe("new destination");
    await destination.prepare("UPDATE places SET name='new destination continued' WHERE id=?").bind(placeId).run();
    expect(await destination.prepare("SELECT name FROM places WHERE id=?").bind(placeId).first("name")).toBe("new destination continued");
    expect(await source.prepare("SELECT name FROM places WHERE id=?").bind(placeId).first("name")).toBe("source after rollback");
    for (const db of [source, destination]) {
      expect(await db.prepare("SELECT count(*) AS n FROM users WHERE id=?").bind(ownerId).first("n")).toBe(1);
      expect(await db.prepare("SELECT count(*) AS n FROM sessions WHERE id=? AND user_id=?").bind(sessionId, ownerId).first("n")).toBe(1);
      expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    }
    console.info("B17_ISOLATED_CUTOVER_LOCAL", JSON.stringify({ applicationTables: 82, columns: 853, freezeDdlStatements: 246, atomicFailureBatchStatements: 247, sourceCaptureQueriesPerPhase: capturePlan.queries.length, lateWritesDenied: 3, distinctDatabases: 2, remoteOperations: 0, r2Evidence: "NOT_TESTED" }));
  } finally {
    const remaining = await ownedGuards();
    if (remaining.length) await source.batch(remaining.map(name => source.prepare(`DROP TRIGGER ${identifier(name)};`)));
    for (const db of [source, destination]) {
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(ownerId),
        db.prepare("DELETE FROM users WHERE id=?").bind(ownerId),
        db.prepare("DELETE FROM places WHERE id=?").bind(placeId),
      ]);
      expect(await db.prepare("SELECT (SELECT count(*) FROM users WHERE id=?) + (SELECT count(*) FROM sessions WHERE user_id=?) + (SELECT count(*) FROM places WHERE id=?) AS n").bind(ownerId, ownerId, placeId).first("n")).toBe(0);
    }
    expect(await ownedGuards()).toEqual([]);
  }
});
