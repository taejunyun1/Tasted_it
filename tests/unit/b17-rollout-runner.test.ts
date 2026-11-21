import { describe, expect, it } from "vitest";
import { B17_LIMITS, RolloutBudget, checkB17Authority, classifyB17Drain, prepareB17Rollout } from "../../scripts/b17-rollout-runner.mjs";

import { describeB17PreservationCapture } from "../../scripts/b17-preservation-evidence.mjs";
import { withB17SourceFixture } from "./b17-source-fixture";

const captureDescription = describeB17PreservationCapture().perPhase;
const actualCaptureCost = { d1Commands: captureDescription.catalogD1Commands + captureDescription.captureD1Commands, manualSql: captureDescription.catalogSqlStatements + captureDescription.captureSqlStatements };
const sha = "a".repeat(40);
const authority = () => ({ localHead: sha, mainHead: sha, sourceTree: "c".repeat(40), prTree: "c".repeat(40), clean: true, pullRequest: { number: 470, merged: true, head: { sha }, base: { ref: "main" }, merge_commit_sha: sha }, checks: ["typecheck and unit", "integration", "build", "playwright smoke"].map(name => ({ name, head_sha: sha, status: "completed", conclusion: "success" })) });

describe("B17 bounded rollout", () => {
  it("keeps cleanup reservations inside fixed limits and separately accounts fixed migration SQL", () => {
    const budget = new RolloutBudget();
    budget.consume({ d1Commands: 45, manualSql: 168 });
    expect(() => budget.consume({ d1Commands: 1 })).toThrow("B17_BUDGET_EXCEEDED");
    budget.consume({ d1Commands: 5, manualSql: 12 }, { cleanup: true });
    expect(budget.snapshot()).toMatchObject({ d1Commands: 50, manualSql: 180 });
    expect(() => budget.consume({ manualSql: 1 }, { cleanup: true })).toThrow();
    const migrations = new RolloutBudget();
    migrations.consume({ migrations: 9, migrationSql: 201 });
    expect(migrations.snapshot().migrationSql).toBe(201);
    expect(B17_LIMITS.manualSql + B17_LIMITS.migrationSql).toBe(381);
    expect(() => migrations.consume({ migrations: 1 })).toThrow();
  });

  it("rejects stale heads, unmerged PRs, missing or duplicate checks before any live action", () => {
    expect(checkB17Authority(authority(), sha)).toBe(true);
    for (const change of [
      (a: any) => { a.mainHead = "b".repeat(40); },
      (a: any) => { a.pullRequest.merged = false; },
      (a: any) => { a.checks.pop(); },
      (a: any) => { a.checks[0].conclusion = "neutral"; },
      (a: any) => { a.checks[0].head_sha = "b".repeat(40); },
      (a: any) => { a.checks.push({ ...a.checks[0] }); },
    ]) { const input = authority(); change(input); expect(() => checkB17Authority(input, sha)).toThrow("B17_AUTHORITY_NOT_VERIFIED"); }
  });

  it("accepts required checks on the exact PR head only when its tree matches the squash merge", () => {
    const input = authority(), prHead = "b".repeat(40);
    input.pullRequest.head.sha = prHead;
    input.checks.forEach(check => { check.head_sha = prHead; });
    expect(checkB17Authority(input, sha)).toBe(true);
    input.prTree = "d".repeat(40);
    expect(() => checkB17Authority(input, sha)).toThrow("B17_AUTHORITY_NOT_VERIFIED");
  });

  it("never promotes elapsed cron time, an operator boolean or completion-only tail to HTTP drain proof", () => {
    for (const evidence of [undefined, { safeToMigrate: true }, { source: "WRANGLER_TAIL", elapsedMs: 901_000, allCompleted: true }]) {
      expect(classifyB17Drain(evidence, { previousVersion: "old", fenceVersion: "fence" })).toMatchObject({ status: "UNKNOWN", canMigrate: false });
    }
  });

  it("preparation only reads the checkout and reports current blockers without an adapter or network", async () => {
    await withB17SourceFixture(async (root) => {
      const report = await prepareB17Rollout({ root });
      expect(report).toMatchObject({ mode: "LOCAL_PREPARATION", executed: false, migrationCount: 9, migrationSql: 201 });
      expect(report.stages).toEqual(["PREPARE", "AUTHORITY", "FENCE", "DRAIN", "BACKUP", "PRESERVATION_BEFORE", "MIGRATIONS", "PRESERVATION_AFTER", "SESSION", "GUARDED_TRANSITIONS", "NORMAL_DEPLOY", "LIVE_PROBES", "RSI", "CLEANUP"]);
      expect(report.blockers).toContain("LIVE_HTTP_DRAIN_OBSERVATION_REQUIRED");
    });
  });
});

import { rehearseB17Lifecycle, executeB17Preflight, checkB17Runtime, B17_TARGET } from "../../scripts/b17-rollout-runner.mjs";

it("the full fixed lifecycle fits real migration/capture costs including cleanup", async () => {
  const state = { fence: false, session: false, migrations: false, normal: false, cleaned: false };
  const result = await rehearseB17Lifecycle({ captureCosts: [actualCaptureCost, actualCaptureCost] }, {
    kind: "SYNTHETIC_LOCAL", async perform(stage: string) {
      if (stage === "FENCE") state.fence = true;
      if (stage === "MIGRATIONS") state.migrations = true;
      if (stage === "SESSION") state.session = true;
      if (stage === "NORMAL_DEPLOY") { state.normal = true; state.fence = false; }
      if (stage === "CLEANUP") { state.session = false; state.cleaned = true; }
    },
  });
  expect(result).toMatchObject({ mode: "SIMULATED_COMPLETE", executed: false, budget: { d1Commands: 44, manualSql: 58, migrationSql: 201, migrations: 9, exports: 1, sessions: 1, rsi: 1, http: 61 } });
  expect(state).toEqual({ fence: false, session: false, migrations: true, normal: true, cleaned: true });
});

it.each(["SESSION", "LEGACY_TRANSITION", "QUOTA_TRANSITION", "NORMAL_DEPLOY", "LIVE_PROBES", "RSI"])("keeps the fence and cleans exact synthetic state after %s fails", async failure => {
  const state = { fence: false, session: false, cleaned: false };
  const result = await rehearseB17Lifecycle({ captureCosts: [actualCaptureCost, actualCaptureCost], failAt: failure }, {
    kind: "SYNTHETIC_LOCAL", async perform(stage: string) {
      if (stage === "FENCE" || stage === "KEEP_FENCE") state.fence = true;
      if (stage === "SESSION") state.session = true;
      if (stage === "CLEANUP") { state.session = false; state.cleaned = true; }
    },
  });
  expect(result.mode).toBe("SIMULATED_HOLD");
  expect(state).toEqual({ fence: true, session: false, cleaned: true });
  expect(result.budget.d1Commands).toBeLessThanOrEqual(50);
});

it("refuses a preservation plan that consumes the reserved cleanup allocation", async () => {
  const effects: string[] = [];
  const result = await rehearseB17Lifecycle({ captureCosts: [actualCaptureCost, { d1Commands: 40, manualSql: 40 }] }, {
    kind: "SYNTHETIC_LOCAL", async perform(stage: string) { effects.push(stage); },
  });
  expect(result).toMatchObject({ mode: "SIMULATED_HOLD", error: "B17_BUDGET_EXCEEDED" });
  expect(effects).not.toContain("SESSION");
  expect(effects).toContain("KEEP_FENCE");
});

it("does not accept an arbitrary adapter or boolean as a live continuation proof", async () => {
  await expect(rehearseB17Lifecycle({ captureCosts: [] }, { kind: "LIVE_CLI" })).rejects.toThrow("B17_REHEARSAL_INPUT_INVALID");
});

const version = "11111111-1111-4111-8111-111111111111";
const config = { name: B17_TARGET.worker, vars: { CST_MAINTENANCE: "false", ONBOARDING_ENABLED: "true" }, compatibility_flags: ["nodejs_compat"], compatibility_date: "2026-08-05" };
const runtime = () => ({ deployment: { versions: [{ version_id: version, percentage: 100 }] }, version: { id: version, metadata: { created_on: "2026-11-18T00:00:00.000Z" }, resources: { script_runtime: { compatibility_flags: ["nodejs_compat"], compatibility_date: "2026-08-05" }, bindings: [{ type: "d1", name: "DB", id: B17_TARGET.databaseId }, { type: "r2_bucket", name: "REVIEW_PHOTOS", bucket_name: B17_TARGET.bucket }, ...Object.entries(config.vars).map(([name, text]) => ({ type: "plain_text", name, text }))] } }, crons: [...B17_TARGET.crons] });

it("requires exact current binding, plain vars, crons and 100-percent version", () => {
  expect(checkB17Runtime(runtime(), config, version)).toMatchObject({ version });
  for (const change of [
    (r: any) => { r.deployment.versions[0].percentage = 90; },
    (r: any) => { r.crons.pop(); },
    (r: any) => { r.version.resources.bindings[0].id = "other-db"; },
    (r: any) => { r.version.resources.bindings[2].text = "true"; },
    (r: any) => { r.version.resources.script_runtime.compatibility_date = "2026-08-06"; },
  ]) { const r = runtime(); change(r); expect(() => checkB17Runtime(r, config, version)).toThrow("B17_RUNTIME_NOT_VERIFIED"); }
});

it("validates preflight but cannot deploy a fence even if an adapter claims drain is safe", async () => {
  const effects: string[] = [];
  const input = { sourceSha: sha, previousVersion: version, operatorId: "operator", legacyRunId: null, quotaCutover: "HOLD", budgetPolicy: "MANUAL_180_INCLUDES_BOOKKEEPING_MIGRATION_201" };
  const { B17_MIGRATIONS } = await import("../../scripts/b17-rollout-evidence.mjs");
  const result = await executeB17Preflight({ input, prepared: { sourceSha: sha, migrationSql: 201 } }, {
    kind: "LIVE_CLI", authority: async () => authority(), build: async () => ({ config }), runtime: async () => runtime(),
    migrationLedger: async () => ({ expected: ["0049.sql", ...B17_MIGRATIONS], applied: ["0049.sql"] }),
    controlCalls: () => 0, deploy: async () => { effects.push("deploy"); }, observeDrain: async () => ({ safeToMigrate: true }),
  });
  expect(result).toMatchObject({ mode: "LIVE_PREFLIGHT_HOLD", executed: false, error: "LIVE_HTTP_DRAIN_OBSERVATION_REQUIRED" });
  expect(effects).toEqual([]);
});

it("a deadline after session creation still preserves cleanup and the fence", async () => {
  let time = 0;
  const effects: string[] = [];
  const result = await rehearseB17Lifecycle({ captureCosts: [actualCaptureCost, actualCaptureCost] }, {
    kind: "SYNTHETIC_LOCAL", now: () => time, async perform(stage: string) { effects.push(stage); if (stage === "SESSION") time = 31 * 60_000; },
  });
  expect(result).toMatchObject({ mode: "SIMULATED_HOLD", error: "B17_DEADLINE_EXCEEDED" });
  expect(effects).toContain("CLEANUP");
  expect(effects).toContain("KEEP_FENCE");
  expect(effects).not.toContain("NORMAL_DEPLOY");
});

import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createB17LiveAdapter } from "../../scripts/b17-rollout-runner.mjs";

it("reads actual CLI response shapes through bounded argv and keeps the bearer out of arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "b17-runner-cli-"));
  const root = join(dir, "root"), privateDirectory = join(dir, "private");
  await mkdir(root); await mkdir(privateDirectory, { mode: 0o700 });
  const calls: Array<{ file: string; args: string[]; options: any }> = [];
  try {
    const adapter = await createB17LiveAdapter({ root, privateDirectory, input: { sourceSha: sha, previousVersion: version, operatorId: "operator", legacyRunId: null, quotaCutover: "HOLD", budgetPolicy: "MANUAL_180_INCLUDES_BOOKKEEPING_MIGRATION_201" }, exec: async (file: string, args: string[], options: any) => {
      calls.push({ file, args, options });
      if (args.includes("status")) return JSON.stringify(runtime().deployment);
      if (args.includes("view")) return JSON.stringify(runtime().version);
      if (args.includes("token")) return JSON.stringify({ type: "oauth", token: "synthetic-private-bearer" });
      if (file === "curl") {
        const result = options.stdin.includes("/query") ? [{ success: true, results: [{ name: "0049.sql" }] }] : { schedules: B17_TARGET.crons.map(cron => ({ cron })) };
        return `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n${JSON.stringify({ success: true, result })}`;
      }
      throw new Error("unexpected synthetic command");
    } });
    expect(await adapter.runtime()).toEqual(runtime());
    expect(await adapter.query("SELECT name FROM d1_migrations ORDER BY name;")).toHaveLength(1);
    await expect(adapter.query("SELECT 1; SELECT 2;", { expectedStatements: 2 })).rejects.toThrow("B17_D1_RESPONSE_INVALID");
    expect(calls.some(call => call.options.stdin?.includes("SELECT name FROM d1_migrations"))).toBe(true);
    expect(calls.some(call => call.args.includes("--file"))).toBe(false);
    expect(JSON.stringify(calls.map(call => call.args))).not.toContain("synthetic-private-bearer");
    expect(JSON.stringify(calls.map(call => call.args))).not.toContain("SELECT name");
    expect(calls.find(call => call.file === "curl")?.options.stdin).toContain("Authorization: Bearer synthetic-private-bearer");
    expect(calls.every(call => call.options.env.WRANGLER_WRITE_LOGS === "false")).toBe(true);
    expect(calls.every(call => call.options.timeout === undefined || call.options.timeout <= 50_000)).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("rejects a private-directory parent symlink that resolves inside the repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "b17-runner-path-"));
  try {
    const root = join(dir, "root"); await mkdir(root); await mkdir(join(root, "private"), { mode: 0o700 });
    await symlink(root, join(dir, "alias"));
    await expect(createB17LiveAdapter({ root, privateDirectory: join(dir, "alias/private"), input: { sourceSha: sha, previousVersion: version, operatorId: "operator", legacyRunId: null, quotaCutover: "HOLD", budgetPolicy: "MANUAL_180_INCLUDES_BOOKKEEPING_MIGRATION_201" } })).rejects.toThrow("B17_PRIVATE_DIRECTORY_INVALID");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("downloads a single backup privately and never puts the signed URL in argv", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b17-backup-"));
  const root = join(directory, "root"), privateDirectory = join(directory, "private");
  const signed = "https://bucket.example.r2.cloudflarestorage.com/export.sql?credential=synthetic";
  const calls: string[][] = [];
  try {
    await mkdir(root); await mkdir(privateDirectory, { mode: 0o700 });
    const adapter = await createB17LiveAdapter({ root, privateDirectory, input: { sourceSha: sha, previousVersion: version, operatorId: "operator", legacyRunId: null, quotaCutover: "HOLD", budgetPolicy: "MANUAL_180_INCLUDES_BOOKKEEPING_MIGRATION_201" },
      exec: async (_file: string, args: string[], { stdin }: { stdin?: string }) => {
        calls.push(args);
        if (args.includes("token")) return JSON.stringify({ type: "api_token", token: "fixture-token" });
        if (stdin?.includes(signed)) {
          const filename = stdin.match(/^output = "(.*)"$/m)?.[1];
          if (!filename) throw new Error("missing output");
          await writeFile(filename, "synthetic export\n");
          return "200";
        }
        const result = stdin?.includes("time_travel/bookmark") ? { bookmark: "synthetic-bookmark" }
          : { success: true, at_bookmark: "export-bookmark", status: "complete", result: { signed_url: signed } };
        return `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ success: true, result })}`;
      },
    });
    const receipt = await adapter.backup();
    const evidence = JSON.parse(await readFile(join(privateDirectory, "backup.json"), "utf8"));
    expect(receipt).toMatchObject({ bookmark: "synthetic-bookmark", bytes: 17 });
    expect((await stat(join(privateDirectory, evidence.file))).mode & 0o777).toBe(0o600);
    expect(JSON.stringify([calls, receipt, evidence])).not.toContain(signed);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("rejects command/SQL injection fields and malformed runtime identities at the CLI boundary", async () => {
  const { validateB17Input } = await import("../../scripts/b17-rollout-runner.mjs");
  const input = { sourceSha: sha, previousVersion: version, operatorId: "operator", legacyRunId: null, quotaCutover: "HOLD", budgetPolicy: "MANUAL_180_INCLUDES_BOOKKEEPING_MIGRATION_201" };
  for (const candidate of [{ ...input, command: "deploy" }, { ...input, operatorId: "x';DELETE FROM users;--" }, { ...input, previousVersion: "--help" }]) {
    expect(() => validateB17Input(candidate)).toThrow("B17_INPUT_INVALID");
  }
});
