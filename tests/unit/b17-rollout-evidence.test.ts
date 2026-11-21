import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { B17_MIGRATIONS, B17_REQUIRED_COLUMNS, B17_TABLES, buildB17MigrationManifest, compareB17Snapshots } from "../../scripts/b17-rollout-evidence.mjs";
import { withB17SourceFixture } from "./b17-source-fixture";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const snapshot = () => ({ tables: Object.fromEntries(B17_TABLES.map((name: string) => {
  const columns = [...B17_REQUIRED_COLUMNS[name], "test_payload", "test_count"];
  return [name, { columns, rows: [1, 2].map((rowid) => ({
    ...Object.fromEntries(columns.map((column: string) => [column, null])), rowid,
    test_payload: rowid === 1 ? "private@example.test" : "sensitive-private-value", test_count: rowid === 1 ? 1 : null,
  })) }];
})) });
async function temp() { const path = await mkdtemp(join(tmpdir(), "b17-evidence-")); temporary.push(path); return path; }

it("compares every prior value and rowid while allowing reordered and added columns", () => {
  const before = snapshot(), after = snapshot();
  for (const name of B17_TABLES) {
    after.tables[name].columns = ["new_column", ...after.tables[name].columns].reverse();
    after.tables[name].rows = after.tables[name].rows.reverse().map((row: object) => ({ ...row, new_column: "new-only-value" }));
  }
  const result = compareB17Snapshots(before, after);
  expect(result).toMatchObject({ sourceKind: "LOCAL_PREPARATION", executed: false, ok: true, mismatchCount: 0 });
  expect(result.tables).toHaveLength(7);
  for (const table of result.tables) expect(table.beforeHash).toBe(table.afterHash);
  expect(JSON.stringify(result)).not.toMatch(/private|sensitive|new-only-value/);
});

it("reports changed cells and removed rows without exposing either cell value", () => {
  const before = snapshot(), after = snapshot();
  after.tables.admin_operations.rows[1].test_payload = "different-private-secret";
  after.tables.rating_recompute_jobs.rows.pop();
  const result = compareB17Snapshots(before, after);
  expect(result.ok).toBe(false);
  expect(result.mismatches).toEqual(expect.arrayContaining([
    { table: "admin_operations", code: "VALUE_MISMATCH", rowid: 2, column: "test_payload" },
    { table: "rating_recompute_jobs", code: "ROW_MISSING", rowid: 2 },
  ]));
  expect(JSON.stringify(result)).not.toMatch(/private|sensitive|secret/);
});

it("rejects invalid shapes, missing tables, duplicate or missing rowids and oversized inputs", () => {
  for (const change of [
    (value: ReturnType<typeof snapshot>) => { delete value.tables.admin_operations; },
    (value: ReturnType<typeof snapshot>) => { value.tables.admin_operations.rows[1].rowid = 1; },
    (value: ReturnType<typeof snapshot>) => { delete (value.tables.admin_operations.rows[0] as Record<string, unknown>).rowid; },
    (value: ReturnType<typeof snapshot>) => { value.tables.admin_operations.rows = Array.from({ length: 10001 }, (_, rowid) => ({ rowid: rowid + 1, payload_json: "", count: null })); },
    (value: ReturnType<typeof snapshot>) => { (value.tables as Record<string, unknown>).private_invalid_table = {}; },
  ]) {
    const invalid = snapshot(); change(invalid);
    expect(() => compareB17Snapshots(snapshot(), invalid)).toThrow("B17_SNAPSHOT_INVALID");
  }
  const partial = { tables: Object.fromEntries(B17_TABLES.map((name: string) => [name, { columns: ["rowid"], rows: [{ rowid: 1 }] }])) };
  expect(() => compareB17Snapshots(partial, partial)).toThrow("B17_SNAPSHOT_INVALID");
});

it("rejects removal of a prior column and hashes scalar types distinctly", () => {
  const before = snapshot(), after = snapshot();
  after.tables.admin_operation_checks.columns = after.tables.admin_operation_checks.columns.filter((column: string) => column !== "test_payload");
  after.tables.admin_operation_checks.rows = after.tables.admin_operation_checks.rows.map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "test_payload")));
  const result = compareB17Snapshots(before, after);
  expect(result.mismatches).toContainEqual({ table: "admin_operation_checks", code: "COLUMN_MISSING", column: "test_payload" });
  const typed = snapshot();
  (typed.tables.admin_operations.rows[0] as Record<string, unknown>).test_count = "1";
  expect(compareB17Snapshots(before, typed).tables[0].beforeHash).not.toBe(compareB17Snapshots(before, typed).tables[0].afterHash);
});

it("builds exactly the nine local migration hashes with pinned HEAD information", async () => {
  await withB17SourceFixture(async (root) => {
    const result = await buildB17MigrationManifest(root);
    expect(result).toMatchObject({ sourceKind: "LOCAL_PREPARATION", executed: false, ok: true });
    expect(result.sourceHead).toMatch(/^[a-f0-9]{40}$/);
    expect(result.migrations.map((row: {name:string}) => row.name)).toEqual(B17_MIGRATIONS);
    for (const row of result.migrations) {
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(row.headSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(row.matchesHead).toBe(true);
    }
    for (const name of ["0057_unexpected.sql", "0061_future.sql"]) {
      const extraMigration = join(root, "drizzle", name);
      await writeFile(extraMigration, "SELECT 2;\n");
      await expect(buildB17MigrationManifest(root)).rejects.toThrow("B17_MIGRATION_MANIFEST_INVALID");
      await rm(extraMigration);
    }
    await rm(join(root, "drizzle", B17_MIGRATIONS[0]));
    await expect(buildB17MigrationManifest(root)).rejects.toThrow("B17_MIGRATION_MANIFEST_INVALID");
  });
});

it("CLI comparison exits nonzero on mismatch and emits only the safe report", async () => {
  const root = await temp(), before = snapshot(), after = snapshot();
  after.tables.admin_operations.rows[0].test_count = 99;
  const beforePath = join(root, "before.json"), afterPath = join(root, "after.json");
  await writeFile(beforePath, JSON.stringify(before)); await writeFile(afterPath, JSON.stringify(after));
  try {
    execFileSync(process.execPath, [resolve("scripts/b17-rollout-evidence.mjs"), "compare", "--before", beforePath, "--after", afterPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    throw new Error("expected nonzero comparison status");
  } catch (error) {
    const result = error as { status: number; stdout: string; stderr: string };
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, executed: false });
    expect(result.stdout + result.stderr).not.toMatch(/private|sensitive|"test_count":99/);
  }
});

it("manifest CLI fails when a tracked migration differs from HEAD", async () => {
  const root = await temp(); await mkdir(join(root, "drizzle"));
  for (const name of B17_MIGRATIONS) await writeFile(join(root, "drizzle", name), "SELECT 1;\n");
  execFileSync("git", ["init", "--initial-branch=main", root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "add", "drizzle"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "-c", "user.name=B17 fixture", "-c", "user.email=b17@example.test", "commit", "-m", "fixture"], { stdio: "pipe" });
  await writeFile(join(root, "drizzle", B17_MIGRATIONS[0]), "SELECT 'private-migration-source';\n");
  try {
    execFileSync(process.execPath, [resolve("scripts/b17-rollout-evidence.mjs"), "manifest", "--root", root], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    throw new Error("expected nonzero manifest status");
  } catch (error) {
    const result = error as { status: number; stdout: string; stderr: string };
    expect(result.status).toBe(1);
    const manifest = JSON.parse(result.stdout);
    expect(manifest).toMatchObject({ ok: false, executed: false });
    expect(manifest.migrations[0].matchesHead).toBe(false);
    expect(manifest.migrations[0].sha256).not.toBe(manifest.migrations[0].headSha256);
    expect(result.stdout + result.stderr).not.toContain("private-migration-source");
  }
  execFileSync("git", ["-C", root, "rm", "--cached", `drizzle/${B17_MIGRATIONS[0]}`], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "-c", "user.name=B17 fixture", "-c", "user.email=b17@example.test", "commit", "-m", "untracked fixture"], { stdio: "pipe" });
  const untracked = await buildB17MigrationManifest(root);
  expect(untracked.ok).toBe(false);
  expect(untracked.migrations[0]).toMatchObject({ headBlob: null, headSha256: null, matchesHead: false });
});
