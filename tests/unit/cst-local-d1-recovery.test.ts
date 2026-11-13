import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, symlinkSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertOptIn, digestBytes, readVerifiedBackup, compareSnapshots } from "../../scripts/cst-local-d1-recovery.mjs";

const directories: string[] = [];
function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "cst-recovery-test-"));
  chmodSync(directory, 0o700);
  directories.push(directory);
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("local-only D1 recovery rehearsal boundaries", () => {
  it("requires the exact opt-in and rejects database, file and remote arguments", () => {
    expect(() => assertOptIn(["--run"])).not.toThrow();
    for (const args of [[], ["--remote"], ["--run", "--remote"], ["--run", "DB"], ["--run", "--file=unsafe.sql"], ["--run", "--config=wrangler.jsonc"]]) {
      expect(() => assertOptIn(args)).toThrow("LOCAL_REHEARSAL_EXPLICIT_OPT_IN_REQUIRED");
    }
  });

  it("rejects remote input at the executable entry before any rehearsal output", () => {
    const result = spawnSync(process.execPath, [resolve("scripts/cst-local-d1-recovery.mjs"), "--run", "--remote"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("LOCAL_REHEARSAL_EXPLICIT_OPT_IN_REQUIRED");
  });

  it("accepts only the exact bounded backup bytes inside the owned directory", () => {
    const directory = workspace();
    const file = join(directory, "backup.sql");
    const bytes = Buffer.from("CREATE TABLE synthetic(id TEXT PRIMARY KEY);\n");
    writeFileSync(file, bytes, { mode: 0o600 });
    expect(readVerifiedBackup(directory, file, digestBytes(bytes))).toEqual(bytes);
    writeFileSync(file, Buffer.concat([bytes, Buffer.from("INVALID SQL")]));
    expect(() => readVerifiedBackup(directory, file, digestBytes(bytes))).toThrow("BACKUP_DIGEST_MISMATCH");
  });

  it("rejects missing, outside, symlink and oversized backups before import", () => {
    const directory = workspace();
    const other = workspace();
    const source = join(other, "outside.sql");
    writeFileSync(source, "SELECT 1;", { mode: 0o600 });
    expect(() => readVerifiedBackup(directory, join(directory, "missing.sql"), "0".repeat(64))).toThrow("BACKUP_UNAVAILABLE");
    expect(() => readVerifiedBackup(directory, source, "0".repeat(64))).toThrow("BACKUP_OUTSIDE_WORKSPACE");
    const link = join(directory, "linked.sql");
    symlinkSync(source, link);
    expect(() => readVerifiedBackup(directory, link, "0".repeat(64))).toThrow("BACKUP_UNAVAILABLE");
    const huge = join(directory, "oversized.sql");
    writeFileSync(huge, Buffer.alloc(32 * 1024 * 1024 + 1));
    expect(() => readVerifiedBackup(directory, huge, "0".repeat(64))).toThrow("BACKUP_SIZE_LIMIT");
  });

  it("rejects a missing domain table, trigger or domain row even when the fixture survived", () => {
    const project = {
      schemaObjects: [
        { type: "table", name: "domain", tableName: "domain", sqlSha256: digestBytes("domain schema") },
        { type: "trigger", name: "domain_guard", tableName: "domain", sqlSha256: digestBytes("trigger schema") },
      ],
      tables: [{ name: "domain", rowCount: 1, rowDigest: digestBytes("domain row") }],
    };
    const expected = { quickCheck: "ok", foreignKeys: [], counts: { categories: 1, places: 1, links: 1 }, rows: [{ id: "category" }, { id: "place" }, { id: "link" }], project };
    expect(() => compareSnapshots(expected, structuredClone(expected))).not.toThrow();
    for (const changed of [
      { ...project, schemaObjects: project.schemaObjects.filter((object) => object.type !== "table") },
      { ...project, schemaObjects: project.schemaObjects.filter((object) => object.type !== "trigger") },
      { ...project, tables: [{ ...project.tables[0], rowCount: 0, rowDigest: digestBytes("empty") }] },
      { ...project, tables: [{ ...project.tables[0], rowDigest: digestBytes("changed row") }] },
    ]) expect(() => compareSnapshots(expected, { ...expected, project: changed })).toThrow("RESTORE_VERIFICATION_FAILED");
  });

  it("fails on integrity, foreign keys, missing rows or changed restored content", () => {
    const expected = { quickCheck: "ok", foreignKeys: [], counts: { categories: 1, places: 1, links: 1 }, rows: [{ kind: "category", id: "category", value: "synthetic" }, { kind: "link", id: "synthetic", value: "category" }, { kind: "place", id: "synthetic", value: "before" }] };
    expect(() => compareSnapshots(expected, structuredClone(expected))).not.toThrow();
    for (const changed of [
      { ...expected, quickCheck: "corrupt" },
      { ...expected, foreignKeys: [{ table: "place_categories" }] },
      { ...expected, counts: { ...expected.counts, places: 0 } },
      { ...expected, rows: expected.rows.map((row) => row.kind === "place" ? { ...row, value: "after" } : row) },
    ]) expect(() => compareSnapshots(expected, changed)).toThrow("RESTORE_VERIFICATION_FAILED");
  });
});
