import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImmutableAgentSourceStore, LabPromotionSession, initializeLabCatalog, loadLabActiveAgent, rollbackLabCatalog, validateAgentProposal } from "../../scripts/rsi/promotion";
import { ControllerCheckpointStore } from "../../scripts/rsi/controller";
import { LocalRsiLedger } from "../../scripts/rsi/ledger";
import { LocalFakeModelBroker, type FakeScenario } from "../../scripts/rsi/model-broker";
import { createApprovedSnapshot } from "../../scripts/rsi/memory";
import { R4_POLICY_DIGEST, type R4ExecutionIntent } from "../../scripts/rsi/execution-contracts";
import { deriveIncidentKey, deriveKst, deriveObservationFingerprint, RSI_PUBLIC_PATHS } from "../../scripts/rsi/contracts";
import * as core from "../../scripts/rsi/repair-core";
import { DockerSandbox, SANDBOX_POLICY, SANDBOX_POLICY_DIGEST } from "../../scripts/rsi/sandbox";
import { NativeExecutor } from "../../scripts/rsi/native-executor";

const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const jhash = (v: unknown) => hash(JSON.stringify(v));
const now = "2026-10-22T15:30:00.000Z";
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function directory() { const p = await realpath(await mkdtemp(join(tmpdir(), "rsi-promotion-"))); dirs.push(p); return p; }
const modules = (generation = 1) => ({
  "scripts/rsi/agent/diagnostic-policy.ts": "export function diagnose(p) { return p.modelReply; }\n",
  "scripts/rsi/agent/repair-policy.ts": `import { diagnose } from "./diagnostic-policy";\nexport default function strategy(input) { if (input.payload.phase === "DIAGNOSE") return diagnose(input.payload); return input.payload.modelReply; }\n// synthetic generation ${generation}\n`,
});
const proposal = (baseAgentHash: string, generation = 1) => ({ schemaVersion: 1, action: "PROPOSE_AGENT", baseAgentHash, modules: modules(generation) });
function observation() {
  return { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", target: "RSI_PUBLIC_SIX_PATHS",
    incident: { source: "LOCAL_SYNTHETIC", baseAppSha: "a".repeat(40), workerVersion: randomUUID(), errorCode: "UNEXPECTED_ERROR", failedPaths: [...RSI_PUBLIC_PATHS] },
    trigger: "on-demand", actor: "OPERATOR", sourceEventId: randomUUID(), observedAtUtc: now, observedAtKst: deriveKst(now),
    window: { startUtc: "2026-10-01T00:00:00.000Z", endUtc: "2026-11-01T00:00:00.000Z" }, checkedPaths: [...RSI_PUBLIC_PATHS], verdict: "FAIL",
    evidence: [{ evidenceId: randomUUID(), kind: "OBSERVATION", digest: hash("synthetic-observation"), verdict: "FAIL", commandId: null }] };
}
function diagnosis(obs: ReturnType<typeof observation>) {
  return { action: "DIAGNOSE", hypotheses: [
    { cause: "NATIVE_FETCH_RECEIVER", supportingEvidenceIds: [obs.evidence[0].evidenceId], refutingEvidenceIds: "UNKNOWN" },
    { cause: "UPSTREAM_HTTP", supportingEvidenceIds: "UNKNOWN", refutingEvidenceIds: [obs.evidence[0].evidenceId] },
  ], reproducer: "PUBLIC_SIX_PATHS", relatedRegressions: ["NORMAL", "HTTP_STATUS", "AUTH_REDIRECT", "AUTH_STATUS"] };
}
function patch(baseSource: string) { return { action: "PATCH", path: "app/features/operations/rsi-self-check.ts", baseSourceDigest: hash(baseSource), find: "input.fetch.bind(input)", replace: "input.fetch.bind(globalThis)" }; }
// These monkeypatches exercise supervisor wiring only. They do not prove actual
// Docker/native execution, transport provenance or model improvement.
async function hostFixture() {
  const closure = structuredClone(await core.measureFixedClosure("R3"));
  closure.controller.scope = "LOCAL_SYNTHETIC_R4_SELF_IMPROVE";
  closure.controllerHash = jhash(closure.controller);
  vi.spyOn(core, "measureFixedClosure").mockResolvedValue(closure);
  const execute = vi.fn(async (request: { source: string; input: { payload: { modelReply: unknown } } }) => ({
    untrustedOutput: request.input.payload.modelReply,
    evidence: { kind: "LOCAL_CONTAINER_RETURN", transportKind: "DOCKER_CLI", sourceDigest: hash(request.source), inputDigest: jhash(request.input), outputDigest: jhash({ schemaVersion: 1, output: request.input.payload.modelReply }), policyDigest: SANDBOX_POLICY_DIGEST,
      imageDigest: SANDBOX_POLICY.image, runtime: `${SANDBOX_POLICY.nodeVersion} linux arm64`, isolation: { hostContractFixture: true } },
  }));
  const evaluate = vi.fn(async (request: { sourceDigest: string; source: string; fixture: string }) => {
    const red = request.fixture === "NATIVE_RECEIVER" && request.source.includes("input.fetch.bind(input)");
    return { verdict: red ? "FAIL" : request.fixture === "NATIVE_RECEIVER" ? "PASS" : "NO_CHANGE", reason: "ORACLE_RESULT",
      reasonCode: red ? "ORACLE_MISMATCH" : request.fixture === "NATIVE_RECEIVER" ? "SIX_PATHS_VERIFIED" : request.fixture === "NORMAL" ? "NORMAL" : "EXTERNAL_FAILURE", greenVerified: !red && ["NATIVE_RECEIVER", "NORMAL"].includes(request.fixture),
      provenance: { transportKind: "DOCKER_CLI", sourceDigest: request.sourceDigest, fixture: request.fixture, manifestDigest: closure.evaluator.manifestDigest, callCount: red ? 0 : 6,
        logs: { valid: true, warningCount: 1, rejectedCount: 0, forbiddenMarkerCount: 0, custody: { stdoutEof: true, stderrEof: true, errorCount: 0, prematureCloseCount: 0 } },
        cleanupConfirmed: true, disposalConfirmed: true, deadlineExpired: false, childSpawns: 1, dispatchAttempts: 1, receiptDigest: hash("fixture-receipt"), traceDigest: hash("fixture-trace"), responseDigest: hash("fixture-response") } };
  });
  vi.spyOn(DockerSandbox, "verify").mockResolvedValue({ execute } as unknown as DockerSandbox);
  vi.spyOn(NativeExecutor, "verify").mockResolvedValue({ evaluate } as unknown as NativeExecutor);
  return { closure, execute, evaluate };
}
async function setup() {
  const dir = await directory(), campaignId = randomUUID();
  const ledgerPath = join(dir, "ledger");
  const ledger = await LocalRsiLedger.create(ledgerPath, { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", campaignId, currencyUnit: "MICRO_USD", limits: { incident: 200000, campaign: 200000, day: 200000, month: 200000 } }, now);
  const checkpointStore = await ControllerCheckpointStore.create(join(dir, "checkpoint"), ledger.checkpoint);
  const sourceStore = await ImmutableAgentSourceStore.create(join(dir, "sources"));
  const clock = { value: 0 }, stopped = { value: false };
  const common = { ledger, sourceStore, checkpointStore, nowUtc: () => now, monotonicMs: () => clock.value, killSwitch: () => stopped.value, rootTiming: { startedMs: 0, deadlineMs: 120000 } };
  const active = await initializeLabCatalog(common);
  const memory = { snapshot: createApprovedSnapshot([], [], now), approvals: [] };
  const baseSource = (await readFile(new URL("../../app/features/operations/rsi-self-check.ts", import.meta.url), "utf8")).replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)");
  const obs = observation();
  return { dir, ledgerPath, campaignId, common, active, memory, baseSource, obs, clock, stopped };
}
async function session(s: Awaited<ReturnType<typeof setup>>, fixture: Awaited<ReturnType<typeof hostFixture>>, generation: 1 | 2 = 1, response?: unknown) {
  const active = await loadLabActiveAgent(s.common);
  const scenarios: FakeScenario[] = [
    ...(generation === 1 ? [{ kind: "JSON_RESPONSE" as const, response: diagnosis(s.obs) }, { kind: "JSON_RESPONSE" as const, response: patch(s.baseSource) }] : []),
    { kind: "JSON_RESPONSE", response: response ?? proposal(active.source.agentHash, generation) },
    { kind: "JSON_RESPONSE", response: diagnosis(s.obs) }, { kind: "JSON_RESPONSE", response: patch(s.baseSource) },
  ];
  const fakeFixture = { schemaVersion: 1, mode: "LOCAL_FAKE", scenarios };
  const prior = (await s.common.ledger.readImprovement()).executions[0];
  const intent: R4ExecutionIntent = { schemaVersion: 1, purpose: "R4_SELF_IMPROVE", executionId: randomUUID(), requestId: randomUUID(), campaignId: s.campaignId,
    generation, parentExecutionId: generation === 1 ? null : prior.intent.executionId,
    expectedCatalogRevision: active.catalog.revision, expectedCatalogHash: active.catalog.hash, activeAgentHash: active.source.agentHash, activeCompiledDigest: active.source.compiledDigest, activeSourceArtifactDigest: active.source.artifactDigest,
    observation: s.obs as R4ExecutionIntent["observation"], incidentKey: deriveIncidentKey(s.obs.incident), incidentEpoch: 1, observationFingerprint: deriveObservationFingerprint(s.obs), baseAppSha: s.obs.incident.baseAppSha,
    controllerHash: fixture.closure.controllerHash, evaluatorHash: fixture.closure.evaluatorHash, memorySnapshotHash: s.memory.snapshot.hash, policyDigest: R4_POLICY_DIGEST,
    // Both generations use the same trusted fixture corpus, not newly approved memory.
    fakeFixtureDigest: prior?.intent.fakeFixtureDigest ?? jhash(fakeFixture) };
  // Gen2 uses the original fixed fixture descriptor; broker replies remain local
  // supervisor fixtures. No fixture statement proves actual model authorship.
  const descriptor = generation === 1 ? fakeFixture : JSON.parse(await readFile(join(s.dir, "fake-fixture.json"), "utf8"));
  if (generation === 1) await writeFile(join(s.dir, "fake-fixture.json"), JSON.stringify(fakeFixture));
  const broker = await LocalFakeModelBroker.openImprovement({ ...s.common, intent, scenarios, checkpointSink: c => s.common.checkpointStore.persist(c) });
  const opened = await LabPromotionSession.open({ ...s.common, broker, intent, fakeFixture: descriptor, memory: s.memory, baseSource: s.baseSource });
  return { opened, broker, intent };
}

describe("R4 immutable source data", () => {
  it("stores canonical exact modules immutably and recompiles every read", async () => {
    const dir = await directory(), store = await ImmutableAgentSourceStore.create(join(dir, "source"));
    const source = await store.put(modules());
    const read = await store.read(source);
    expect(read.modules).toEqual(modules());
    expect(read.agent.compiledDigest).toBe(source.compiledDigest);
    expect(await store.put(modules())).toEqual(source);
    expect(await ImmutableAgentSourceStore.open(store.directory).then(s => s.read(source))).toEqual(read);
    await expect(store.read({ ...source, compiledDigest: hash("forged") })).rejects.toThrow("RSI_PROMOTION_SOURCE_UNAVAILABLE");
  });
  it.each(["partial", "replacement", "mode", "symlink", "hardlink", "missing"])("rejects %s source without repair or fallback", async fault => {
    const dir = await directory(), store = await ImmutableAgentSourceStore.create(join(dir, "source")), source = await store.put(modules());
    const path = join(store.directory, `${source.artifactDigest}.source.json`);
    if (fault === "partial") { await chmod(path, 0o600); await writeFile(path, "{"); await chmod(path, 0o400); }
    if (fault === "replacement") { await rename(path, join(dir, "old")); await writeFile(path, "{}", { mode: 0o400 }); }
    if (fault === "mode") await chmod(path, 0o600);
    if (fault === "hardlink") await link(path, join(dir, "link"));
    if (fault === "symlink") { await rename(path, join(dir, "old")); await symlink(join(dir, "old"), path); }
    if (fault === "missing") await rm(path);
    await expect(store.read(source)).rejects.toThrow("RSI_PROMOTION_SOURCE_UNAVAILABLE");
  });
  it("rejects relative and symlinked store roots and root replacement", async () => {
    const dir = await directory();
    await expect(ImmutableAgentSourceStore.create("relative")).rejects.toThrow();
    const store = await ImmutableAgentSourceStore.create(join(dir, "source"));
    await symlink(store.directory, join(dir, "alias"));
    await expect(ImmutableAgentSourceStore.open(join(dir, "alias"))).rejects.toThrow();
    await rename(store.directory, join(dir, "old"));
    await ImmutableAgentSourceStore.create(store.directory);
    await expect(store.put(modules())).rejects.toThrow();
  });
  it("rejects proposal authority fields, forbidden modules, base changes, same hash and invalid ABI", async () => {
    const seed = await core.compileAgentSources(await core.loadSeedAgentSources());
    const valid = proposal(seed.agentHash);
    expect((await validateAgentProposal(valid, seed.agentHash)).agent.agentHash).not.toBe(seed.agentHash);
    const invalid = [ { ...valid, PASS: true }, { ...valid, baseAgentHash: hash("wrong") }, { ...valid, modules: { ...valid.modules, "scripts/rsi/controller.ts": "export default 1" } },
      { ...valid, modules: { ...valid.modules, [core.AGENT_PATHS[0]]: "x".repeat(32001) } },
      { ...valid, modules: await core.loadSeedAgentSources() }, { ...valid, modules: { ...valid.modules, [core.AGENT_PATHS[1]]: 'import x from "node:fs"; export default x;' } },
      { ...valid, modules: { ...valid.modules, [core.AGENT_PATHS[1]]: "export default 42;" } }, { ...valid, modules: { ...valid.modules, [core.AGENT_PATHS[1]]: "export const strategy = 42;" } },
    ];
    for (const raw of invalid) await expect(validateAgentProposal(raw, seed.agentHash)).rejects.toThrow();
  });
  it("never executes getters or proxy traps at the source/proposal boundary", async () => {
    const trap = vi.fn(() => { throw new Error("TRAP"); });
    const raw = { schemaVersion: 1, action: "PROPOSE_AGENT", baseAgentHash: hash("base"), get modules() { return trap(); } };
    await expect(validateAgentProposal(raw, hash("base"))).rejects.toThrow();
    await expect(validateAgentProposal(new Proxy({}, { ownKeys: trap, getPrototypeOf: trap, get: trap }), hash("base"))).rejects.toThrow();
    expect(trap).not.toHaveBeenCalled();
  });
});

describe("R4 promotion fixed supervisor (host boundary fixtures only)", () => {
  it("keeps genesis unverified and refuses caller-forged proposal rights without dispatch", async () => {
    const s = await setup(), fixture = await hostFixture(), { opened } = await session(s, fixture);
    expect(s.active.catalog.binding).toBeNull();
    await expect(opened.promote({ source: s.active.source } as never)).rejects.toThrow("RSI_PROMOTION_PROPOSAL_AUTHORITY");
    expect(fixture.execute).not.toHaveBeenCalled();
    await expect(rollbackLabCatalog(s.common)).rejects.toThrow();
  });
  it("binds actual returned proposal, stops at one proposal and publishes only after CONFIRMED and checkpoint", async () => {
    const s = await setup(), fixture = await hostFixture(), { opened, intent } = await session(s, fixture);
    const generated = await opened.generateProposal();
    expect(fixture.execute).toHaveBeenCalledTimes(3);
    await expect(opened.generateProposal()).rejects.toThrow();
    const result = await opened.promote(generated);
    expect(result.status).toBe("PROMOTED");
    const state = await s.common.ledger.readImprovement(), run = state.executions[0];
    expect(run.status).toBe("PROMOTED"); expect(run.settlement?.kind).toBe("CONFIRMED");
    expect(run.calls.map(c => c.phase)).toEqual(["BASELINE_REPAIR", "BASELINE_REPAIR", "GENERATE_AGENT", "PROMOTION_REPAIR", "PROMOTION_REPAIR"]);
    expect(run.proposal?.generationBinding.executionId).toBe(intent.executionId);
    expect(state.catalog.at(-1)?.source).toEqual(generated.source);
    await s.common.checkpointStore.assertCurrent(s.common.ledger.checkpoint);
    expect(result.memoryEvidence.usage).toBe("UNCONFIRMED");
    expect(result.memoryEvidence.usageReasonCode).toBe("SELECTION_AND_DELIVERY_DO_NOT_PROVE_USE");
  });
  it.each(["generation-transport", "generation-output", "probe-transport", "probe-cleanup", "probe-regression"])("blocks %s with settled cost and no catalog promotion", async fault => {
    const s = await setup(), fixture = await hostFixture(), { opened } = await session(s, fixture);
    if (fault.startsWith("generation")) {
      const original = fixture.execute.getMockImplementation()!;
      fixture.execute.mockImplementation(async request => {
        const returned = await original(request);
        if ((request.input as unknown as { taskKind: string }).taskKind === "improve-agent") {
          if (fault.endsWith("transport")) returned.evidence.transportKind = "INJECTED_TRANSPORT";
          else returned.evidence.outputDigest = hash("forged");
        }
        return returned;
      });
      await expect(opened.generateProposal()).rejects.toThrow();
    } else {
      const generated = await opened.generateProposal(), original = fixture.evaluate.getMockImplementation()!;
      fixture.evaluate.mockImplementation(async request => { const result = await original(request); if (fault.endsWith("transport")) result.provenance.transportKind = "INJECTED_TRANSPORT"; if (fault.endsWith("cleanup")) result.provenance.cleanupConfirmed = false; if (fault.endsWith("regression") && request.fixture === "AUTH_STATUS_FAILURE") result.reasonCode = "NORMAL"; return result; });
      await expect(opened.promote(generated)).rejects.toThrow();
    }
    const state = await s.common.ledger.readImprovement();
    expect(state.catalog).toHaveLength(1); expect(state.executions[0].settlement).not.toBeNull();
    expect(state.executions[0].status).not.toBe("PROMOTED");
  });
  it("does not accept a copied or foreign opaque proposal", async () => {
    const s = await setup(), fixture = await hostFixture(), { opened } = await session(s, fixture), generated = await opened.generateProposal();
    await expect(opened.promote({ ...generated })).rejects.toThrow("RSI_PROMOTION_PROPOSAL_AUTHORITY");
    expect(fixture.execute).toHaveBeenCalledTimes(3);
    await opened.promote(generated);
  });
  it.each(["kill", "deadline", "source", "closure", "checkpoint", "settlement"])("refuses prepublication %s while retaining audit history", async fault => {
    const s = await setup(), fixture = await hostFixture(), { opened } = await session(s, fixture), generated = await opened.generateProposal();
    if (fault === "kill") s.stopped.value = true;
    if (fault === "deadline") s.clock.value = 120000;
    if (fault === "source") await rm(join(s.common.sourceStore.directory, `${generated.source.artifactDigest}.source.json`));
    if (fault === "closure") vi.mocked(core.measureFixedClosure).mockResolvedValue({ ...fixture.closure, controllerHash: hash("changed") });
    if (fault === "checkpoint") vi.spyOn(s.common.checkpointStore, "persist").mockRejectedValue(new Error("uncertain"));
    if (fault === "settlement") vi.spyOn(LocalFakeModelBroker.prototype, "finish").mockResolvedValue({ callCount: 5, chargedUnits: 0, receiptDigest: hash("fabricated-confirmed") });
    await expect(opened.promote(generated)).rejects.toThrow();
    const state = await s.common.ledger.readImprovement(); expect(state.catalog).toHaveLength(1); expect(state.executions[0].calls.length).toBeGreaterThanOrEqual(3);
  });
  it("preserves ledger-only publication as ACCOUNTING_UNCERTAIN and never auto-adopts it", async () => {
    const s = await setup(), fixture = await hostFixture(), { opened } = await session(s, fixture), generated = await opened.generateProposal();
    const persist = s.common.checkpointStore.persist.bind(s.common.checkpointStore);
    vi.spyOn(s.common.checkpointStore, "persist").mockImplementation(async c => { if ((await s.common.ledger.readImprovement()).catalog.length > 1) throw new Error("publication checkpoint lost"); await persist(c); });
    await expect(opened.promote(generated)).rejects.toThrow("RSI_PROMOTION_ACCOUNTING_UNCERTAIN");
    expect((await s.common.ledger.readImprovement()).catalog).toHaveLength(2);
    await expect(loadLabActiveAgent(s.common)).rejects.toThrow("RSI_PROMOTION_ACCOUNTING_UNCERTAIN");
    await expect(opened.promote(generated)).rejects.toThrow();
  });
  it("durable publication wins over a late stop; the next execution gate stops", async () => {
    const s = await setup(), fixture = await hostFixture(), { opened } = await session(s, fixture), generated = await opened.generateProposal();
    const persist = s.common.checkpointStore.persist.bind(s.common.checkpointStore);
    vi.spyOn(s.common.checkpointStore, "persist").mockImplementation(async c => { await persist(c); if ((await s.common.ledger.readImprovement()).catalog.length > 1) s.stopped.value = true; });
    expect((await opened.promote(generated)).status).toBe("PROMOTED");
    await expect(loadLabActiveAgent(s.common)).rejects.toThrow("OPERATOR_STOP");
  });
  it("reopens at a trusted checkpoint, executes exact g1 to generate g2, and rolls back only to verified g1 then g0", async () => {
    const s = await setup(), fixture = await hostFixture(), first = await session(s, fixture), g1 = await first.opened.generateProposal();
    await first.opened.promote(g1);
    const settled1 = structuredClone((await s.common.ledger.readImprovement()).executions[0].settlement);
    s.common.ledger = await LocalRsiLedger.open(s.ledgerPath, s.common.ledger.checkpoint);
    const second = await session(s, fixture, 2), g2 = await second.opened.generateProposal();
    const generationCall = fixture.execute.mock.calls.at(-1)![0];
    expect(hash(generationCall.source)).toBe(g1.source.compiledDigest);
    await second.opened.promote(g2);
    const before = await s.common.ledger.readImprovement();
    expect(before.executions[1].calls.map(c => c.phase)).toEqual(["GENERATE_AGENT", "PROMOTION_REPAIR", "PROMOTION_REPAIR"]);
    expect(before.executions[0].settlement).toEqual(settled1);
    const calls = fixture.execute.mock.calls.length;
    const rolled1 = await rollbackLabCatalog(s.common); expect(rolled1.active.source).toEqual(g1.source);
    const rolled0 = await rollbackLabCatalog(s.common); expect(rolled0.active.source).toEqual(s.active.source);
    const after = await s.common.ledger.readImprovement();
    expect(after.catalog.map(c => c.kind)).toEqual(["SEED", "PROMOTE", "PROMOTE", "ROLLBACK", "ROLLBACK"]);
    expect(after.executions).toEqual(before.executions); expect(fixture.execute).toHaveBeenCalledTimes(calls);
    await expect(rollbackLabCatalog(s.common)).rejects.toThrow();
  });
});
