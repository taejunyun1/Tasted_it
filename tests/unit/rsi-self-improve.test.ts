import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSelfImprovement, rollbackSelfImprovement, type SelfImprovementOptions } from "../../scripts/rsi/self-improve";
import { ControllerCheckpointStore } from "../../scripts/rsi/controller";
import { LocalRsiLedger } from "../../scripts/rsi/ledger";
import { createApprovedSnapshot } from "../../scripts/rsi/memory";
import { deriveKst, RSI_PUBLIC_PATHS } from "../../scripts/rsi/contracts";
import * as core from "../../scripts/rsi/repair-core";
import { DockerSandbox, SANDBOX_POLICY, SANDBOX_POLICY_DIGEST } from "../../scripts/rsi/sandbox";
import { NativeExecutor } from "../../scripts/rsi/native-executor";
import type { R4FakeFixture } from "../../scripts/rsi/promotion";

const hash = (v: string) => createHash("sha256").update(v).digest("hex"), jhash = (v: unknown) => hash(JSON.stringify(v));
const now = "2026-10-22T16:30:00.000Z", dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
// Human supplied source data. These are lineage fixtures, not model generation.
const modules = (g: number) => ({
  "scripts/rsi/agent/diagnostic-policy.ts": "export function diagnose(p) { return p.modelReply; }\n",
  "scripts/rsi/agent/repair-policy.ts": `import { diagnose } from "./diagnostic-policy";\nexport default function strategy(input) { if (input.payload.phase === "DIAGNOSE") return diagnose(input.payload); return input.payload.modelReply; }\n// synthetic generation ${g}\n`,
});
async function inputs(dir: string, campaignId = randomUUID()) {
  const observation = { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", target: "RSI_PUBLIC_SIX_PATHS",
    incident: { source: "LOCAL_SYNTHETIC", baseAppSha: "a".repeat(40), workerVersion: "10000000-0000-4000-8000-000000000001", errorCode: "UNEXPECTED_ERROR", failedPaths: [...RSI_PUBLIC_PATHS] },
    trigger: "on-demand", actor: "OPERATOR", sourceEventId: "10000000-0000-4000-8000-000000000002", observedAtUtc: now, observedAtKst: deriveKst(now),
    window: { startUtc: "2026-10-01T00:00:00.000Z", endUtc: "2026-11-01T00:00:00.000Z" }, checkedPaths: [...RSI_PUBLIC_PATHS], verdict: "FAIL",
    evidence: [{ evidenceId: "10000000-0000-4000-8000-000000000003", kind: "OBSERVATION", digest: hash("synthetic-observation"), verdict: "FAIL", commandId: null }] };
  const baseSource = (await readFile(new URL("../../app/features/operations/rsi-self-check.ts", import.meta.url), "utf8")).replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)");
  const diagnosis = { action: "DIAGNOSE", hypotheses: [
    { cause: "NATIVE_FETCH_RECEIVER", supportingEvidenceIds: [observation.evidence[0].evidenceId], refutingEvidenceIds: "UNKNOWN" },
    { cause: "UPSTREAM_HTTP", supportingEvidenceIds: "UNKNOWN", refutingEvidenceIds: [observation.evidence[0].evidenceId] }],
    reproducer: "PUBLIC_SIX_PATHS", relatedRegressions: ["NORMAL", "HTTP_STATUS", "AUTH_REDIRECT", "AUTH_STATUS"] };
  const patch = { action: "PATCH", path: "app/features/operations/rsi-self-check.ts", baseSourceDigest: hash(baseSource), find: "input.fetch.bind(input)", replace: "input.fetch.bind(globalThis)" };
  const seed = await core.compileAgentSources(await core.loadSeedAgentSources()), g1 = await core.compileAgentSources(modules(1));
  const repair = [{ kind: "JSON_RESPONSE" as const, response: diagnosis }, { kind: "JSON_RESPONSE" as const, response: patch }];
  const fakeFixture: R4FakeFixture = { schemaVersion: 1, mode: "LOCAL_FAKE", generations: {
    "1": [...repair, { kind: "JSON_RESPONSE", response: { schemaVersion: 1, action: "PROPOSE_AGENT", baseAgentHash: seed.agentHash, modules: modules(1) } }, ...repair],
    "2": [{ kind: "JSON_RESPONSE", response: { schemaVersion: 1, action: "PROPOSE_AGENT", baseAgentHash: g1.agentHash, modules: modules(2) } }, ...repair],
  } };
  const clock = { value: 0 }, stop = { value: false };
  const options: SelfImprovementOptions = { storage: { mode: "CREATE", ledgerPath: join(dir, "ledger"), checkpointPath: join(dir, "checkpoint"), sourceDirectory: join(dir, "sources"), receiptDirectory: join(dir, "receipts"),
    config: { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", campaignId, currencyUnit: "MICRO_USD", limits: { incident: 147104, campaign: 147104, day: 147104, month: 147104 } } },
    observation, baseSource, fakeFixture, memory: { snapshot: createApprovedSnapshot([], [], now), approvals: [] }, nowUtc: () => now, monotonicMs: () => clock.value, killSwitch: () => stop.value };
  return { options, clock, stop, seed, g1, dir };
}
async function setup() { const dir = await realpath(await mkdtemp(join(tmpdir(), "rsi-self-improve-"))); dirs.push(dir); return inputs(dir); }
// Injection verifies host orchestration contracts only. Actual opt-in below does
// not call this helper or count this mock's DOCKER_CLI label as custody proof.
async function injected() {
  const closure = structuredClone(await core.measureFixedClosure("R4"));
  const execute = vi.fn(async (r: { source: string; input: { payload: { modelReply: unknown } } }) => ({ untrustedOutput: r.input.payload.modelReply,
    evidence: { kind: "LOCAL_CONTAINER_RETURN", transportKind: "DOCKER_CLI", sourceDigest: hash(r.source), inputDigest: jhash(r.input), outputDigest: jhash({ schemaVersion: 1, output: r.input.payload.modelReply }),
      policyDigest: SANDBOX_POLICY_DIGEST, imageDigest: SANDBOX_POLICY.image, runtime: `${SANDBOX_POLICY.nodeVersion} linux arm64`, isolation: { hostContractFixture: true } } }));
  const evaluate = vi.fn(async (r: { source: string; sourceDigest: string; fixture: string }) => {
    const red = r.fixture === "NATIVE_RECEIVER" && r.source.includes("input.fetch.bind(input)");
    return { verdict: red ? "FAIL" : r.fixture === "NATIVE_RECEIVER" ? "PASS" : "NO_CHANGE", reason: "ORACLE_RESULT", reasonCode: red ? "ORACLE_MISMATCH" : r.fixture === "NATIVE_RECEIVER" ? "SIX_PATHS_VERIFIED" : r.fixture === "NORMAL" ? "NORMAL" : "EXTERNAL_FAILURE", greenVerified: !red && ["NATIVE_RECEIVER", "NORMAL"].includes(r.fixture),
      provenance: { transportKind: "DOCKER_CLI", sourceDigest: r.sourceDigest, fixture: r.fixture, manifestDigest: closure.evaluator.manifestDigest, callCount: red ? 0 : 6, childSpawns: 1, dispatchAttempts: 1,
        deadlineExpired: false, cleanupConfirmed: true, disposalConfirmed: true, logs: { valid: true, warningCount: 1, rejectedCount: 0, forbiddenMarkerCount: 0, custody: { stdoutEof: true, stderrEof: true, errorCount: 0, prematureCloseCount: 0 } }, receiptDigest: hash("injected"), traceDigest: hash("injected-trace"), responseDigest: hash("injected-response") } };
  });
  vi.spyOn(DockerSandbox, "verify").mockResolvedValue({ execute } as unknown as DockerSandbox);
  vi.spyOn(NativeExecutor, "verify").mockResolvedValue({ evaluate } as unknown as NativeExecutor);
  return { execute, evaluate };
}
async function readState(s: Awaited<ReturnType<typeof setup>>, checkpoint: unknown) { return (await LocalRsiLedger.open(s.options.storage.ledgerPath, checkpoint)).readImprovement(); }

describe("fixed two-generation self-improvement supervisor (injected orchestration)", () => {
  it("reopens ledger/checkpoint/source and actually executes exact promoted g1 for generation two", async () => {
    const s = await setup(), f = await injected(), opens = vi.spyOn(LocalRsiLedger, "open"), cp = vi.spyOn(ControllerCheckpointStore, "open");
    const result = await runSelfImprovement(s.options);
    expect(result.status).toBe("COMPLETED"); expect(result.actualRecovery).toBe(false); expect(result.completedGenerations).toBe(2);
    expect(opens).toHaveBeenCalledTimes(1); expect(cp).toHaveBeenCalledTimes(1);
    const state = await readState(s, result.checkpoint); expect(state.catalog.map(c => c.kind)).toEqual(["SEED", "PROMOTE", "PROMOTE"]);
    expect(state.executions.map(e => e.calls.map(c => c.phase))).toEqual([["BASELINE_REPAIR", "BASELINE_REPAIR", "GENERATE_AGENT", "PROMOTION_REPAIR", "PROMOTION_REPAIR"], ["GENERATE_AGENT", "PROMOTION_REPAIR", "PROMOTION_REPAIR"]]);
    expect(state.executions.map(e => e.settlement?.kind)).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(state.executions[1].intent.activeAgentHash).toBe(s.g1.agentHash);
    expect(f.execute.mock.calls.filter(([r]) => (r.input as { taskKind?: string }).taskKind === "improve-agent").map(([r]) => hash(r.source))).toEqual([s.seed.compiledDigest, s.g1.compiledDigest]);
    expect(f.execute).toHaveBeenCalledTimes(8); expect(f.evaluate).toHaveBeenCalledTimes(18);
    const receipts = await Promise.all(result.receiptPaths.map(p => readFile(p, "utf8")));
    expect(receipts.join("")).not.toContain("export default"); expect(receipts.join("")).toContain("UNCONFIRMED");
    expect((await (await LocalRsiLedger.open(s.options.storage.ledgerPath, result.checkpoint)).read()).runs).toHaveLength(0);
  });
  it("preserves g1 when g2 returns NO_CHANGE and never explores another complete proposal", async () => {
    const s = await setup(); await injected(); s.options.fakeFixture.generations[2][0] = { kind: "JSON_RESPONSE", response: { action: "NO_CHANGE", reason: "LOCAL_FAKE" } };
    const r = await runSelfImprovement(s.options), state = await readState(s, r.checkpoint);
    expect(r.status).toBe("BLOCKED"); expect(r.completedGenerations).toBe(1); expect(state.catalog.at(-1)?.source.agentHash).toBe(s.g1.agentHash);
    expect(state.executions[1].status).toBe("REJECTED"); expect(state.executions[1].calls).toHaveLength(1); expect(state.executions[1].settlement?.kind).toBe("CONFIRMED");
  });
  it("rejects unfinished restart, repeat execution and generation three without reservation reset", async () => {
    const s = await setup(); await injected(); s.options.fakeFixture.generations[1][0] = { kind: "INVALID_USAGE" };
    const first = await runSelfImprovement(s.options), before = await readState(s, first.checkpoint);
    const r = await runSelfImprovement({ ...s.options, storage: { ...s.options.storage, mode: "OPEN", trustedCheckpoint: first.checkpoint! } });
    expect(r.status).toBe("BLOCKED"); expect(r.reasonCode).toBe("RESTART_FORBIDDEN");
    const after = await readState(s, first.checkpoint); expect(after).toEqual(before); expect(after.executions).toHaveLength(1); expect(after.executions[0].settlement?.consumedUnits).toBe(73552);
  });
  it("preserves only allowlisted root failure codes without raw error details", async () => {
    const s = await setup(); await injected(); vi.spyOn(core, "measureFixedClosure").mockRejectedValue(new Error("RSI_CONTROLLER_NATIVE_UNKNOWN"));
    const r = await runSelfImprovement(s.options); expect(r.failureCode).toBe("RSI_CONTROLLER_NATIVE_UNKNOWN");
    const other = await setup(); vi.spyOn(core, "measureFixedClosure").mockRejectedValue(new Error("secret/private/path source stack"));
    const unknown = await runSelfImprovement(other.options); expect(unknown.failureCode).toBe("UNKNOWN_ERROR"); expect(JSON.stringify(unknown)).not.toContain("secret/private");
  });
  it("keeps lower configured budgets rather than raising them to fit a pool", async () => {
    const s = await setup(), f = await injected(); if (s.options.storage.mode === "CREATE") s.options.storage.config.limits.incident = 73551;
    const r = await runSelfImprovement(s.options); expect(r.reasonCode).toBe("BUDGET_UNAVAILABLE"); expect(f.execute).not.toHaveBeenCalled(); expect((await readState(s, r.checkpoint)).executions).toHaveLength(0);
  });
  it.each([NaN, -1, Infinity])("blocks invalid initial monotonic clock %s before storage IO", async value => {
    const s = await setup(); s.clock.value = value; const r = await runSelfImprovement(s.options); expect(r.status).toBe("BLOCKED"); expect(await readdir(s.dir)).toEqual([]);
  });
  it("checks initial stop before opening any storage", async () => { const s = await setup(); s.stop.value = true; expect((await runSelfImprovement(s.options)).reasonCode).toBe("OPERATOR_STOP"); expect(await readdir(s.dir)).toEqual([]); });
  it("starts generation two deadline before fresh ledger open, without a helper reset", async () => {
    const s = await setup(); await injected(); const original = LocalRsiLedger.open;
    vi.spyOn(LocalRsiLedger, "open").mockImplementationOnce(async (...args) => { s.clock.value += 120000; return original.apply(LocalRsiLedger, args); });
    const r = await runSelfImprovement(s.options); expect(r.completedGenerations).toBe(1); expect(r.reasonCode).toBe("DEADLINE_EXPIRED"); expect((await readState(s, r.checkpoint)).executions).toHaveLength(1);
  });
  it("rejects changed active source bytes on fresh generation two instead of seed fallback", async () => {
    const s = await setup(); await injected(); const original = LocalRsiLedger.open;
    vi.spyOn(LocalRsiLedger, "open").mockImplementationOnce(async (...args) => {
      const ledger = await original.apply(LocalRsiLedger, args), active = (await ledger.readImprovement()).catalog.at(-1)!;
      const p = join(s.options.storage.sourceDirectory, `${active.source.artifactDigest}.source.json`); await chmod(p, 0o600); await writeFile(p, "{}"); await chmod(p, 0o400); return ledger;
    });
    const r = await runSelfImprovement(s.options); expect(r.completedGenerations).toBe(1); expect(r.reasonCode).toBe("SOURCE_UNAVAILABLE"); expect((await readState(s, r.checkpoint)).executions).toHaveLength(1);
    const failure = r.receiptPaths.find(p => p.endsWith("supervisor-1.failure.json")); expect(failure).toBeDefined();
    expect(JSON.parse(await readFile(failure!, "utf8"))).toMatchObject({ reasonCode: "SOURCE_UNAVAILABLE", completedGenerations: 1 });
  });
  it("keeps durable promotion when outcome receipt is unavailable, and blocks follow-up", async () => {
    const s = await setup(); await injected(); const persist = ControllerCheckpointStore.prototype.persist;
    vi.spyOn(ControllerCheckpointStore.prototype, "persist").mockImplementation(async function(c) {
      await persist.call(this, c); const state = await (await LocalRsiLedger.open(s.options.storage.ledgerPath, c)).readImprovement();
      if (state.executions.at(-1)?.status === "PROMOTED") await chmod(s.options.storage.receiptDirectory, 0o500);
    });
    const r = await runSelfImprovement(s.options); expect(r.status).toBe("PARTIAL"); expect(r.reasonCode).toBe("RECEIPT_UNCERTAIN"); expect(r.completedGenerations).toBe(1);
    expect((await readState(s, r.checkpoint)).executions[0].status).toBe("PROMOTED"); expect(r.lastPublished?.source.agentHash).toBe(s.g1.agentHash);
    await chmod(s.options.storage.receiptDirectory, 0o700);
  });
  it("treats post-promotion metadata read failure as receipt partial, never accounting rollback", async () => {
    const s = await setup(); await injected(); const original = LocalRsiLedger.prototype.readImprovement; let publishedReads = 0;
    vi.spyOn(LocalRsiLedger.prototype, "readImprovement").mockImplementation(async function() {
      const state = await original.call(this);
      if (state.executions[0]?.status === "PROMOTED" && ++publishedReads === 2) throw new Error("injected metadata read failure");
      return state;
    });
    const r = await runSelfImprovement(s.options); expect(r.status).toBe("PARTIAL"); expect(r.reasonCode).toBe("RECEIPT_UNCERTAIN"); expect(r.completedGenerations).toBe(1);
    expect((await readState(s, r.checkpoint)).executions[0].status).toBe("PROMOTED");
  });
  it("preserves completed g1 on late stop and refuses generation two", async () => {
    const s = await setup(); await injected(); const persist = ControllerCheckpointStore.prototype.persist;
    vi.spyOn(ControllerCheckpointStore.prototype, "persist").mockImplementation(async function(c) { await persist.call(this, c);
      const ledger = await LocalRsiLedger.open(s.options.storage.ledgerPath, c); if ((await ledger.readImprovement()).executions.at(-1)?.status === "PROMOTED") s.stop.value = true; });
    const r = await runSelfImprovement(s.options); expect(r.completedGenerations).toBe(1); expect(r.reasonCode).toBe("OPERATOR_STOP"); expect(r.lastPublished?.source.agentHash).toBe(s.g1.agentHash);
  });
  it("rolls back only the immediate actual-validated source without deleting costs", async () => {
    const s = await setup(); await injected(); const r = await runSelfImprovement(s.options);
    const rollback = await rollbackSelfImprovement({ ...s.options, storage: { ...s.options.storage, mode: "OPEN", trustedCheckpoint: r.checkpoint! } });
    expect(rollback.status).toBe("ROLLED_BACK"); expect(rollback.lastPublished?.source.agentHash).toBe(s.g1.agentHash);
    const state = await readState(s, rollback.checkpoint); expect(state.executions).toHaveLength(2); expect(state.executions.every(e => e.settlement?.kind === "CONFIRMED")).toBe(true); expect(state.catalog.at(-1)?.kind).toBe("ROLLBACK");
  });
});

it.skipIf(process.env.RSI_R4_PROBE !== "1")("actual pinned g0 to fresh g1 to g2 local mechanism", async () => {
  const dir = process.env.RSI_R4_PROBE_DIRECTORY!, campaign = process.env.RSI_R4_PROBE_CAMPAIGN!;
  if (!dir || !campaign) throw new Error("R4_RUN_PLAN_REQUIRED");
  // Directory is predeclared in run-plan, preserved even on failure. No retries.
  const s = await inputs(dir, campaign); s.options.monotonicMs = () => performance.now();
  const result = await runSelfImprovement(s.options);
  await writeFile(join(dir, "acceptance-result.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
  expect(result.status).toBe("COMPLETED"); expect(result.completedGenerations).toBe(2);
}, 260000);
