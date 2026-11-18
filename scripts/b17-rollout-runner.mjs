import { createHash } from "node:crypto";
import { buildB17MigrationManifest, B17_MIGRATIONS } from "./b17-rollout-evidence.mjs";
import { describeB17PreservationCapture, verifyB17PreservationSources } from "./b17-preservation-evidence.mjs";

export const B17_LIMITS = Object.freeze({ http: 90, d1Commands: 50, manualSql: 180, migrationSql: 201, migrations: 9, exports: 1, sessions: 1, rsi: 1 });
export const B17_CLEANUP_RESERVE = Object.freeze({ d1Commands: 5, manualSql: 12 });
export const B17_STAGES = Object.freeze(["PREPARE", "AUTHORITY", "FENCE", "DRAIN", "BACKUP", "PRESERVATION_BEFORE", "MIGRATIONS", "PRESERVATION_AFTER", "SESSION", "GUARDED_TRANSITIONS", "NORMAL_DEPLOY", "LIVE_PROBES", "RSI", "CLEANUP"]);
export const B17_TARGET = Object.freeze({ repository: "taejunyun1/Tasted_it", accountId: "7543330c65069ee2df1b7b353fb0201c", worker: "retaste-beta", database: "retaste-production", databaseId: "5181489d-83a7-4f78-9384-db096cadaa2d", bucket: "retaste-review-photos", crons: ["17 18 * * *", "47 */6 * * *"] });
const checks = ["typecheck and unit", "integration", "build", "playwright smoke"];
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = code => { throw new Error(code); };

export class RolloutBudget {
  constructor(used = {}) {
    this.used = Object.fromEntries(Object.keys(B17_LIMITS).map(key => [key, 0]));
    this.consume(used, { cleanup: true });
  }
  consume(cost, { cleanup = false } = {}) {
    for (const [key, value] of Object.entries(cost)) {
      if (!Object.hasOwn(B17_LIMITS, key) || !Number.isSafeInteger(value) || value < 0) fail("B17_BUDGET_INVALID");
      const reserve = cleanup ? 0 : B17_CLEANUP_RESERVE[key] ?? 0;
      if (this.used[key] + value > B17_LIMITS[key] - reserve) fail("B17_BUDGET_EXCEEDED");
    }
    for (const [key, value] of Object.entries(cost)) this.used[key] += value;
  }
  snapshot() { return { ...this.used }; }
}

export function checkB17Authority(evidence, sourceSha) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !evidence || evidence.localHead !== sourceSha || evidence.mainHead !== sourceSha || evidence.clean !== true
    || evidence.pullRequest?.number !== 470 || evidence.pullRequest.merged !== true || evidence.pullRequest.base?.ref !== "main" || evidence.pullRequest.merge_commit_sha !== sourceSha
    || !/^[a-f0-9]{40}$/.test(evidence.pullRequest.head?.sha ?? "") || !/^[a-f0-9]{40}$/.test(evidence.sourceTree ?? "") || evidence.sourceTree !== evidence.prTree
    || !Array.isArray(evidence.checks)) fail("B17_AUTHORITY_NOT_VERIFIED");
  for (const name of checks) {
    const rows = evidence.checks.filter(row => row.name === name);
    if (rows.length !== 1 || rows[0].head_sha !== evidence.pullRequest.head.sha || rows[0].status !== "completed" || rows[0].conclusion !== "success") fail("B17_AUTHORITY_NOT_VERIFIED");
  }
  return true;
}

export function classifyB17Drain(evidence, versions) {
  // Completion-only Wrangler tail has no exhaustive inventory of in-flight HTTP/R2.
  // Elapsed cron limits, operator booleans and arbitrary JSON are never that inventory.
  return { status: "UNKNOWN", canMigrate: false, reason: "LIVE_HTTP_DRAIN_OBSERVATION_REQUIRED", previousVersion: versions.previousVersion, fenceVersion: versions.fenceVersion };
}

export function buildB17CostPlan(preservation = describeB17PreservationCapture()) {
  const p = preservation.perPhase;
  const capture = { d1Commands: p.catalogD1Commands + p.captureD1Commands, manualSql: p.catalogSqlStatements + p.captureSqlStatements };
  const success = { http: 61, d1Commands: 28 + 2 * capture.d1Commands, manualSql: 42 + 2 * capture.manualSql, migrationSql: 201, migrations: 9, exports: 1, sessions: 1, rsi: 1 };
  const normal = { ...success, d1Commands: success.d1Commands - 3, manualSql: success.manualSql - 7 };
  const budget = new RolloutBudget(); budget.consume(normal); budget.consume({ d1Commands: 3, manualSql: 7 }, { cleanup: true });
  return { simulationOnly: true, capturePerPhase: capture, success: budget.snapshot(),
    reservedWorstCase: { ...success, d1Commands: normal.d1Commands + 5, manualSql: normal.manualSql + 12 },
    aggregateSqlSuccess: success.manualSql + 201, aggregateSqlLimit: 381,
    httpAllocation: "5 fence probes + 55 reserved read/deny/preview probes + 1 RSI trigger; post-drain probe execution is not implemented" };
}

export async function prepareB17Rollout({ root }) {
  const manifest = await buildB17MigrationManifest(root);
  await verifyB17PreservationSources(root);
  const preservation = describeB17PreservationCapture();
  const { readD1Migrations } = await import("@cloudflare/vitest-pool-workers");
  const migrations = await readD1Migrations(`${root}/drizzle`);
  const selected = B17_MIGRATIONS.map(name => migrations.find(row => row.name === name));
  if (!manifest.ok || selected.some(row => !row)) fail("B17_MIGRATION_MANIFEST_INVALID");
  const counts = selected.map(row => row.queries.length);
  if (counts.join(",") !== "29,28,27,11,24,32,22,26,2") fail("B17_MIGRATION_COST_CHANGED");
  return { mode: "LOCAL_PREPARATION", executed: false, sourceSha: manifest.sourceHead, stages: B17_STAGES,
    implementedCommands: ["prepare", "preflight"], postDrainExecutionImplemented: false, preservation, costModel: buildB17CostPlan(preservation),
    limits: B17_LIMITS, cleanupReserve: B17_CLEANUP_RESERVE, migrationCount: 9, migrationSql: counts.reduce((a, b) => a + b, 0),
    migrations: manifest.migrations.map((row, index) => ({ name: row.name, sha256: row.sha256, statements: counts[index] })),
    blockers: ["MERGED_MAIN_AND_EXACT_FOUR_CI_REQUIRED", "CURRENT_RUNTIME_BINDINGS_VARS_CRONS_REQUIRED", "LIVE_HTTP_DRAIN_OBSERVATION_REQUIRED", "LIVE_CONTINUATION_UNAVAILABLE"],
    costUnits: { http: "application HTTP probes (including RSI trigger); CLI control-plane traffic is separately recorded, not mislabeled as probes", d1Commands: "D1 management invocations", manualSql: "explicit administrative/capture statements and migration bookkeeping", migrationSql: "fixed nine file statements counted by readD1Migrations" } };
}

const iso = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = values => [...values].sort();
export function validateB17Input(value) {
  const keys = ["sourceSha", "previousVersion", "operatorId", "legacyRunId", "quotaCutover", "budgetPolicy"];
  if (!value || Object.keys(value).some(key => !keys.includes(key)) || !/^[a-f0-9]{40}$/.test(value.sourceSha ?? "")
    || !uuid(value.previousVersion) || !identifier(value.operatorId) || value.legacyRunId !== null && !identifier(value.legacyRunId)
    || !["HOLD", "APPLY"].includes(value.quotaCutover) || value.budgetPolicy !== "MANUAL_180_INCLUDES_BOOKKEEPING_MIGRATION_201") fail("B17_INPUT_INVALID");
  return value;
}

/** This validates actual responses, not booleans supplied in a manifest. */
export function checkB17Runtime(runtime, config, expectedVersion, maintenance = false) {
  const active = runtime?.deployment?.versions?.filter(row => row.percentage > 0);
  if (!uuid(expectedVersion) || active?.length !== 1 || active[0].version_id !== expectedVersion || active[0].percentage !== 100
    || runtime.version?.id !== expectedVersion || !iso(runtime.version?.metadata?.created_on)
    || !same(sorted(runtime.crons ?? []), sorted(B17_TARGET.crons))) fail("B17_RUNTIME_NOT_VERIFIED");
  const bindings = runtime.version.resources?.bindings;
  if (!Array.isArray(bindings) || config.name !== B17_TARGET.worker) fail("B17_RUNTIME_NOT_VERIFIED");
  const db = bindings.filter(row => row.type === "d1" && row.name === "DB"), bucket = bindings.filter(row => row.type === "r2_bucket" && row.name === "REVIEW_PHOTOS");
  if (db.length !== 1 || db[0].id !== B17_TARGET.databaseId || bucket.length !== 1 || bucket[0].bucket_name !== B17_TARGET.bucket
    || bindings.filter(row => row.type === "d1").length !== 1 || bindings.filter(row => row.type === "r2_bucket").length !== 1
    || bindings.some(row => !["d1", "r2_bucket", "plain_text", "json", "secret_text", "assets"].includes(row.type))) fail("B17_RUNTIME_NOT_VERIFIED");
  const vars = Object.fromEntries(bindings.filter(row => row.type === "plain_text").map(row => [row.name, row.text]));
  for (const [key, value] of Object.entries(config.vars ?? {})) {
    if (vars[key] !== (key === "CST_MAINTENANCE" ? String(maintenance) : value)) fail("B17_RUNTIME_NOT_VERIFIED");
  }
  if (vars.CST_MAINTENANCE !== String(maintenance)) fail("B17_RUNTIME_NOT_VERIFIED");
  const runtimeFlags = sorted(runtime.version.resources?.script_runtime?.compatibility_flags ?? []);
  if (!same(runtimeFlags, sorted(config.compatibility_flags ?? [])) || runtime.version.resources?.script_runtime?.compatibility_date !== config.compatibility_date) fail("B17_RUNTIME_NOT_VERIFIED");
  return { version: expectedVersion, createdAt: runtime.version.metadata.created_on, bindingDigest: hash(JSON.stringify(bindings.map(({ type, name, id, bucket_name }) => ({ type, name, id, bucket_name })))) };
}

/** Native CLI only. Callers cannot supply executable names, arbitrary commands, SQL or JS. */
export async function createB17LiveAdapter({ root, privateDirectory, input, exec: testExec }) {
  validateB17Input(input);
  const fs = await import("node:fs/promises"), path = await import("node:path");
  const realRoot = await fs.realpath(root), directory = await fs.realpath(privateDirectory);
  if (directory === realRoot || directory.startsWith(realRoot + path.sep)) fail("B17_PRIVATE_DIRECTORY_INVALID");
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) fail("B17_PRIVATE_DIRECTORY_INVALID");
  const cli = path.join(realRoot, "node_modules/wrangler/bin/wrangler.js");
  const configPath = path.join(realRoot, "wrangler.jsonc");
  let controlCalls = 0, artifact;
  const deadline = Date.now() + 30 * 60_000;
  const childEnvironment = { ...process.env, WRANGLER_WRITE_LOGS: "false", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_ACCOUNT_ID: B17_TARGET.accountId, CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: configPath };
  delete childEnvironment.RETASTE_E2E;
  delete childEnvironment.BASE_URL;
  const nativeExec = async (file, args, { stdin = "", timeout = 60_000, maxBuffer = 8 * 1024 * 1024 } = {}) => {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      if (Date.now() >= deadline) return reject(new Error("B17_DEADLINE_EXCEEDED"));
      const child = execFile(file, args, { cwd: realRoot, env: childEnvironment, timeout: Math.min(timeout, deadline - Date.now()), maxBuffer, killSignal: "SIGTERM" }, (error, stdout) => {
        // Never include stderr, stdout, argv, SQL or environment in a public error.
        if (error) reject(new Error(error.killed ? "B17_COMMAND_OUTCOME_UNKNOWN" : "B17_COMMAND_FAILED"));
        else resolve(stdout);
      });
      child.stdin?.end(stdin);
    });
  };
  const run = async (file, args, options = {}) => {
    try { return await (testExec ?? nativeExec)(file, args, { ...options, env: childEnvironment }); }
    catch (error) { fail(/^B17_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "B17_COMMAND_FAILED"); }
  };
  const wrangler = async (args, options) => { controlCalls++; return run(process.execPath, [cli, ...args, "--config", configPath], options); };
  const json = value => { try { return JSON.parse(value); } catch { fail("B17_COMMAND_RESPONSE_INVALID"); } };
  const gh = async endpoint => { controlCalls++; return json(await run("gh", ["api", `repos/${B17_TARGET.repository}/${endpoint}`])); };
  const curl = async ({ url, method = "GET", headers = {}, body = "", maxBytes = 2 * 1024 * 1024 }) => {
    const quote = value => {
      if (typeof value !== "string" || /[\r\n\0]/.test(value)) fail("B17_HTTP_INPUT_INVALID");
      return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    };
    const configuration = [`url = ${quote(url)}`, `request = ${quote(method)}`, "silent", "show-error", "include", "max-time = 45", "max-redirs = 0", "proto = \"=https\"", ...Object.entries(headers).map(([key, value]) => `header = ${quote(`${key}: ${value}`)}`), ...(body ? [`data = ${quote(body)}`] : [])].join("\n");
    const raw = await run("curl", ["--config", "-", "--suppress-connect-headers"], { stdin: configuration, timeout: 50_000, maxBuffer: maxBytes });
    const match = raw.match(/^HTTP\/\S+ (\d{3})[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
    if (!match) fail("B17_HTTP_RESPONSE_INVALID");
    return { status: Number(match[1]), headers: Object.fromEntries(match[2].split(/\r?\n/).map(line => { const i = line.indexOf(":"); return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()]; })), body: match[3] };
  };
  const cfGet = async suffix => {
    const credentials = json(await wrangler(["auth", "token", "--json"]));
    if (!["api_token", "oauth"].includes(credentials.type) || typeof credentials.token !== "string" || !credentials.token || /[\r\n\0]/.test(credentials.token)) fail("B17_EXISTING_BEARER_REQUIRED");
    controlCalls++;
    const response = await curl({ url: `https://api.cloudflare.com/client/v4/accounts/${B17_TARGET.accountId}/workers/scripts/${B17_TARGET.worker}/${suffix}`, headers: { Authorization: `Bearer ${credentials.token}` } });
    const value = json(response.body);
    if (response.status !== 200 || value.success !== true) fail("B17_CONTROL_RESPONSE_INVALID");
    return value.result;
  };
  const d1 = async sql => {
    // Only bounded fixed read queries use this adapter; --file may invoke an
    // import/upload/poll protocol with different accounting in pinned Wrangler.
    if (!/^(SELECT|WITH)\b/i.test(sql.trim()) || Buffer.byteLength(sql) > 90 * 1024) fail("B17_READ_QUERY_INVALID");
    const result = json(await wrangler(["d1", "execute", "DB", "--remote", "--command", sql, "--json"], { maxBuffer: 16 * 1024 * 1024 }));
    if (!Array.isArray(result) || result.some(row => row.success !== true || !Array.isArray(row.results))) fail("B17_D1_RESPONSE_INVALID");
    return result;
  };
  return {
    kind: "LIVE_CLI",
    controlCalls: () => controlCalls,
    async authority() {
      const localHead = (await run("git", ["rev-parse", "HEAD"])).trim();
      const clean = !(await run("git", ["status", "--porcelain"])).trim();
      const pullRequest = await gh("pulls/470"), main = await gh("branches/main");
      const checksResult = await gh(`commits/${pullRequest.head?.sha}/check-runs?per_page=100`);
      if (checksResult.total_count > 100) fail("B17_CI_RESPONSE_INCOMPLETE");
      const prCommit = await gh(`git/commits/${pullRequest.head?.sha}`);
      const sourceTree = (await run("git", ["rev-parse", "HEAD^{tree}"])).trim();
      const policy = await run("git", ["show", "HEAD:docs/operations/2026-11-18-admin-b17-rollout.md"]);
      if (!policy.includes("381") || !policy.includes("201")) fail("B17_BUDGET_PLAN_NOT_MERGED");
      return { localHead, clean, sourceTree, prTree: prCommit.tree?.sha, mainHead: main.commit?.sha, pullRequest, checks: checksResult.check_runs };
    },
    async build() {
      await run("pnpm", ["install", "--frozen-lockfile"], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
      await run("pnpm", ["run", "build"], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
      const config = json(await fs.readFile(path.join(realRoot, "build/server/wrangler.json"), "utf8"));
      if (config.name !== B17_TARGET.worker || config.vars?.CST_MAINTENANCE !== "false" || !same(sorted(config.triggers?.crons ?? []), sorted(B17_TARGET.crons))
        || config.d1_databases?.length !== 1 || config.d1_databases[0].database_id !== B17_TARGET.databaseId || config.r2_buckets?.length !== 1 || config.r2_buckets[0].bucket_name !== B17_TARGET.bucket) fail("B17_BUILD_CONFIG_INVALID");
      const files = [];
      const visit = async dir => { for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) fail("B17_BUILD_SYMLINK");
        if (entry.isDirectory()) await visit(file); else if (entry.isFile()) files.push([path.relative(realRoot, file), hash(await fs.readFile(file))]);
      } };
      await visit(path.join(realRoot, "build"));
      artifact = { config, digest: hash(JSON.stringify(files)), files };
      return artifact;
    },
    async runtime() {
      const deployment = json(await wrangler(["deployments", "status", "--name", B17_TARGET.worker, "--json"]));
      const versions = deployment?.versions?.filter(row => row.percentage > 0);
      if (versions?.length !== 1 || !uuid(versions[0].version_id)) fail("B17_DEPLOYMENT_AMBIGUOUS");
      const version = json(await wrangler(["versions", "view", versions[0].version_id, "--name", B17_TARGET.worker, "--json"]));
      const schedules = await cfGet("schedules");
      if (!Array.isArray(schedules?.schedules)) fail("B17_SCHEDULE_RESPONSE_INVALID");
      return { deployment, version, crons: schedules.schedules.map(row => row.cron) };
    },
    async observeDrain(versions) { return classifyB17Drain(null, versions); },
    async migrationLedger() {
      const expected = (await fs.readdir(path.join(realRoot, "drizzle"))).filter(name => /^\d{4}.*\.sql$/.test(name)).sort();
      const rows = await d1("SELECT name FROM d1_migrations ORDER BY name;");
      return { expected, applied: rows[0].results.map(row => row.name) };
    },
    d1,

  };
}

/** Read-only remote preflight. There is deliberately no live mutation entrypoint. */
export async function executeB17Preflight({ input, prepared }, adapter) {
  validateB17Input(input);
  if (prepared.sourceSha !== input.sourceSha || prepared.migrationSql !== 201) fail("B17_SOURCE_CHANGED");
  const budget = new RolloutBudget();
  try {
    checkB17Authority(await adapter.authority(), input.sourceSha);
    const artifact = await adapter.build();
    checkB17Runtime(await adapter.runtime(), artifact.config, input.previousVersion, false);
    budget.consume({ d1Commands: 1, manualSql: 1 });
    const ledger = await adapter.migrationLedger();
    if (!same(sorted(ledger.expected), sorted([...ledger.applied, ...B17_MIGRATIONS])) || ledger.applied.some(name => B17_MIGRATIONS.includes(name))) fail("B17_PENDING_MIGRATIONS_CHANGED");
    checkB17Authority(await adapter.authority(), input.sourceSha);
    return { mode: "LIVE_PREFLIGHT_HOLD", executed: false, remoteReadsPerformed: true, sourceSha: input.sourceSha, budget: budget.snapshot(),
      controlPlaneCliCalls: adapter.controlCalls(), error: "LIVE_CONTINUATION_UNAVAILABLE",
      next: "No fence, schema or data change was made. Exhaustive HTTP/R2 drain proof and a supported continuation remain required." };
  } catch (error) {
    return { mode: "LIVE_PREFLIGHT_FAILED", executed: false, sourceSha: input.sourceSha, budget: budget.snapshot(),
      controlPlaneCliCalls: adapter.controlCalls(), error: /^B17_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "B17_PREFLIGHT_FAILED" };
  }
}

/** No live adapter enters this continuation. It tests the fixed post-drain contract. */
export async function rehearseB17Lifecycle({ captureCosts, failAt = null }, fixture) {
  if (fixture.kind !== "SYNTHETIC_LOCAL" || !Array.isArray(captureCosts) || captureCosts.length !== 2) fail("B17_REHEARSAL_INPUT_INVALID");
  const budget = new RolloutBudget();
  let session = false, stage = "PREPARE", result;
  const startedAt = fixture.now?.() ?? Date.now();
  const step = async (name, cost = {}) => {
    stage = name;
    if ((fixture.now?.() ?? Date.now()) - startedAt >= 30 * 60_000) fail("B17_DEADLINE_EXCEEDED");
    budget.consume(cost); if (name === failAt) fail("B17_SYNTHETIC_FAILURE"); await fixture.perform(name);
  };
  try {
    await step("AUTHORITY", { d1Commands: 1, manualSql: 1 }); await step("FENCE", { http: 5 }); await step("DRAIN");
    await step("BACKUP", { d1Commands: 2, exports: 1 });
    await step("PRESERVATION_BEFORE", captureCosts[0]);
    // Wrangler's successful fixed-nine apply: CREATE+SELECT+9 INSERT bookkeeping,
    // 11 D1 requests; the 201 immutable migration-body statements stay separate.
    await step("MIGRATIONS", { d1Commands: 11, manualSql: 11, migrationSql: 201, migrations: 9 });
    await step("PRESERVATION_AFTER", captureCosts[1]);
    await step("VERIFY_SCHEMA", { d1Commands: 1, manualSql: 7 });
    budget.consume({ d1Commands: 1, manualSql: 2, sessions: 1 });
    // Mark before the request: a lost response may still have created the exact ID.
    session = true; await step("SESSION");
    await step("LEGACY_TRANSITION", { d1Commands: 4, manualSql: 6 });
    await step("QUOTA_TRANSITION", { d1Commands: 4, manualSql: 7 });
    await step("NORMAL_DEPLOY");
    // 6 public+11 admin reads, anonymous denies, safe invalid requests and previews.
    await step("LIVE_PROBES", { http: 55 });
    await step("RSI", { http: 1, rsi: 1, d1Commands: 1, manualSql: 1 });
    result = { mode: "SIMULATED_COMPLETE", executed: false };
  } catch (error) {
    await fixture.perform("KEEP_FENCE");
    result = { mode: "SIMULATED_HOLD", executed: false, failedStage: stage, error: error.message };
  } finally {
    if (session) {
      budget.consume({ d1Commands: 3, manualSql: 7 }, { cleanup: true });
      await fixture.perform("CLEANUP");
    }
  }
  return { ...result, budget: budget.snapshot() };
}

async function main(args) {
  const [command = "prepare", ...flags] = args;
  const allowed = command === "prepare" ? ["--root"] : command === "preflight" ? ["--root", "--input", "--private-dir"] : [];
  if (!allowed.length || flags.length % 2) fail("B17_CLI_INPUT_INVALID");
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    if (!allowed.includes(flags[i]) || Object.hasOwn(options, flags[i]) || !flags[i + 1] || flags[i + 1].startsWith("--")) fail("B17_CLI_INPUT_INVALID");
    options[flags[i]] = flags[i + 1];
  }
  const root = options["--root"] ?? process.cwd();
  const prepared = await prepareB17Rollout({ root });
  if (command === "prepare") return prepared;
  if (!options["--input"] || !options["--private-dir"]) fail("B17_CLI_INPUT_INVALID");
  const fs = await import("node:fs/promises");
  const stat = await fs.lstat(options["--input"]);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 16_384) fail("B17_PRIVATE_INPUT_INVALID");
  const input = validateB17Input(JSON.parse(await fs.readFile(options["--input"], "utf8")));
  return executeB17Preflight({ input, prepared }, await createB17LiveAdapter({ root, privateDirectory: options["--private-dir"], input }));
}
if (typeof process !== "undefined" && process.argv[1]) {
  const { pathToFileURL } = await import("node:url");
  if (pathToFileURL(process.argv[1]).href === import.meta.url) {
    try { const result = await main(process.argv.slice(2)); process.stdout.write(JSON.stringify(result, null, 2) + "\n"); if (result.mode !== "LOCAL_PREPARATION") process.exitCode = 2; }
    catch (error) { process.stdout.write(JSON.stringify({ executed: false, mode: "HOLD", error: /^B17_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "B17_INPUT_OR_PREPARATION_FAILED" }) + "\n"); process.exitCode = 2; }
  }
}
