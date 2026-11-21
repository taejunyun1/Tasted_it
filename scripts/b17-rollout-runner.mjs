import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { buildB17MigrationManifest, B17_MIGRATIONS } from "./b17-rollout-evidence.mjs";
import { describeB17PreservationCapture, verifyB17PreservationSources } from "./b17-preservation-evidence.mjs";
import { buildB17DrainObservationPlan, describeB17DrainRequirements, summarizeB17DrainObservation, verifyB17DrainEvidence } from "./b17-drain-evidence.mjs";

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
    httpAllocation: "Initial rehearsal allocation only. The continuation counts the probes it actually attempts." };
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
    implementedCommands: ["prepare", "preflight", "continue"], postDrainExecutionImplemented: true,
    liveDrainSupported: false, drain: describeB17DrainRequirements(), preservation, costModel: buildB17CostPlan(preservation),
    limits: B17_LIMITS, cleanupReserve: B17_CLEANUP_RESERVE, migrationCount: 9, migrationSql: counts.reduce((a, b) => a + b, 0),
    migrations: manifest.migrations.map((row, index) => ({ name: row.name, sha256: row.sha256, statements: counts[index] })),
    blockers: ["MERGED_MAIN_AND_EXACT_FOUR_CI_REQUIRED", "CURRENT_RUNTIME_BINDINGS_VARS_CRONS_REQUIRED", "LIVE_HTTP_DRAIN_OBSERVATION_REQUIRED"],
    costUnits: { http: "application HTTP probes (including RSI trigger); CLI control-plane traffic is separately recorded, not mislabeled as probes", d1Commands: "D1 management invocations", manualSql: "explicit administrative/capture statements and migration bookkeeping", migrationSql: "fixed nine file statements counted by readD1Migrations" } };
}

const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value));
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
    || runtime.version?.id !== expectedVersion || !timestamp(runtime.version?.metadata?.created_on)
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
  return { version: expectedVersion, createdAt: new Date(runtime.version.metadata.created_on).toISOString(), bindingDigest: hash(JSON.stringify(bindings.map(({ type, name, id, bucket_name }) => ({ type, name, id, bucket_name })))) };
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
  const nativeExec = async (file, args, { stdin = "", timeout = 60_000, maxBuffer = 8 * 1024 * 1024, cleanup = false } = {}) => {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      const remaining = deadline + (cleanup ? 120_000 : 0) - Date.now();
      if (remaining <= 0) return reject(new Error("B17_DEADLINE_EXCEEDED"));
      const child = execFile(file, args, { cwd: realRoot, env: childEnvironment, timeout: Math.min(timeout, remaining), maxBuffer, killSignal: "SIGKILL" }, (error, stdout) => {
        // Never include stderr, stdout, argv, SQL or environment in a public error.
        if (error) reject(new Error(error.killed ? "B17_COMMAND_OUTCOME_UNKNOWN" : "B17_COMMAND_FAILED"));
        else resolve(stdout);
      });
      child.stdin?.on("error", () => {});
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
  const quote = value => {
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) fail("B17_HTTP_INPUT_INVALID");
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  };
  const curl = async ({ url, method = "GET", headers = {}, body = "", maxBytes = 2 * 1024 * 1024, cleanup = false, timeout = 45_000 }) => {
    const configuration = [`url = ${quote(url)}`, `request = ${quote(method)}`, "silent", "show-error", "include", `max-time = ${timeout / 1000}`, "max-redirs = 0", "proto = \"=https\"", ...Object.entries(headers).map(([key, value]) => `header = ${quote(`${key}: ${value}`)}`), ...(body ? [`data = ${quote(body)}`] : [])].join("\n");
    const raw = await run("curl", ["--disable", "--config", "-", "--suppress-connect-headers"], { stdin: configuration, timeout: timeout + 1000, maxBuffer: maxBytes, cleanup });
    const match = raw.match(/^HTTP\/\S+ (\d{3})[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
    if (!match) fail("B17_HTTP_RESPONSE_INVALID");
    return { status: Number(match[1]), headers: Object.fromEntries(match[2].split(/\r?\n/).map(line => { const i = line.indexOf(":"); return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()]; })), body: match[3] };
  };
  const cfRequest = async (suffix, { body, maxBytes, cleanup = false, timeout, envelope = false } = {}) => {
    const credentials = json(await wrangler(["auth", "token", "--json"], { cleanup, timeout }));
    if (!["api_token", "oauth"].includes(credentials.type) || typeof credentials.token !== "string" || !credentials.token || /[\r\n\0]/.test(credentials.token)) fail("B17_EXISTING_BEARER_REQUIRED");
    controlCalls++;
    const response = await curl({
      url: `https://api.cloudflare.com/client/v4/accounts/${B17_TARGET.accountId}/${suffix}`,
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${credentials.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : "", maxBytes, cleanup, timeout,
    });
    if (response.status !== 200) fail("B17_CONTROL_RESPONSE_INVALID");
    const value = json(response.body);
    if (value.success !== true) fail("B17_CONTROL_RESPONSE_INVALID");
    return envelope ? value : value.result;
  };
  const query = async (sql, { expectedStatements = 1, maxBytes = 16 * 1024 * 1024, cleanup = false } = {}) => {
    if (typeof sql !== "string" || !sql.trim() || Buffer.byteLength(sql) > 90 * 1024
      || !Number.isInteger(expectedStatements) || expectedStatements < 1 || expectedStatements > 12
      || !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 16 * 1024 * 1024) fail("B17_QUERY_INVALID");
    // SQL and session credentials stay in stdin. Do not use Wrangler --file's import path.
    const result = await cfRequest(`d1/database/${B17_TARGET.databaseId}/query`, { body: { sql }, maxBytes, cleanup });
    if (!Array.isArray(result) || result.length !== expectedStatements || result.some(row => row.success !== true || !Array.isArray(row.results))) fail("B17_D1_RESPONSE_INVALID");
    return result;
  };
  const telemetry = async (versionId, from, to) => {
    if (!uuid(versionId) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || from >= to || to - from > 30 * 60_000) fail("B17_TELEMETRY_WINDOW_INVALID");
    const filters = [["$workers.scriptName", B17_TARGET.worker], ["$workers.scriptVersion.id", versionId]]
      .map(([key, value]) => ({ key, value, operation: "eq", type: "string" }));
    return cfRequest("workers/observability/telemetry/query", { body: {
      queryId: "b17-operations", timeframe: { from, to }, view: "events", limit: 100, dry: true,
      parameters: { filters },
    } });
  };
  const savePrivate = async (name, value) => {
    if (!/^[a-z][a-z0-9-]{0,59}\.json$/.test(name)) fail("B17_PRIVATE_NAME_INVALID");
    const content = typeof value === "string" ? value : JSON.stringify(value);
    if (!content || Buffer.byteLength(content) > 64 * 1024 * 1024) fail("B17_PRIVATE_SIZE_INVALID");
    const target = path.join(directory, name);
    const file = await fs.open(target, "wx", 0o600);
    try { await file.writeFile(content); await file.sync(); }
    finally { await file.close(); }
    return { sha256: hash(content) };
  };
  const buildFiles = async () => {
    const files = [];
    const visit = async dir => {
      for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) fail("B17_BUILD_SYMLINK");
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile()) files.push([path.relative(realRoot, file), hash(await fs.readFile(file))]);
        else fail("B17_BUILD_ENTRY_INVALID");
      }
    };
    await visit(path.join(realRoot, "build"));
    return hash(JSON.stringify(files));
  };
  const deploy = async maintenance => {
    if (!artifact) fail("B17_BUILD_REQUIRED");
    const server = path.join(realRoot, "build/server");
    const main = path.resolve(server, artifact.config.main);
    const assets = path.resolve(server, artifact.config.assets.directory);
    if (main !== path.join(server, "index.js") || assets !== path.join(realRoot, "build/client")) fail("B17_ARTIFACT_PATH_INVALID");
    if (await buildFiles() !== artifact.digest) fail("B17_ARTIFACT_CHANGED");
    const config = { ...artifact.config, main, assets: { ...artifact.config.assets, directory: assets, ...(maintenance ? { run_worker_first: true } : {}) },
      vars: { ...artifact.config.vars, CST_MAINTENANCE: String(maintenance) }, account_id: B17_TARGET.accountId };
    const deployConfig = `deploy-${randomUUID()}.json`;
    await savePrivate(deployConfig, config);
    const marker = `B17 ${input.sourceSha} ${maintenance ? "fence" : "normal"} ${randomUUID()}`;
    controlCalls++;
    await run(process.execPath, [cli, "deploy", "--config", path.join(directory, deployConfig), "--keep-vars", "--message", marker], { timeout: 600_000, cleanup: maintenance });
    const runtime = await adapter.runtime({ cleanup: maintenance });
    if ((runtime.deployment.annotations?.["workers/message"] ?? runtime.version.annotations?.["workers/message"]) !== marker) fail("B17_DEPLOYMENT_OUTCOME_UNKNOWN");
    checkB17Runtime(runtime, artifact.config, runtime.version.id, maintenance);
    return { sourceSha: input.sourceSha, artifactDigest: artifact.digest, runtime };
  };
  const adapter = {
    kind: "LIVE_CLI",
    controlCalls: () => controlCalls,
    async authority() {
      const localHead = (await run("git", ["rev-parse", "HEAD"])).trim();
      const clean = !(await run("git", ["status", "--porcelain"])).trim();
      const pullRequest = await gh("pulls/470"), main = await gh("branches/main");
      if (!/^[a-f0-9]{40}$/.test(pullRequest.head?.sha ?? "")) fail("B17_AUTHORITY_NOT_VERIFIED");
      const checksResult = await gh(`commits/${pullRequest.head.sha}/check-runs?per_page=100`);
      if (!Array.isArray(checksResult.check_runs) || checksResult.total_count > checksResult.check_runs.length) fail("B17_CI_RESPONSE_INCOMPLETE");
      const checksFromActions = checksResult.check_runs.filter(check => check.app?.slug === "github-actions"
        && /^https:\/\/github\.com\/taejunyun1\/Tasted_it\/actions\/runs\/\d+\/job\/\d+$/.test(check.details_url ?? ""));
      const prCommit = await gh(`git/commits/${pullRequest.head?.sha}`);
      const sourceTree = (await run("git", ["rev-parse", "HEAD^{tree}"])).trim();
      const policy = await run("git", ["show", "HEAD:docs/operations/2026-11-18-admin-b17-rollout.md"]);
      if (!policy.includes("381") || !policy.includes("201")) fail("B17_BUDGET_PLAN_NOT_MERGED");
      return { localHead, clean, sourceTree, prTree: prCommit.tree?.sha, mainHead: main.commit?.sha, pullRequest, checks: checksFromActions };
    },
    async build() {
      await run("pnpm", ["install", "--frozen-lockfile"], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
      await run("pnpm", ["run", "build"], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
      const config = json(await fs.readFile(path.join(realRoot, "build/server/wrangler.json"), "utf8"));
      if (config.name !== B17_TARGET.worker || config.vars?.CST_MAINTENANCE !== "false" || !same(sorted(config.triggers?.crons ?? []), sorted(B17_TARGET.crons))
        || config.d1_databases?.length !== 1 || config.d1_databases[0].database_id !== B17_TARGET.databaseId || config.r2_buckets?.length !== 1 || config.r2_buckets[0].bucket_name !== B17_TARGET.bucket) fail("B17_BUILD_CONFIG_INVALID");
      artifact = { config, digest: await buildFiles() };
      return artifact;
    },
    async runtime({ cleanup = false } = {}) {
      const deployment = json(await wrangler(["deployments", "status", "--name", B17_TARGET.worker, "--json"], { cleanup }));
      const versions = deployment?.versions?.filter(row => row.percentage > 0);
      if (versions?.length !== 1 || !uuid(versions[0].version_id)) fail("B17_DEPLOYMENT_AMBIGUOUS");
      const version = json(await wrangler(["versions", "view", versions[0].version_id, "--name", B17_TARGET.worker, "--json"], { cleanup }));
      const schedules = await cfRequest(`workers/scripts/${B17_TARGET.worker}/schedules`, { cleanup });
      if (!Array.isArray(schedules?.schedules)) fail("B17_SCHEDULE_RESPONSE_INVALID");
      return { deployment, version, crons: schedules.schedules.map(row => row.cron) };
    },
    async verifyDrain({ previousVersion, fenceVersion, fencedAt }) {
      const expected = { previousVersion, fenceVersion, fenceDeployedAt: fencedAt, now: new Date().toISOString() };
      const verdict = verifyB17DrainEvidence({ expected });
      try {
        const plan = buildB17DrainObservationPlan({ expected });
        const fetchPlan = ({ path: endpoint, body }) => {
          const prefix = `/accounts/${B17_TARGET.accountId}/`;
          if (!endpoint.startsWith(prefix)) fail("B17_CONTROL_SCOPE_INVALID");
          return cfRequest(endpoint.slice(prefix.length), { body, maxBytes: plan.maxResponseBytes, timeout: plan.timeoutMs, envelope: true });
        };
        const keys = (await fetchPlan(plan.keys)).result;
        if (!Array.isArray(keys) || !plan.requiredKeys.every(key => keys.some(row => row.key === key.key && row.type === key.type))) fail("B17_OBSERVATION_KEYS_MISSING");
        return { ...verdict, observation: summarizeB17DrainObservation({ response: await fetchPlan(plan.query), expected }) };
      } catch {
        return { ...verdict, observation: { status: "UNAVAILABLE", canMigrate: false } };
      }
    },
    async readRsiLog({ startedAt, endedAt, versionId, rayId }) {
      const from = Date.parse(startedAt), to = Math.max(from + 1, Date.parse(endedAt));
      const response = await telemetry(versionId, from, to);
      const events = response?.events?.events;
      if (response?.run?.status !== "COMPLETED" || !Array.isArray(events) || events.length >= 100) fail("B17_RSI_TELEMETRY_INCOMPLETE");
      const matching = events.filter(row => row.$workers?.scriptName === B17_TARGET.worker
        && row.$workers.scriptVersion?.id === versionId && row.timestamp >= from && row.timestamp <= to);
      const terminals = matching.filter(row => {
        const event = row.$workers.event;
        return row.$workers.outcome === "ok" && !row.$workers.truncated
          && event?.request?.method === "POST" && event.request.url === "https://retaste-beta.retaste-beta.workers.dev/admin/operations/rsi-check"
          && event.response?.status === 200 && !!rayId && [event.rayId, event.request.cf?.rayId, row.$workers.requestId].includes(rayId);
      });
      if (terminals.length !== 1 || typeof terminals[0].$workers.requestId !== "string") fail("B17_RSI_TELEMETRY_MISSING");
      const terminal = terminals[0], requestId = terminal.$workers.requestId;
      const stamps = matching.filter(row => row.$workers.requestId === requestId && !row.$workers.truncated
        && (row.$metadata?.message === "RSI_SELF_CHECK" || row.source?.message === "RSI_SELF_CHECK") && row.source?.trigger === "admin" && row.source?.ok === true);
      if (stamps.length !== 1) fail("B17_RSI_TELEMETRY_MISSING");
      return { versionId, outcome: "ok", trigger: "admin", observedAt: new Date(terminal.timestamp).toISOString(), requestId: rayId };
    },
    async migrationLedger() {
      const expected = (await fs.readdir(path.join(realRoot, "drizzle"))).filter(name => /^\d{4}.*\.sql$/.test(name)).sort();
      const rows = await query("SELECT name FROM d1_migrations ORDER BY name;");
      return { expected, applied: rows[0].results.map(row => row.name) };
    },
    query, savePrivate,
    lock: {
      async acquire() { await fs.mkdir(path.join(directory, "continuation.lock"), { mode: 0o700 }); },
      async release() { await fs.rmdir(path.join(directory, "continuation.lock")); },
    },
    async buildDigest() {
      const current = artifact ?? await adapter.build();
      return { artifactDigest: current.digest, config: current.config };
    },
    async backup() {
      const prefix = `d1/database/${B17_TARGET.databaseId}`;
      const validBookmark = value => typeof value === "string" && /^[a-zA-Z0-9-]{1,512}$/.test(value);
      const marker = await cfRequest(`${prefix}/time_travel/bookmark`);
      if (!validBookmark(marker?.bookmark)) fail("B17_BOOKMARK_INVALID");
      let currentBookmark, exported;
      for (let attempt = 0; attempt < 3; attempt++) {
        exported = await cfRequest(`${prefix}/export`, { body: { output_format: "polling",
          ...(currentBookmark ? { current_bookmark: currentBookmark } : {}) } });
        if (!exported?.success || !validBookmark(exported.at_bookmark) || (currentBookmark && exported.at_bookmark !== currentBookmark)) fail("B17_EXPORT_OUTCOME_UNKNOWN");
        currentBookmark = exported.at_bookmark;
        if (exported.status === "complete") break;
        if (exported.status === "error") fail("B17_EXPORT_FAILED");
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (exported?.status !== "complete" || typeof exported.result?.signed_url !== "string" || exported.result.signed_url.length > 4096) fail("B17_EXPORT_OUTCOME_UNKNOWN");
      const signed = new URL(exported.result.signed_url);
      if (signed.protocol !== "https:" || signed.port || signed.username || signed.password
        || !/^[a-z0-9.-]+\.r2\.cloudflarestorage\.com$/.test(signed.hostname)) fail("B17_EXPORT_HOST_UNVERIFIED");
      const target = path.join(directory, `export-${randomUUID()}.sql`);
      const file = await fs.open(target, "wx", 0o600);
      await file.close();
      const transfer = [`url = ${quote(signed.href)}`, `output = ${quote(target)}`, 'write-out = "%{http_code}"',
        'proto = "=https"', "max-redirs = 0", "max-time = 120", "max-filesize = 536870912", "silent", "show-error"].join("\n");
      controlCalls++;
      const status = await run("curl", ["--disable", "--config", "-"], { stdin: transfer, timeout: 125_000, maxBuffer: 1024 });
      if (status.trim() !== "200") fail("B17_EXPORT_DOWNLOAD_FAILED");
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.mode & 0o077 || !stat.size || stat.size > 536870912) fail("B17_EXPORT_INVALID");
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(target)) digest.update(chunk);
      const proof = { bookmark: marker.bookmark, exportBookmark: currentBookmark, sha256: digest.digest("hex"), bytes: stat.size };
      await savePrivate("backup.json", { ...proof, file: path.basename(target) });
      return proof;
    },
    async applyMigrations() {
      await wrangler(["d1", "migrations", "apply", "DB", "--remote"], { timeout: 600_000 });
    },
    deployNormal: () => deploy(false),
    ensureFence: () => deploy(true),
    async probe({ path: route, method = "GET", sessionId, form }) {
      const origin = "https://retaste-beta.retaste-beta.workers.dev";
      if (typeof route !== "string" || !/^\/(?!\/)[A-Za-z0-9/_?.=&%~-]{0,500}$/.test(route)
        || !["GET", "POST"].includes(method) || (sessionId && !identifier(sessionId))
        || (form && (method !== "POST" || Object.keys(form).length > 8))) fail("B17_PROBE_INVALID");
      return curl({ url: origin + route, method,
        headers: { ...(sessionId ? { Cookie: `retaste_session=${sessionId}` } : {}),
          ...(form ? { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        body: form ? new URLSearchParams(form).toString() : "" });
    },
  };
  return adapter;
}

/** Read-only remote preflight. Legacy drain support must exist before fencing. */
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
      controlPlaneCliCalls: adapter.controlCalls(), error: "LIVE_HTTP_DRAIN_OBSERVATION_REQUIRED" };
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
  const allowed = command === "prepare" ? ["--root"] : command === "preflight" ? ["--root", "--input", "--private-dir"]
    : command === "continue" ? ["--root", "--input", "--private-dir", "--checkpoint"] : [];
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
  const path = await import("node:path");
  const directory = await fs.realpath(options["--private-dir"]);
  const readPrivate = async name => {
    const file = await fs.realpath(name);
    const stat = await fs.lstat(name);
    if (path.dirname(file) !== directory || !stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 16_384) fail("B17_PRIVATE_INPUT_INVALID");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const input = validateB17Input(await readPrivate(options["--input"]));
  const adapter = await createB17LiveAdapter({ root, privateDirectory: directory, input });
  if (command === "preflight") return executeB17Preflight({ input, prepared }, adapter);
  if (!options["--checkpoint"] || input.quotaCutover !== "HOLD") fail("B17_CONTINUATION_INPUT_INVALID");
  const checkpoint = await readPrivate(options["--checkpoint"]);
  if (checkpoint?.sourceSha !== input.sourceSha || checkpoint.previousVersion !== input.previousVersion || !uuid(checkpoint.fenceVersion)) fail("B17_CHECKPOINT_INVALID");
  const { continueB17Rollout } = await import("./b17-rollout-continuation.mjs");
  const baselineMigrationNames = (await fs.readdir(path.join(root, "drizzle"))).filter(name => /^\d{4}.*\.sql$/.test(name) && name < "0050").sort();
  // Reserve the earlier preflight ledger and fence probes even in a fresh process.
  const budget = new RolloutBudget({ d1Commands: 1, manualSql: 1, http: 5 });
  checkB17Authority(await adapter.authority(), input.sourceSha);
  const { config } = await adapter.buildDigest();
  return continueB17Rollout({ input, checkpoint, prepared: { ...prepared, baselineMigrationNames, config }, budget }, adapter);
}
if (typeof process !== "undefined" && process.argv[1]) {
  const { pathToFileURL } = await import("node:url");
  if (pathToFileURL(process.argv[1]).href === import.meta.url) {
    try { const result = await main(process.argv.slice(2)); process.stdout.write(JSON.stringify(result, null, 2) + "\n"); if (result.mode !== "LOCAL_PREPARATION" && result.status !== "VERIFIED") process.exitCode = 2; }
    catch (error) { process.stdout.write(JSON.stringify({ executed: false, mode: "HOLD", error: /^B17_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "B17_INPUT_OR_PREPARATION_FAILED" }) + "\n"); process.exitCode = 2; }
  }
}
