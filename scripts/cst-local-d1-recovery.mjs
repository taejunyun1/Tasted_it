import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, chmodSync, copyFileSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIXTURE_ID = "cst-recovery-place";
const CATEGORY_ID = "cst-recovery-category";
const INITIAL_NAME = "CST synthetic before";
const SEED_SQL = `
INSERT INTO categories(id,slug,name,emoji,sort_order,created_at,updated_at) VALUES('${CATEGORY_ID}','${CATEGORY_ID}','CST synthetic category','C',999,'2026-11-13','2026-11-13');
INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES('${FIXTURE_ID}','${FIXTURE_ID}','${INITIAL_NAME}','DRAFT','synthetic address','synthetic area',35.15,126.85,'CST synthetic','2026-11-13','2026-11-13');
INSERT INTO place_categories(place_id,category_id,is_primary) VALUES('${FIXTURE_ID}','${CATEGORY_ID}',1);
`;
const SNAPSHOT_SQL = `
PRAGMA quick_check;
PRAGMA foreign_key_check;
SELECT (SELECT count(*) FROM categories WHERE id='${CATEGORY_ID}') AS categories,
       (SELECT count(*) FROM places WHERE id='${FIXTURE_ID}') AS places,
       (SELECT count(*) FROM place_categories WHERE place_id='${FIXTURE_ID}' AND category_id='${CATEGORY_ID}') AS links;
SELECT 'category' AS kind,id,name AS value FROM categories WHERE id='${CATEGORY_ID}'
UNION ALL SELECT 'place',id,name FROM places WHERE id='${FIXTURE_ID}'
UNION ALL SELECT 'link',place_id,category_id FROM place_categories WHERE place_id='${FIXTURE_ID}' AND category_id='${CATEGORY_ID}'
ORDER BY kind,id;
`;

export function assertOptIn(args) {
  if (args.length !== 1 || args[0] !== "--run") throw new Error("LOCAL_REHEARSAL_EXPLICIT_OPT_IN_REQUIRED");
}

export function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readVerifiedBackup(ownedDirectory, file, expectedDigest) {
  const lexical = relative(resolve(ownedDirectory), resolve(file));
  if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) throw new Error("BACKUP_OUTSIDE_WORKSPACE");
  let fd;
  try {
    const root = realpathSync(ownedDirectory);
    let part = root;
    for (const segment of lexical.split(sep)) {
      part = join(part, segment);
      if (lstatSync(part).isSymbolicLink()) throw new Error("BACKUP_UNAVAILABLE");
    }
    fd = openSync(part, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("BACKUP_UNAVAILABLE");
    if (stat.size === 0 || stat.size > MAX_BACKUP_BYTES) throw new Error("BACKUP_SIZE_LIMIT");
    const bytes = readFileSync(fd);
    if (bytes.length > MAX_BACKUP_BYTES) throw new Error("BACKUP_SIZE_LIMIT");
    if (digestBytes(bytes) !== expectedDigest) throw new Error("BACKUP_DIGEST_MISMATCH");
    return bytes;
  } catch (error) {
    if (["BACKUP_SIZE_LIMIT", "BACKUP_DIGEST_MISMATCH", "BACKUP_UNAVAILABLE"].includes(error?.message)) throw error;
    throw new Error("BACKUP_UNAVAILABLE");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function compareSnapshots(expected, restored) {
  const valid = (snapshot) => snapshot?.quickCheck === "ok"
    && Array.isArray(snapshot.foreignKeys) && snapshot.foreignKeys.length === 0
    && snapshot.counts?.categories === 1 && snapshot.counts?.places === 1 && snapshot.counts?.links === 1
    && Array.isArray(snapshot.rows) && snapshot.rows.length === 3;
  if (!valid(expected) || !valid(restored)
    || JSON.stringify(expected.counts) !== JSON.stringify(restored.counts)
    || digestBytes(JSON.stringify(expected.rows)) !== digestBytes(JSON.stringify(restored.rows))) {
    throw new Error("RESTORE_VERIFICATION_FAILED");
  }
}

function writeNew(file, content, mode = 0o600) {
  writeFileSync(file, content, { flag: "wx", mode });
}

function snapshotFromJson(output) {
  const blocks = JSON.parse(output);
  if (!Array.isArray(blocks) || blocks.length !== 4 || blocks.some((block) => block.success !== true || !Array.isArray(block.results))) throw new Error("LOCAL_QUERY_RESULT_INVALID");
  return {
    quickCheck: Object.values(blocks[0].results[0] ?? {})[0],
    foreignKeys: blocks[1].results,
    counts: blocks[2].results[0],
    rows: blocks[3].results,
  };
}

// The D1 authorizer rejects integrity_check. Check only an owned scratch copy;
// the original generated database is never opened by the SQLite API.
async function copiedIntegrity(directory, runDirectory, label) {
  const databaseDirectory = join(directory, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  const files = readdirSync(databaseDirectory).filter((file) => /^[0-9a-f]{64}\.sqlite$/u.test(file));
  if (files.length !== 1) throw new Error("LOCAL_DATABASE_FILE_AMBIGUOUS");
  const scratch = join(runDirectory, `integrity-${label}`);
  mkdirSync(scratch, { mode: 0o700 });
  let copiedBytes = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = join(databaseDirectory, `${files[0]}${suffix}`);
    if (!existsSync(source)) continue;
    const stat = lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("LOCAL_DATABASE_FILE_INVALID");
    copiedBytes += stat.size;
    if (copiedBytes > 64 * 1024 * 1024) throw new Error("LOCAL_DATABASE_COPY_LIMIT");
    const destination = join(scratch, `${files[0]}${suffix}`);
    copyFileSync(source, destination, constants.COPYFILE_EXCL);
    chmodSync(destination, 0o600);
  }
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(join(scratch, files[0]), { readOnly: true });
  try {
    const rows = database.prepare("PRAGMA integrity_check").all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok") throw new Error("COPIED_DATABASE_INTEGRITY_FAILED");
    return { status: "ok", mode: "READ_ONLY_SCRATCH_COPY", copiedBytes };
  } finally { database.close(); }
}

export async function runRehearsal() {
  const wrangler = join(PROJECT_ROOT, "node_modules/wrangler/bin/wrangler.js");
  if (!existsSync(wrangler)) throw new Error("LOCAL_WRANGLER_NOT_INSTALLED");
  const runDirectory = mkdtempSync(join(realpathSync(tmpdir()), "cst-local-d1-recovery-"));
  chmodSync(runDirectory, 0o700);
  const sourceDirectory = join(runDirectory, "source");
  const destinationDirectory = join(runDirectory, "restored");
  const stages = [];
  const migrationsDirectory = join(PROJECT_ROOT, "drizzle");
  const migrations = readdirSync(migrationsDirectory).filter((file) => /^\d+.*\.sql$/u.test(file)).sort()
    .map((file) => ({ file, sha256: digestBytes(readFileSync(join(migrationsDirectory, file))) }));
  for (const directory of [sourceDirectory, destinationDirectory]) {
    mkdirSync(directory, { mode: 0o700 });
    writeNew(join(directory, "wrangler.json"), JSON.stringify({
      name: "cst-local-d1-rehearsal",
      compatibility_date: "2026-08-05",
      send_metrics: false,
      d1_databases: [{ binding: "DB", database_name: "cst-local-d1-rehearsal", database_id: randomUUID(), migrations_dir: migrationsDirectory }],
    }, null, 2));
  }
  // No caller-supplied DB, config, SQL, flags, environment credentials or shell.
  function local(directory, stage, args) {
    if (!args.includes("--local") || args.includes("--remote")) throw new Error("LOCAL_COMMAND_REQUIRED");
    const result = spawnSync(process.execPath, [wrangler, ...args, "--config", join(directory, "wrangler.json")], {
      cwd: directory,
      env: { PATH: process.env.PATH ?? "", CI: "1", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" },
      encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 120_000,
    });
    stages.push(stage);
    if (result.status !== 0 || result.error) throw new Error(`LOCAL_D1_COMMAND_FAILED_${stage}`);
    return result.stdout;
  }
  function snapshot(directory, stage) {
    return snapshotFromJson(local(directory, stage, ["d1", "execute", "DB", "--local", "--command", SNAPSHOT_SQL, "--json"]));
  }
  const report = { schemaVersion: 1, mode: "LOCAL_SYNTHETIC", status: "IN_PROGRESS", createdAt: new Date().toISOString(), sourceSha: null, migrations, stages, runDirectory };
  try {
    const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8" });
    if (git.status !== 0 || !/^[0-9a-f]{40}$/u.test(git.stdout.trim())) throw new Error("SOURCE_SHA_UNAVAILABLE");
    report.sourceSha = git.stdout.trim();
    report.scriptSha256 = digestBytes(readFileSync(fileURLToPath(import.meta.url)));
    local(sourceDirectory, "MIGRATE_SOURCE", ["d1", "migrations", "apply", "DB", "--local"]);
    const seed = join(sourceDirectory, "synthetic.sql");
    writeNew(seed, SEED_SQL);
    local(sourceDirectory, "SEED_SOURCE", ["d1", "execute", "DB", "--local", "--file", seed]);
    const expected = snapshot(sourceDirectory, "SNAPSHOT_SOURCE");
    compareSnapshots(expected, expected);
    const sourceIntegrity = await copiedIntegrity(sourceDirectory, runDirectory, "source");
    const backup = join(runDirectory, "backup.sql");
    local(sourceDirectory, "EXPORT_BACKUP", ["d1", "export", "DB", "--local", "--output", backup]);
    chmodSync(backup, 0o600);
    const backupBytes = readFileSync(backup);
    const backupSha256 = digestBytes(backupBytes);
    readVerifiedBackup(runDirectory, backup, backupSha256);
    local(sourceDirectory, "MUTATE_SOURCE", ["d1", "execute", "DB", "--local", "--command", `UPDATE places SET name='CST synthetic changed' WHERE id='${FIXTURE_ID}'`]);
    const changed = snapshot(sourceDirectory, "SNAPSHOT_CHANGED_SOURCE");
    if (digestBytes(JSON.stringify(expected.rows)) === digestBytes(JSON.stringify(changed.rows))) throw new Error("SOURCE_MUTATION_NOT_OBSERVED");
    // Import an exclusive validated copy, never a path supplied by the caller.
    const importFile = join(destinationDirectory, "validated-backup.sql");
    writeNew(importFile, readVerifiedBackup(runDirectory, backup, backupSha256), 0o400);
    local(destinationDirectory, "IMPORT_RESTORED", ["d1", "execute", "DB", "--local", "--file", importFile]);
    const restored = snapshot(destinationDirectory, "SNAPSHOT_RESTORED");
    compareSnapshots(expected, restored);
    const restoredIntegrity = await copiedIntegrity(destinationDirectory, runDirectory, "restored");
    const corrupt = join(runDirectory, "corrupt-backup.sql");
    writeNew(corrupt, Buffer.concat([backupBytes, Buffer.from("\nINVALID SYNTHETIC BACKUP;\n")]));
    const guards = [];
    for (const [name, file, code] of [["CORRUPT_BACKUP", corrupt, "BACKUP_DIGEST_MISMATCH"], ["MISSING_BACKUP", join(runDirectory, "missing.sql"), "BACKUP_UNAVAILABLE"]]) {
      try { readVerifiedBackup(runDirectory, file, backupSha256); throw new Error("INVALID_BACKUP_ACCEPTED"); }
      catch (error) { if (error.message !== code) throw error; guards.push({ name, status: "REJECTED_BEFORE_IMPORT", code }); }
    }
    Object.assign(report, { status: "PASS", backupSha256, backupBytes: backupBytes.length, sourceRowDigest: digestBytes(JSON.stringify(expected.rows)), restoredRowDigest: digestBytes(JSON.stringify(restored.rows)), counts: restored.counts, quickCheck: restored.quickCheck, physicalIntegrity: { source: sourceIntegrity, restored: restoredIntegrity }, foreignKeyViolations: restored.foreignKeys.length, sourceMutationObserved: true, guards });
  } catch (error) {
    Object.assign(report, { status: "FAIL", failureCode: /^([A-Z0-9_]+)$/u.test(error.message) ? error.message : "LOCAL_REHEARSAL_FAILED" });
  }
  writeNew(join(runDirectory, "result.json"), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertOptIn(process.argv.slice(2));
    const report = await runRehearsal();
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    console.error(/^[A-Z0-9_]+$/u.test(error.message) ? error.message : "LOCAL_REHEARSAL_FAILED");
    process.exitCode = 1;
  }
}
