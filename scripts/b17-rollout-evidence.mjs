import { createHash } from "node:crypto";

export const B17_MIGRATIONS = Object.freeze([
  "0050_admin_rating_job_control.sql", "0051_admin_public_sync.sql", "0052_admin_parking_job_control.sql",
  "0053_provider_usage.sql", "0054_admin_feature_stop.sql", "0055_admin_privacy_operations.sql",
  "0056_admin_reliability.sql", "0059_email_domain_control.sql", "0060_rating_config_eligibility.sql",
]);
export const B17_TABLES = Object.freeze([
  "admin_operations", "admin_operation_commits", "admin_operation_checks", "rating_recompute_jobs",
  "public_data_sync_runs", "parking_sync_runs", "reviewer_photo_cleanup_jobs",
]);
// Required pre-upgrade columns from migrations 0001/0005/0014/0027/0040/0042–0049.
// Extra columns supplied by a later baseline are also compared, never silently dropped.
export const B17_REQUIRED_COLUMNS = Object.freeze({
  admin_operations: Object.freeze(["rowid", "id", "kind", "actor_user_id", "session_id", "payload_json", "payload_hash", "summary_json", "requires_recent_auth", "status", "result_json", "created_at", "expires_at", "committed_at"]),
  admin_operation_commits: Object.freeze(["rowid", "operation_id", "actor_user_id", "session_id", "kind", "committed_at"]),
  admin_operation_checks: Object.freeze(["rowid", "operation_id", "check_name", "passed"]),
  rating_recompute_jobs: Object.freeze(["rowid", "id", "place_id", "config_id", "scope", "status", "reason", "attempts", "error_summary", "started_at", "finished_at", "created_at", "updated_at"]),
  public_data_sync_runs: Object.freeze(["rowid", "id", "source_type", "region_code", "address_field", "status", "next_page", "total_count", "fetched_count", "inserted_count", "updated_count", "skipped_count", "started_at", "finished_at", "error_summary", "created_at", "updated_at"]),
  parking_sync_runs: Object.freeze(["rowid", "id", "source", "status", "snapshot_id", "next_page", "total_count", "fetched_count", "accepted_count", "skipped_count", "started_at", "finished_at", "error_summary", "created_at", "updated_at"]),
  reviewer_photo_cleanup_jobs: Object.freeze(["rowid", "review_id", "object_keys_json", "next_attempt_at", "attempt_count", "created_at", "updated_at", "purpose"]),
});
const MAX_ROWS_PER_TABLE = 10_000, MAX_TOTAL_ROWS = 50_000, MAX_BYTES = 64 * 1024 * 1024;
const MAX_CELL_BYTES = 2 * 1024 * 1024, MAX_MISMATCHES = 100;
const encoder = new TextEncoder();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const plain = (value) => value !== null && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const failSnapshot = () => { throw new Error("B17_SNAPSHOT_INVALID"); };

function validateSnapshot(input, requireBaseline = false) {
  if (!plain(input) || !exactKeys(input, ["tables"]) || !plain(input.tables) || !exactKeys(input.tables, B17_TABLES)) failSnapshot();
  let totalRows = 0, totalBytes = 0;
  const result = new Map();
  for (const name of B17_TABLES) {
    const table = input.tables[name];
    if (!plain(table) || !exactKeys(table, ["columns", "rows"]) || !Array.isArray(table.columns)
      || table.columns.length < 1 || table.columns.length > 128 || !Array.isArray(table.rows)
      || table.rows.length > MAX_ROWS_PER_TABLE || (totalRows += table.rows.length) > MAX_TOTAL_ROWS) failSnapshot();
    if (!table.columns.every((column) => typeof column === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(column))
      || !table.columns.includes("rowid") || new Set(table.columns).size !== table.columns.length
      || requireBaseline && !B17_REQUIRED_COLUMNS[name].every((column) => table.columns.includes(column))) failSnapshot();
    const columns = [...table.columns].sort(), rows = new Map();
    for (const row of table.rows) {
      if (!plain(row) || !exactKeys(row, columns) || !Number.isSafeInteger(row.rowid) || row.rowid < 1 || rows.has(row.rowid)) failSnapshot();
      for (const column of columns) {
        const value = row[column];
        if (typeof value === "string") {
          const bytes = encoder.encode(value).byteLength;
          if (bytes > MAX_CELL_BYTES) failSnapshot();
          totalBytes += bytes;
        } else if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) totalBytes += 8;
        else failSnapshot();
        if (totalBytes > MAX_BYTES) failSnapshot();
      }
      rows.set(row.rowid, row);
    }
    result.set(name, { columns, rows });
  }
  return result;
}
function scalar(value) {
  return value === null ? ["null"] : typeof value === "number" ? ["number", Object.is(value, -0) ? "-0" : value] : [typeof value, value];
}
function tableHash(table, columns) {
  const digest = createHash("sha256").update(JSON.stringify(columns));
  for (const [rowid, row] of [...table.rows].sort(([left], [right]) => left - right)) {
    digest.update("\n" + JSON.stringify([rowid, ...columns.map((column) => scalar(row[column]))]));
  }
  return digest.digest("hex");
}

/** Synchronous and pure: safe for local Node tests and Workers-pool migration rehearsal. */
export function compareB17Snapshots(beforeInput, afterInput) {
  try {
    const before = validateSnapshot(beforeInput, true), after = validateSnapshot(afterInput);
    const mismatches = [], tables = [];
    let mismatchCount = 0;
    const mismatch = (location) => { mismatchCount++; if (mismatches.length < MAX_MISMATCHES) mismatches.push(location); };
    for (const name of B17_TABLES) {
      const old = before.get(name), next = after.get(name), start = mismatchCount;
      const missingColumns = old.columns.filter((column) => !next.columns.includes(column));
      for (const column of missingColumns) mismatch({ table: name, code: "COLUMN_MISSING", column });
      if (old.rows.size !== next.rows.size) mismatch({ table: name, code: "ROW_COUNT_MISMATCH" });
      for (const [rowid, row] of old.rows) {
        const found = next.rows.get(rowid);
        if (!found) { mismatch({ table: name, code: "ROW_MISSING", rowid }); continue; }
        for (const column of old.columns) if (!missingColumns.includes(column) && !Object.is(row[column], found[column]))
          mismatch({ table: name, code: "VALUE_MISMATCH", rowid, column });
      }
      for (const rowid of next.rows.keys()) if (!old.rows.has(rowid)) mismatch({ table: name, code: "ROW_ADDED", rowid });
      tables.push({ table: name, beforeCount: old.rows.size, afterCount: next.rows.size,
        beforeHash: tableHash(old, old.columns), afterHash: missingColumns.length ? null : tableHash(next, old.columns), ok: mismatchCount === start });
    }
    return { sourceKind: "LOCAL_PREPARATION", executed: false, schemaBaseline: "0049", ok: mismatchCount === 0, tables,
      mismatchCount, mismatchesTruncated: mismatchCount > MAX_MISMATCHES, mismatches };
  } catch { throw new Error("B17_SNAPSHOT_INVALID"); }
}

/** Node-only, read-only manifest. File/child-process modules load only when requested. */
export async function buildB17MigrationManifest(repositoryRoot) {
  try {
    if (typeof repositoryRoot !== "string" || !repositoryRoot || repositoryRoot.length > 4096 || repositoryRoot.includes("\0")) throw new Error();
    const [fs, path, child] = await Promise.all([import("node:fs/promises"), import("node:path"), import("node:child_process")]);
    const root = await fs.realpath(repositoryRoot), directory = path.join(root, "drizzle");
    if (!(await fs.lstat(directory)).isDirectory()) throw new Error();
    const actual = (await fs.readdir(directory)).filter((name) => name.toLowerCase().endsWith(".sql") && /^\d{4}/.test(name)
      && Number(name.slice(0, 4)) >= 50).sort();
    if (actual.length !== B17_MIGRATIONS.length || actual.some((name, index) => name !== [...B17_MIGRATIONS].sort()[index])) throw new Error();
    const git = (...args) => child.execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 5 * 1024 * 1024 });
    const sourceHead = git("rev-parse", "HEAD").toString("utf8").trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceHead)) throw new Error();
    const headNames = git("ls-tree", "--name-only", `${sourceHead}:drizzle`).toString("utf8").trim().split("\n");
    if (headNames.some((name) => name.toLowerCase().endsWith(".sql") && /^\d{4}/.test(name)
      && Number(name.slice(0, 4)) >= 50 && !B17_MIGRATIONS.includes(name))) throw new Error();
    const migrations = [];
    for (const name of B17_MIGRATIONS) {
      const relative = `drizzle/${name}`, file = path.join(directory, name), stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size < 1 || stat.size > 5 * 1024 * 1024) throw new Error();
      const content = await fs.readFile(file), after = await fs.lstat(file);
      if (content.byteLength !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino) throw new Error();
      let headBlob = null, headSha256 = null;
      try {
        headBlob = git("rev-parse", "--verify", `${sourceHead}:${relative}`).toString("utf8").trim();
        if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(headBlob)) throw new Error();
        headSha256 = hash(git("show", `${sourceHead}:${relative}`));
      } catch { headBlob = null; headSha256 = null; }
      const sha256 = hash(content);
      migrations.push({ name, path: relative, sizeBytes: content.byteLength, sha256, headBlob, headSha256, matchesHead: headSha256 === sha256 });
    }
    return { sourceKind: "LOCAL_PREPARATION", executed: false, ok: migrations.every((entry) => entry.matchesHead), sourceHead, migrations };
  } catch { throw new Error("B17_MIGRATION_MANIFEST_INVALID"); }
}

async function runCli(args) {
  const [command, ...flags] = args, options = Object.create(null);
  const expected = command === "manifest" ? ["--root"] : command === "compare" ? ["--before", "--after"] : [];
  if (!expected.length || flags.length !== expected.length * 2) throw new Error("B17_CLI_INPUT_INVALID");
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index], value = flags[index + 1];
    if (!expected.includes(key) || Object.hasOwn(options, key) || !value || value.startsWith("--")) throw new Error("B17_CLI_INPUT_INVALID");
    options[key] = value;
  }
  let report;
  if (command === "manifest") report = await buildB17MigrationManifest(options["--root"]);
  else {
    const fs = await import("node:fs/promises");
    const read = async (file) => {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("B17_SNAPSHOT_INVALID");
      const bytes = await fs.readFile(file);
      if (bytes.byteLength > MAX_BYTES) throw new Error("B17_SNAPSHOT_INVALID");
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    };
    const [before, after] = await Promise.all([read(options["--before"]), read(options["--after"])]);
    report = compareB17Snapshots(before, after);
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.ok === false ? 1 : 0;
}
// Merely importing the pure comparison does not read files or run subprocesses.
if (typeof process !== "undefined" && typeof process.argv?.[1] === "string"
  && process.argv[1].replaceAll("\\", "/").endsWith("/b17-rollout-evidence.mjs")) {
  const { pathToFileURL } = await import("node:url");
  if (pathToFileURL(process.argv[1]).href === import.meta.url) {
    try { await runCli(process.argv.slice(2)); }
    catch (error) {
      const known = ["B17_SNAPSHOT_INVALID", "B17_MIGRATION_MANIFEST_INVALID", "B17_CLI_INPUT_INVALID"];
      const code = error instanceof Error && known.includes(error.message) ? error.message : "B17_EVIDENCE_UNAVAILABLE";
      process.stdout.write(JSON.stringify({ sourceKind: "LOCAL_PREPARATION", executed: false, ok: false, error: code }) + "\n");
      process.exitCode = 2;
    }
  }
}
