import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControllerCheckpointStore, compileAgentSources, loadSeedAgentSources, recoverSyntheticIncident, validateDiagnosis, validateReceiverPatch } from "../../scripts/rsi/controller";
import { LocalRsiLedger } from "../../scripts/rsi/ledger";
import { deriveIncidentKey, deriveObservationFingerprint, deriveKst, RSI_PUBLIC_PATHS } from "../../scripts/rsi/contracts";
import { DockerSandbox, SANDBOX_POLICY_DIGEST } from "../../scripts/rsi/sandbox";
import { NativeExecutor } from "../../scripts/rsi/native-executor";
import { LocalFakeModelBroker } from "../../scripts/rsi/model-broker";
import { R4_POLICY_DIGEST, deriveSourceAgentHash } from "../../scripts/rsi/execution-contracts";
import { createRepairRootGate, loadPinnedNativeManifest, measureFixedClosure, runActualAgentStep, runActualRepairCore } from "../../scripts/rsi/repair-core";

const manifestRead = vi.hoisted(() => ({ fault: "NONE", unitOnly: false, liveReadsForbidden: false, unitReads: 0, liveReads: 0, driftPath: "", missingPath: "", r4ClosureFixtures: false }));
// Bounded, non-actual fixture for host contracts only. This supplies no image,
// verification capability or real execution proof. Opt-in reads the real file.
const unitManifest = vi.hoisted(() => JSON.stringify({
  schemaVersion: 1,
  imageId: "sha256:b035afe75a5453408f0e878a9405d9f621203acad47763b82372f01d4c958d4b",
  baseImage: "node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5", pnpm: "10.34.5",
  artifacts: {
    packageDigest: "257692887405a71fbc959353de45509e0e0edd001eaab4698091d51bfbf73ae1",
    lockDigest: "3f88797d9a2e666155555976df0b7f0b772e63e4972e707bfe93beb0e31f3f5d",
    wrapperSourceDigest: "c09a4b12277fea13e8754012cc127100ec4178beb4c4ebb6118ace710427144f",
    wrapperDigest: "4a5b6d302805fb36219eb4eeca1375501df7fdd77fc8bf40cdfed8b197b1a1e2",
    oracleDigest: "0a129a6d84a34e68985ea11985215308b57c0e6d9966f86cf3b886ea09146e05",
    contractsDigest: "9c4ce3308aa4fc1aee2a0086a1c7afc75d8d69e75fefef17eb2e06b665eb200d",
    dockerfileDigest: "9ec8db8754ad122711bdb26c0145f1e42aa93b460a819601fd98a2f8dfa323ca",
    harnessDigest: "b680ab34a0adb4089d381b470aa65dbb2b74d451391d247eea25ccd4d89d1c64",
    guardDigest: "4f672be52b7cce434af1b9e23d07515ef5a3c20bf02ad09a6e784e543d060ab5",
  },
  runtime: { node: "v22.23.2", miniflare: "5.20260730.0-alpha", workerd: "1.20261022.1", platform: "linux/arm64",
    workerdBinaryVersion: "workerd 2026-10-22", supportedCompatibilityDate: "2026-10-22", compatibilityDate: "2026-08-05",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    workerdDigest: "878852f43e1664e51e991db1805e1151cf9ea5a19bb98cf6e279793539452f80",
    publicCaDigest: "e3569ed5bde6e59d7718cd962b1f07a95ab0a4226a9fc35a18d8f586f98ea6a4", publicCaCount: 145 },
}));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: async (...args: Parameters<typeof actual.readFile>) => {
    const path = String(args[0]);
    if (manifestRead.missingPath && path.endsWith(manifestRead.missingPath)) throw Object.assign(new Error("missing closure fixture"), { code: "ENOENT" });
    if (manifestRead.r4ClosureFixtures && ["/promotion.ts", "/self-improve.ts"].some(name => path.endsWith(name))) return "// host closure measurement fixture only\n" + (path.endsWith(manifestRead.driftPath || "<none>") ? "// drift\n" : "");
    if (manifestRead.driftPath && path.endsWith(manifestRead.driftPath)) return String(await actual.readFile(...args)) + "\n// closure drift\n";
    if (path.endsWith("/fixtures/native-manifest.pinned.json")) {
      if (manifestRead.fault === "ABSENT") throw Object.assign(new Error("synthetic missing manifest"), { code: "ENOENT" });
      if (manifestRead.fault === "INVALID") return "{";
      if (manifestRead.fault === "PIN") return JSON.stringify({ schemaVersion: 1, imageId: "sha256:" + "0".repeat(64) });
      if (manifestRead.unitOnly || process.env.RSI_CONTROLLER_PROBE !== "1") { manifestRead.unitReads++; return unitManifest; }
      manifestRead.liveReads++;
      if (manifestRead.liveReadsForbidden) throw new Error("live artifact unavailable to unit fixture");
    }
    return actual.readFile(...args);
  } };
});
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const now = "2026-10-22T15:00:00.000Z";
const dirs: string[] = [];
afterEach(async () => { Object.assign(manifestRead, { fault: "NONE", unitOnly: false, liveReadsForbidden: false, unitReads: 0, liveReads: 0, driftPath: "", missingPath: "", r4ClosureFixtures: false }); vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const service = () => readFile(new URL("../../app/features/operations/rsi-self-check.ts", import.meta.url), "utf8");
function observation(normal = false) {
  return { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", target: "RSI_PUBLIC_SIX_PATHS",
    incident: { source: "LOCAL_SYNTHETIC", baseAppSha: "a".repeat(40), workerVersion: randomUUID(), errorCode: normal ? "NONE" : "UNEXPECTED_ERROR", failedPaths: normal ? [] : [...RSI_PUBLIC_PATHS] },
    trigger: "on-demand", actor: "OPERATOR", sourceEventId: randomUUID(), observedAtUtc: now, observedAtKst: deriveKst(now),
    window: { startUtc: "2026-10-01T00:00:00.000Z", endUtc: "2026-11-01T00:00:00.000Z" }, checkedPaths: [...RSI_PUBLIC_PATHS], verdict: normal ? "PASS" : "FAIL",
    evidence: [{ evidenceId: randomUUID(), kind: "OBSERVATION", digest: hash("synthetic-observation"), verdict: normal ? "PASS" : "FAIL", commandId: null }] };
}
function diagnosis(obs: ReturnType<typeof observation>) {
  return { action: "DIAGNOSE", hypotheses: [
    { cause: "NATIVE_FETCH_RECEIVER", supportingEvidenceIds: [obs.evidence[0].evidenceId], refutingEvidenceIds: "UNKNOWN" },
    { cause: "UPSTREAM_HTTP", supportingEvidenceIds: "UNKNOWN", refutingEvidenceIds: [obs.evidence[0].evidenceId] },
  ], reproducer: "PUBLIC_SIX_PATHS", relatedRegressions: ["NORMAL", "HTTP_STATUS", "AUTH_REDIRECT", "AUTH_STATUS"] };
}
function patch(source: string, replace = "input.fetch.bind(globalThis)") {
  return { action: "PATCH", path: "app/features/operations/rsi-self-check.ts", baseSourceDigest: hash(source), find: "input.fetch.bind(input)", replace };
}
async function setup(limit = 200000) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "rsi-controller-"))); dirs.push(dir);
  const ledger = await LocalRsiLedger.create(join(dir, "ledger"), { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", campaignId: randomUUID(), currencyUnit: "MICRO_USD", limits: { incident: limit, campaign: limit, day: limit, month: limit } }, now);
  const checkpointStore = await ControllerCheckpointStore.create(join(dir, "checkpoint"), ledger.checkpoint);
  return { ledger, checkpointStore, nowUtc: () => now, killSwitch: () => false };
}

// Contract fixtures replace the trusted APIs in this host test only. The CLI
// labels exercise receipt validation; they prove no actual container/native run.
function injectHostCapabilities(outcome: "NORMAL" | "RED") {
  const execute = vi.fn(async (request: { source: string; input: { payload: { modelReply: unknown } } }) => ({
    untrustedOutput: request.input.payload.modelReply,
    evidence: { transportKind: "DOCKER_CLI", sourceDigest: hash(request.source), inputDigest: hash(JSON.stringify(request.input)), outputDigest: hash(JSON.stringify({ schemaVersion: 1, output: request.input.payload.modelReply })), policyDigest: SANDBOX_POLICY_DIGEST },
  }));
  const evaluate = vi.fn(async (request: { sourceDigest: string; fixture: string }) => ({
    verdict: outcome === "NORMAL" ? "PASS" : "FAIL", reason: "ORACLE_RESULT", reasonCode: outcome === "NORMAL" ? "SIX_PATHS_VERIFIED" : "ORACLE_MISMATCH", redReproduced: false, greenVerified: outcome === "NORMAL",
    provenance: { transportKind: "DOCKER_CLI", sourceDigest: request.sourceDigest, fixture: request.fixture,
      manifestDigest: "605ad858ec0c49edda87c5b733d06bf04c954388bb619a1e81664400d20627ae", callCount: outcome === "NORMAL" ? 6 : 0,
      logs: { valid: true, warningCount: 1, rejectedCount: 0, forbiddenMarkerCount: 0, custody: { stdoutEof: true, stderrEof: true, errorCount: 0, prematureCloseCount: 0 } },
      cleanupConfirmed: true, disposalConfirmed: true, deadlineExpired: false, childSpawns: 1, dispatchAttempts: 1,
      receiptDigest: hash("injected-receipt"), traceDigest: hash("injected-trace"), responseDigest: hash("injected-response") },
  }));
  vi.spyOn(DockerSandbox, "verify").mockResolvedValue({ execute } as unknown as DockerSandbox);
  vi.spyOn(NativeExecutor, "verify").mockResolvedValue({ evaluate } as unknown as NativeExecutor);
  return { execute, evaluate };
}

describe("shared actual repair core contracts (host data only)", () => {
  it("ships the original archived manifest bytes and loads only the fixed tracked pin", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const bytes = await actualFs.readFile(new URL("../../scripts/rsi/fixtures/native-manifest.pinned.json", import.meta.url), "utf8");
    expect(hash(bytes)).toBe("565a59da1f318f959b67ba3aa8d18c467cdca3695c9065f8da1136ac7acef373");
    expect(hash(JSON.stringify(JSON.parse(bytes)))).toBe("605ad858ec0c49edda87c5b733d06bf04c954388bb619a1e81664400d20627ae");
    expect(await loadPinnedNativeManifest()).toEqual(JSON.parse(bytes));
    for (const fault of ["ABSENT", "INVALID", "PIN"]) {
      manifestRead.fault = fault;
      await expect(loadPinnedNativeManifest()).rejects.toThrow("RSI_CONTROLLER_MANIFEST_UNVERIFIED");
    }
  });
  it("measures actual shared-core bytes in R3 while keeping the R4 closure fail closed", async () => {
    const r3 = await measureFixedClosure("R3");
    expect(r3.controller.files).toHaveProperty("scripts/rsi/repair-core.ts");
    expect(r3.evaluator.files).toHaveProperty("scripts/rsi/repair-core.ts");
    manifestRead.driftPath = "/repair-core.ts";
    const changed = await measureFixedClosure("R3");
    expect(changed.controllerHash).not.toBe(r3.controllerHash); expect(changed.evaluatorHash).not.toBe(r3.evaluatorHash);
    manifestRead.driftPath = ""; manifestRead.missingPath = "/promotion.ts";
    await expect(measureFixedClosure("R4")).rejects.toThrow("RSI_CONTROLLER_CLOSURE_UNVERIFIED");
  });
  it.each(["package.json", "pnpm-lock.yaml", "scripts/rsi/fixtures/native-runtime/package.json", "scripts/rsi/fixtures/native-runtime/pnpm-lock.yaml"])("binds evolving app and fixed native dependency bytes separately: %s", async path => {
    const original = await measureFixedClosure("R4");
    expect(original.controller.files).toHaveProperty(path);
    expect(original.evaluator.files).toHaveProperty(path);
    manifestRead.driftPath = new URL("../../" + path, import.meta.url).pathname;
    const changed = await measureFixedClosure("R4");
    expect(changed.controllerHash).not.toBe(original.controllerHash);
    expect(changed.evaluatorHash).not.toBe(original.evaluatorHash);
    manifestRead.driftPath = ""; manifestRead.missingPath = new URL("../../" + path, import.meta.url).pathname;
    await expect(measureFixedClosure("R4")).rejects.toThrow("RSI_CONTROLLER_CLOSURE_UNVERIFIED");
  });
  it("binds R3 to its transitive execution contracts without requiring R4-only files", async () => {
    const original = await measureFixedClosure("R3");
    manifestRead.driftPath = "/execution-contracts.ts";
    const changed = await measureFixedClosure("R3");
    expect(changed.controllerHash).not.toBe(original.controllerHash);
    expect(original.controller.files).toHaveProperty("scripts/rsi/execution-contracts.ts");
    manifestRead.driftPath = ""; manifestRead.missingPath = "/execution-contracts.ts";
    await expect(measureFixedClosure("R3")).rejects.toThrow("RSI_CONTROLLER_CLOSURE_UNVERIFIED");
    for (const missing of ["/promotion.ts", "/self-improve.ts"]) {
      manifestRead.missingPath = missing;
      await expect(measureFixedClosure("R3")).resolves.toMatchObject({ controllerHash: original.controllerHash });
    }
  });
  it.each(["execution-contracts.ts", "repair-core.ts", "promotion.ts", "self-improve.ts"])("binds R4 controller and evaluator hashes to %s bytes", async name => {
    manifestRead.r4ClosureFixtures = true;
    const original = await measureFixedClosure("R4");
    manifestRead.driftPath = "/" + name;
    const changed = await measureFixedClosure("R4");
    expect(changed.controllerHash).not.toBe(original.controllerHash); expect(changed.evaluatorHash).not.toBe(original.evaluatorHash);
    manifestRead.driftPath = ""; manifestRead.missingPath = "/" + name;
    await expect(measureFixedClosure("R4")).rejects.toThrow("RSI_CONTROLLER_CLOSURE_UNVERIFIED");
  });
  it("uses the already-started deadline with fixed admissions and monotonic/stop checks", () => {
    let tick = 85000, killed = false;
    const rootGate = createRepairRootGate({ rootTiming: { startedMs: 0, deadlineMs: 120000 }, monotonicMs: () => tick, killSwitch: () => killed });
    rootGate.check(34999); expect(() => rootGate.check(35000)).toThrow("RSI_CONTROLLER_DEADLINE");
    tick = 84000; expect(() => rootGate.check()).toThrow("RSI_CONTROLLER_CLOCK");
    killed = true; expect(() => rootGate.check()).toThrow("RSI_CONTROLLER_OPERATOR_STOP");
    expect(() => createRepairRootGate({ rootTiming: { startedMs: 0, deadlineMs: 120001 }, monotonicMs: () => 0, killSwitch: () => false })).toThrow("RSI_CONTROLLER_CLOCK");
    const fractionalStart = 11741.985875; // Real monotonic readings: subtracting a large fractional start can round the window above the bound in FP64.
    expect(() => createRepairRootGate({ rootTiming: { startedMs: fractionalStart, deadlineMs: fractionalStart + 120000 }, monotonicMs: () => fractionalStart, killSwitch: () => false })).not.toThrow();
  });
  it("consumes a reserved R4 phase without opening/finishing a nested pool and stops after one patch (injected)", async () => {
    const options = await setup(), obs = observation(), sources = await loadSeedAgentSources(), agent = await compileAgentSources(sources), closure = await measureFixedClosure("R3");
    const modules = Object.fromEntries(Object.entries(sources).map(([path, source]) => [path, { digest: hash(source), byteLength: Buffer.byteLength(source) }]));
    const source = { schemaVersion: 1, modules, agentHash: deriveSourceAgentHash(modules), compiledDigest: agent.compiledDigest, artifactDigest: hash("host-data-only-source"), compiledByteLength: Buffer.byteLength(agent.source), artifactByteLength: 1000 };
    await options.ledger.commitLabCatalog({ kind: "SEED", expectedCatalogRevision: -1, expectedCatalogHash: null, source }, now);
    await options.checkpointStore.persist(options.ledger.checkpoint);
    const catalog = (await options.ledger.readImprovement()).catalog[0], executionId = randomUUID();
    const broker = await LocalFakeModelBroker.openImprovement({ ...options, intent: {
      schemaVersion: 1, purpose: "R4_SELF_IMPROVE", executionId, requestId: randomUUID(), campaignId: (await options.ledger.read()).config.campaignId,
      generation: 1, parentExecutionId: null, expectedCatalogRevision: 0, expectedCatalogHash: catalog.hash,
      activeAgentHash: agent.agentHash, activeCompiledDigest: agent.compiledDigest, activeSourceArtifactDigest: source.artifactDigest,
      observation: obs, incidentKey: deriveIncidentKey(obs.incident), incidentEpoch: 1, observationFingerprint: deriveObservationFingerprint(obs), baseAppSha: obs.incident.baseAppSha,
      controllerHash: closure.controllerHash, evaluatorHash: closure.evaluatorHash, memorySnapshotHash: hash("host-memory"), policyDigest: R4_POLICY_DIGEST, fakeFixtureDigest: hash("host-fixture"),
    }, checkpointSink: checkpoint => options.checkpointStore.persist(checkpoint), monotonicMs: () => 0, rootTiming: { startedMs: 0, deadlineMs: 120000 }, scenarios: [
      { kind: "JSON_RESPONSE", response: diagnosis(obs) }, { kind: "JSON_RESPONSE", response: patch((await service()).replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)"), "input.fetch.bind(input).bind(input)") },
    ] });
    const reserve = vi.spyOn(options.ledger, "reserveImprovement"), finish = vi.spyOn(broker, "finish"), open = vi.spyOn(LocalFakeModelBroker, "open"), openImprovement = vi.spyOn(LocalFakeModelBroker, "openImprovement");
    const capabilities = injectHostCapabilities("RED"); let sequence = 0;
    const rootGate = createRepairRootGate({ rootTiming: { startedMs: 0, deadlineMs: 120000 }, monotonicMs: () => 0, killSwitch: () => false });
    await expect(runActualRepairCore({ agent, closure, rootGate, observation: obs,
      baseSource: (await service()).replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)"), lessons: [],
      request: { purpose: "R4_BASELINE_REPAIR", capability: broker.phase("BASELINE_REPAIR"), nextSequence: () => ++sequence },
    })).rejects.toThrow("RSI_CONTROLLER_CANDIDATE_LIMIT");
    expect(capabilities.execute).toHaveBeenCalledTimes(2); expect(capabilities.evaluate).toHaveBeenCalledTimes(2);
    expect(reserve).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(openImprovement).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
    expect((await options.ledger.read()).runs).toHaveLength(0);
    const execution = (await options.ledger.readImprovement()).executions[0];
    expect(execution.calls.map(row => [row.sequence, row.phase])).toEqual([[1, "BASELINE_REPAIR"], [2, "BASELINE_REPAIR"]]);
    expect(execution.settlement).toBeNull(); await broker.finish();
  });
  it("rejects improve-agent output from injected transport before issuing actual custody", async () => {
    const agent = await compileAgentSources(await loadSeedAgentSources());
    vi.spyOn(DockerSandbox, "verify").mockResolvedValue({ execute: vi.fn(async () => ({ untrustedOutput: { PASS: true }, evidence: { transportKind: "INJECTED_TRANSPORT" } })) } as unknown as DockerSandbox);
    const request = { request: vi.fn(async () => ({ untrustedOutput: { PASS: true }, metadata: { mode: "LOCAL_FAKE", callId: randomUUID(), sequence: 1, receiptDigest: hash("host-receipt") } })) };
    const rootGate = createRepairRootGate({ rootTiming: { startedMs: 0, deadlineMs: 120000 }, monotonicMs: () => 0, killSwitch: () => false });
    await expect(runActualAgentStep({ agent, rootGate, capability: request as unknown as ReturnType<LocalFakeModelBroker["phase"]>, sequence: 1, taskKind: "improve-agent", publicInput: {} })).rejects.toThrow("RSI_CONTROLLER_AGENT_CUSTODY");
  });
  it("keeps the bounded passive input guard on the public improve-agent step (injected)", async () => {
    const agent = await compileAgentSources(await loadSeedAgentSources()), execute = vi.fn();
    vi.spyOn(DockerSandbox, "verify").mockResolvedValue({ execute } as unknown as DockerSandbox);
    const request = { request: vi.fn() };
    const rootGate = createRepairRootGate({ rootTiming: { startedMs: 0, deadlineMs: 120000 }, monotonicMs: () => 0, killSwitch: () => false });
    await expect(runActualAgentStep({ agent, rootGate, capability: request as unknown as LocalFakeModelBroker,
      sequence: 1, taskKind: "improve-agent", publicInput: { source: "x".repeat(16001) },
    })).rejects.toThrow("RSI_SANDBOX_INPUT");
    expect(request.request).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("awaits evidence recording in order without overlapping a supervisor sink (injected)", async () => {
    const agent = await compileAgentSources(await loadSeedAgentSources()), closure = await measureFixedClosure("R3"), obs = observation();
    injectHostCapabilities("RED");
    const capability = { request: vi.fn(async () => ({ untrustedOutput: diagnosis(obs), metadata: {} })) };
    const rootGate = createRepairRootGate({ rootTiming: { startedMs: 0, deadlineMs: 120000 }, monotonicMs: () => 0, killSwitch: () => false });
    const recorded: string[] = []; let pending = 0, maximumPending = 0;
    await expect(runActualRepairCore({ agent, closure, rootGate, observation: obs, baseSource: await service(), lessons: [],
      request: { purpose: "R1_RECOVERY", capability: capability as unknown as LocalFakeModelBroker, nextSequence: () => 1 },
      onEvent: async event => {
        if (event.kind === "STAGE") throw new Error("HOST_RECORDING_BOUNDARY");
        if (event.kind !== "EVIDENCE") return;
        maximumPending = Math.max(maximumPending, ++pending);
        await new Promise<void>(resolve => setImmediate(resolve));
        recorded.push(event.evidence.reference.kind); pending--;
      },
    })).rejects.toThrow("HOST_RECORDING_BOUNDARY");
    expect(recorded).toEqual(["INPUT_MATCH", "HYPOTHESIS", "HYPOTHESIS"]);
    expect(maximumPending).toBe(1);
  });
  it.each(["KILL", "CLOCK"])("checks %s after awaited evidence recording before further work (injected)", async boundary => {
    const agent = await compileAgentSources(await loadSeedAgentSources()), closure = await measureFixedClosure("R3"), obs = observation();
    const capabilities = injectHostCapabilities("RED"), recorded: string[] = []; let killed = false, tick = 0;
    const rootGate = createRepairRootGate({ rootTiming: { startedMs: 0, deadlineMs: 120000 }, monotonicMs: () => tick, killSwitch: () => killed });
    const capability = { request: vi.fn(async () => ({ untrustedOutput: diagnosis(obs), metadata: {} })) };
    await expect(runActualRepairCore({ agent, closure, rootGate, observation: obs, baseSource: await service(), lessons: [],
      request: { purpose: "R1_RECOVERY", capability: capability as unknown as LocalFakeModelBroker, nextSequence: () => 1 },
      onEvent: async event => {
        if (event.kind !== "EVIDENCE") return;
        recorded.push(event.evidence.reference.kind);
        await Promise.resolve(); if (boundary === "KILL") killed = true; else tick = 120000;
      },
    })).rejects.toThrow(boundary === "KILL" ? "RSI_CONTROLLER_OPERATOR_STOP" : "RSI_CONTROLLER_DEADLINE");
    expect(recorded).toEqual(["INPUT_MATCH"]); expect(capabilities.evaluate).not.toHaveBeenCalled();
  });
});

describe("synthetic recovery contracts (host data only)", () => {
  it.each([NaN, -1, Infinity])("returns BLOCKED for initial clock %s without reservation or execution", async initial => {
    const options = await setup(), verify = vi.spyOn(DockerSandbox, "verify");
    await expect(recoverSyntheticIncident({ ...options, monotonicMs: () => initial, observation: observation(), baseSource: await service(), agentSources: await loadSeedAgentSources() }))
      .resolves.toMatchObject({ status: "BLOCKED", reasonCode: "DEADLINE_OR_CLOCK", lineage: null });
    expect((await options.ledger.read()).runs).toHaveLength(0); expect(verify).not.toHaveBeenCalled();
  });
  it("uses a bounded unit manifest in a fresh checkout without reading the ignored live artifact", async () => {
    const options = await setup(73551), input = { ...options, observation: observation(), baseSource: await service(), agentSources: await loadSeedAgentSources() };
    manifestRead.unitOnly = true; manifestRead.liveReadsForbidden = true;
    expect(Buffer.byteLength(unitManifest)).toBeLessThan(4096);
    expect(hash(unitManifest)).toBe("605ad858ec0c49edda87c5b733d06bf04c954388bb619a1e81664400d20627ae");
    const verify = vi.spyOn(DockerSandbox, "verify");
    expect(await recoverSyntheticIncident(input)).toMatchObject({ status: "BLOCKED", reasonCode: "BUDGET_UNAVAILABLE" });
    expect(manifestRead.unitReads).toBeGreaterThan(0); expect(manifestRead.liveReads).toBe(0); expect(verify).not.toHaveBeenCalled();
  });
  it.each(["ABSENT", "INVALID", "PIN"])("returns explicit BLOCKED for %s native manifest without changing the artifact", async fault => {
    const options = await setup(), input = { ...options, observation: observation(), baseSource: await service(), agentSources: await loadSeedAgentSources() };
    manifestRead.fault = fault;
    const verify = vi.spyOn(DockerSandbox, "verify");
    expect(await recoverSyntheticIncident(input)).toMatchObject({ status: "BLOCKED", reasonCode: "MANIFEST_UNVERIFIED", actualRecovery: false, lineage: null });
    expect(verify).not.toHaveBeenCalled(); expect((await options.ledger.read()).runs).toHaveLength(0);
  });
  it.each(["KILL", "CLOCK"])("keeps durable terminal NO_CHANGE consistent when %s arrives at completed persist (injected)", async boundary => {
    const options = await setup(), capabilities = injectHostCapabilities("NORMAL"); let killed = false, tick = 0, crossed = false;
    const persist = options.checkpointStore.persist.bind(options.checkpointStore);
    vi.spyOn(options.checkpointStore, "persist").mockImplementation(async checkpoint => {
      await persist(checkpoint);
      if ((await options.ledger.read()).runs[0]?.status === "NO_CHANGE") { crossed = true; if (boundary === "KILL") killed = true; else tick = 120000; }
    });
    const result = await recoverSyntheticIncident({ ...options, killSwitch: () => killed, monotonicMs: () => tick, observation: observation(true), baseSource: await service(), agentSources: await loadSeedAgentSources() });
    expect(crossed).toBe(true); expect(result).toMatchObject({ status: "NO_CHANGE", reasonCode: "NORMAL", actualRecovery: false });
    const run = (await options.ledger.read()).runs[0]; expect(result.status).toBe(run.status);
    expect(run.transitions.at(-1)?.to).toBe("NO_CHANGE"); expect(result.reasonCode).not.toBe("ACCOUNTING_UNCERTAIN");
    expect(capabilities.execute).toHaveBeenCalledTimes(1); expect(capabilities.evaluate).toHaveBeenCalledTimes(1);
    await options.checkpointStore.assertCurrent(options.ledger.checkpoint);
  });
  it.each(["KILL", "CLOCK"])("blocks %s observed before terminal NO_CHANGE commit (injected)", async boundary => {
    const options = await setup(); injectHostCapabilities("NORMAL"); let killed = false, tick = 0;
    const persist = options.checkpointStore.persist.bind(options.checkpointStore);
    vi.spyOn(options.checkpointStore, "persist").mockImplementation(async checkpoint => {
      await persist(checkpoint);
      const run = (await options.ledger.read()).runs[0];
      if (run?.settlement && run.status === "OBSERVED") { if (boundary === "KILL") killed = true; else tick = 120000; }
    });
    const result = await recoverSyntheticIncident({ ...options, killSwitch: () => killed, monotonicMs: () => tick, observation: observation(true), baseSource: await service(), agentSources: await loadSeedAgentSources() });
    expect(result).toMatchObject({ status: "BLOCKED", reasonCode: boundary === "KILL" ? "OPERATOR_STOP" : "DEADLINE_OR_CLOCK" });
    const run = (await options.ledger.read()).runs[0]; expect(run.status).toBe(result.status);
    expect(run.transitions.some(t => t.to === "NO_CHANGE")).toBe(false);
  });
  it("preserves genuine terminal checkpoint uncertainty without compensating a NO_CHANGE ledger write (injected)", async () => {
    const options = await setup(); injectHostCapabilities("NORMAL");
    const persist = options.checkpointStore.persist.bind(options.checkpointStore);
    vi.spyOn(options.checkpointStore, "persist").mockImplementation(async checkpoint => {
      if ((await options.ledger.read()).runs[0]?.status === "NO_CHANGE") throw new Error("synthetic checkpoint uncertainty");
      await persist(checkpoint);
    });
    const input = { ...options, observation: observation(true), baseSource: await service(), agentSources: await loadSeedAgentSources() };
    expect(await recoverSyntheticIncident(input)).toMatchObject({ status: "BLOCKED", reasonCode: "ACCOUNTING_UNCERTAIN" });
    const run = (await options.ledger.read()).runs[0]; expect(run.status).toBe("NO_CHANGE");
    expect(run.transitions.at(-1)?.to).toBe("NO_CHANGE");
    await expect(options.checkpointStore.assertCurrent(options.ledger.checkpoint)).rejects.toThrow("RSI_CONTROLLER_CHECKPOINT");
    expect(await recoverSyntheticIncident(input)).toMatchObject({ status: "BLOCKED", reasonCode: "ACCOUNTING_UNCERTAIN" });
    expect((await options.ledger.read()).runs).toHaveLength(1);
  });
  it.each(["input", "globalThis", "input.fetch.bind(input).bind(globalThis)", "input.fetch.bind(globalThis)"])("does not infer approved receiver family from FAIL/0 and initializer %s (injected)", async init => {
    const options = await setup(), obs = observation(), capabilities = injectHostCapabilities("RED");
    const source = (await service()).replace("input.fetch.bind(globalThis)", init);
    const result = await recoverSyntheticIncident({ ...options, observation: obs, baseSource: source, agentSources: await loadSeedAgentSources(), scenarios: [{ kind: "JSON_RESPONSE", response: diagnosis(obs) }] });
    expect(result).toMatchObject({ status: "INCONCLUSIVE", reasonCode: "REPRODUCTION_FAILED", candidateCount: 0 });
    expect(result.evidence.some(row => row.reference.kind === "REPRODUCTION")).toBe(false);
    expect(capabilities.evaluate).toHaveBeenCalledTimes(1); expect(capabilities.execute).toHaveBeenCalledTimes(1);
    expect((await options.ledger.read()).runs[0].transitions.some(t => t.to === "REPRODUCED")).toBe(false);
  });
  it.each(["CALLSITE", "NON_NATIVE_CALLABLE", "ALIAS", "CONTEXT_DRIFT"])("rejects broader unapproved receiver family %s despite an injected FAIL/0 receipt", async variant => {
    const options = await setup(), obs = observation(), capabilities = injectHostCapabilities("RED");
    let source = (await service()).replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)");
    if (variant === "CALLSITE") source = source.replace("fetchPath(url,", "input.fetch(url,");
    else if (variant === "NON_NATIVE_CALLABLE") source = source.replace("const fetchPath =", "input.fetch = (() => { throw new TypeError('synthetic non-receiver'); }) as typeof fetch;\n  const fetchPath =");
    else if (variant === "ALIAS") source = source.replace("const fetchPath = input.fetch", "const upstream = input.fetch;\n  const fetchPath = upstream");
    else source += "\n// unapproved source context\n";
    const result = await recoverSyntheticIncident({ ...options, observation: obs, baseSource: source, agentSources: await loadSeedAgentSources(), scenarios: [{ kind: "JSON_RESPONSE", response: diagnosis(obs) }] });
    expect(result).toMatchObject({ status: "INCONCLUSIVE", reasonCode: "REPRODUCTION_FAILED", candidateCount: 0 });
    expect(result.evidence.some(row => row.reference.kind === "REPRODUCTION")).toBe(false);
    expect(capabilities.execute).toHaveBeenCalledTimes(1);
  });
  it("records independent approved receiver family binding before any proposal (injected)", async () => {
    const options = await setup(), obs = observation(); injectHostCapabilities("RED");
    const source = (await service()).replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)");
    const result = await recoverSyntheticIncident({ ...options, observation: obs, baseSource: source, agentSources: await loadSeedAgentSources(), scenarios: [{ kind: "JSON_RESPONSE", response: diagnosis(obs) }] });
    expect(result).toMatchObject({ status: "INCONCLUSIVE", reasonCode: "NO_CHANGE_UNCONFIRMED", candidateCount: 0 });
    expect(result.evidence.find(row => row.reference.kind === "REPRODUCTION")?.detail).toMatchObject({
      receiverFamily: { family: "NATIVE_FETCH_INPUT_RECEIVER_V1", anchorAppSha: "741e919aedabdeadd6d46619a35a0105bafdce66", protectedContextDigest: "365fba0ded44c6d6e6a07dafbe271be6d2ff72314d32e62bc8a5a565a079f2fb" },
    });
  });
  it("accepts the agent's receiver bytes while preserving every byte outside the initializer", async () => {
    const good = await service(), bad = good.replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)");
    const result = await validateReceiverPatch(bad, patch(bad));
    expect(result.source).toBe(good); expect(result.sourceDigest).toBe(hash(good));
  });
  it("rejects forbidden paths, stale inputs, check weakening, authority and unrelated source edits", async () => {
    const bad = (await service()).replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)");
    for (const proposal of [
      { ...patch(bad), path: "app/features/operations/rsi-self-check.server.ts" },
      { ...patch(bad), path: ".github/workflows/ci.yml" }, { ...patch(bad), path: "scripts/rsi/controller.ts" },
      { ...patch(bad), baseSourceDigest: "0".repeat(64) }, { ...patch(bad), PASS: true },
      { ...patch(bad), find: "response.status === check.status", replace: "true" },
      patch(bad, "input"), patch(bad, "globalThis"),
      patch(bad, "(() => { globalThis.fetch = () => new Response('', {status: 200}); return input.fetch; })()"),
      patch(bad, "input.fetch.bind(globalThis); const forged = true"),
    ]) await expect(validateReceiverPatch(bad, proposal)).rejects.toThrow("RSI_CONTROLLER_PATCH");
  });
  it("requires two distinct evidence-grounded hypotheses and preserves unknown counterevidence", () => {
    const obs = observation(), valid = diagnosis(obs);
    expect(validateDiagnosis(valid, obs)).toEqual(valid);
    for (const invalid of [ { ...valid, hypotheses: valid.hypotheses.slice(1) },
      { ...valid, hypotheses: [valid.hypotheses[0], valid.hypotheses[0]] },
      { ...valid, hypotheses: [{ ...valid.hypotheses[0], supportingEvidenceIds: [randomUUID()] }, valid.hypotheses[1]] },
      { ...valid, evidence: [{ PASS: true }] },
    ]) expect(() => validateDiagnosis(invalid, obs)).toThrow("RSI_CONTROLLER_DIAGNOSIS");
  });
  it("compiles only the two strategy modules as data without running their top level", async () => {
    const sources = await loadSeedAgentSources();
    const compiled = await compileAgentSources(sources);
    expect(compiled.source).toContain("export"); expect(compiled.agentHash).toMatch(/^[a-f0-9]{64}$/);
    const key = "scripts/rsi/agent/diagnostic-policy.ts";
    const mutated = { ...sources, [key]: "throw new Error('must never run on host');\n" + sources[key] };
    expect((await compileAgentSources(mutated)).agentHash).not.toBe(compiled.agentHash);
    for (const source of ["import 'node:fs';", "import('../controller');", "export * from './foreign';"]) {
      await expect(compileAgentSources({ ...sources, [key]: source + sources[key] })).rejects.toThrow("RSI_CONTROLLER_AGENT_CLOSURE");
    }
    await expect(compileAgentSources({ ...sources, "extra.ts": "export default 1" })).rejects.toThrow("RSI_CONTROLLER_AGENT_CLOSURE");
  });
  it("requires externally anchored checkpoint custody and rejects stale restart or pending writes", async () => {
    const options = await setup(), old = options.ledger.checkpoint;
    await expect(ControllerCheckpointStore.create(options.checkpointStore.path, old)).rejects.toThrow("RSI_CONTROLLER_CHECKPOINT");
    await writeFile(options.checkpointStore.path, JSON.stringify({ revision: 99, hash: "0".repeat(64) }));
    await expect(options.checkpointStore.assertCurrent(old)).rejects.toThrow("RSI_CONTROLLER_CHECKPOINT");
    await expect(ControllerCheckpointStore.open(options.checkpointStore.path, old)).rejects.toThrow("RSI_CONTROLLER_CHECKPOINT");
  });
  it("stops before execution or reservation when the operator kill switch is set", async () => {
    const options = await setup();
    const result = await recoverSyntheticIncident({ ...options, killSwitch: () => true, observation: observation(), baseSource: await service(), agentSources: await loadSeedAgentSources() });
    expect(result).toMatchObject({ status: "BLOCKED", reasonCode: "OPERATOR_STOP", actualRecovery: false });
    expect((await options.ledger.read()).runs).toHaveLength(0);
  });
  it("reserves only through the broker and preserves a blocked attempt on backend absence", async () => {
    const options = await setup(), obs = observation();
    vi.spyOn(DockerSandbox, "verify").mockRejectedValue(new Error("RSI_SANDBOX_BLOCKED"));
    const input = { ...options, observation: obs, baseSource: await service(), agentSources: await loadSeedAgentSources() };
    expect(await recoverSyntheticIncident(input)).toMatchObject({ status: "BLOCKED", reasonCode: "BACKEND_UNAVAILABLE", actualRecovery: false });
    const state = await options.ledger.read(); expect(state.runs).toHaveLength(1); expect(state.runs[0].settlement?.consumedUnits).toBe(0);
    expect(await recoverSyntheticIncident(input)).toMatchObject({ status: "BLOCKED", reasonCode: "DUPLICATE" });
    expect((await options.ledger.read()).runs).toHaveLength(1);
  });
  it("fails the budget gate before a capability is granted", async () => {
    const options = await setup(73551);
    expect(await recoverSyntheticIncident({ ...options, observation: observation(), baseSource: await service(), agentSources: await loadSeedAgentSources() })).toMatchObject({ status: "BLOCKED", reasonCode: "BUDGET_UNAVAILABLE" });
    expect((await options.ledger.read()).runs).toHaveLength(0);
  });
  it("counts an oversized constructed R1 request before broker input rejection (injected)", async () => {
    const options = await setup(), capabilities = injectHostCapabilities("RED");
    const baseSource = (await service()) + "\n//" + "x".repeat(16000);
    expect(Buffer.byteLength(baseSource)).toBeLessThanOrEqual(65536);
    const result = await recoverSyntheticIncident({ ...options, monotonicMs: () => 0,
      observation: observation(), baseSource, agentSources: await loadSeedAgentSources() });
    expect(result).toMatchObject({ status: "INCONCLUSIVE", reasonCode: "EVIDENCE_UNKNOWN", broker: { callCount: 1, chargedUnits: 0 } });
    expect(result.evidence.at(-1)?.detail).toMatchObject({ failureCode: "RSI_BROKER_INPUT" });
    expect((await options.ledger.read()).runs[0].settlement).toMatchObject({ kind: "CONFIRMED", consumedUnits: 0 });
    expect(capabilities.execute).not.toHaveBeenCalled(); expect(capabilities.evaluate).not.toHaveBeenCalled();
  });
  it("rejects an injected strategy's forged PASS and never sends hidden fixture answers", async () => {
    const options = await setup(), obs = observation(), captured: unknown[] = [];
    const execute = vi.fn(async (request: { input: unknown }) => {
      captured.push(request.input);
      return { untrustedOutput: { PASS: true, authorized: true, action: "PATCH" }, evidence: { transportKind: "INJECTED_TRANSPORT" } };
    });
    vi.spyOn(DockerSandbox, "verify").mockResolvedValue({ execute } as unknown as DockerSandbox);
    const evaluate = vi.fn();
    vi.spyOn(NativeExecutor, "verify").mockResolvedValue({ evaluate } as unknown as NativeExecutor);
    const result = await recoverSyntheticIncident({ ...options, observation: obs, baseSource: await service(), agentSources: await loadSeedAgentSources(), baselineFixture: "HTTP_FAILURE" });
    expect(result).toMatchObject({ status: "INCONCLUSIVE", reasonCode: "EVIDENCE_UNKNOWN", actualRecovery: false });
    expect(evaluate).not.toHaveBeenCalled();
    expect(JSON.stringify(captured)).not.toMatch(/HTTP_FAILURE|expectedNoChange|oracleDigest|manifestDigest/);
    expect(result.evidence.some(row => row.custody === "ACTUAL_AGENT_CONTAINER" || row.custody === "ACTUAL_NATIVE")).toBe(false);
    expect((await options.ledger.read()).runs[0].settlement?.kind).toBe("CONFIRMED");
  });
  it("preserves one failed capability instead of re-verifying after the deadline", async () => {
    const options = await setup(); let tick = 0;
    const verify = vi.spyOn(DockerSandbox, "verify").mockImplementation(async () => { tick = 120000; return {} as DockerSandbox; });
    const result = await recoverSyntheticIncident({ ...options, monotonicMs: () => tick, observation: observation(), baseSource: await service(), agentSources: await loadSeedAgentSources() });
    expect(result).toMatchObject({ status: "BLOCKED", reasonCode: "DEADLINE_OR_CLOCK" });
    expect(verify).toHaveBeenCalledTimes(1); expect((await options.ledger.read()).runs).toHaveLength(1);
  });
  it("refuses dispatch when remaining time cannot cover verification and cleanup", async () => {
    const options = await setup(); let calls = 0;
    const verify = vi.spyOn(DockerSandbox, "verify");
    const result = await recoverSyntheticIncident({ ...options, monotonicMs: () => calls++ < 3 ? 0 : 90000, observation: observation(), baseSource: await service(), agentSources: await loadSeedAgentSources() });
    expect(result).toMatchObject({ status: "BLOCKED", reasonCode: "DEADLINE_OR_CLOCK" });
    expect(verify).not.toHaveBeenCalled();
    expect((await options.ledger.read()).runs[0].settlement?.kind).toBe("CONFIRMED");
  });
  it("preserves an operator stop while awaited verification is running", async () => {
    const options = await setup(); let killed = false;
    const verify = vi.spyOn(DockerSandbox, "verify").mockImplementation(async () => { killed = true; return {} as DockerSandbox; });
    const result = await recoverSyntheticIncident({ ...options, killSwitch: () => killed, observation: observation(), baseSource: await service(), agentSources: await loadSeedAgentSources() });
    expect(result).toMatchObject({ status: "BLOCKED", reasonCode: "OPERATOR_STOP" });
    expect(verify).toHaveBeenCalledTimes(1); expect((await options.ledger.read()).runs[0].status).toBe("BLOCKED");
  });
  it("preserves an uncertain verification lifecycle without creating a replacement capability", async () => {
    const options = await setup();
    const verify = vi.spyOn(DockerSandbox, "verify").mockRejectedValue(new Error("RSI_SANDBOX_CLEANUP"));
    const input = { ...options, observation: observation(), baseSource: await service(), agentSources: await loadSeedAgentSources() };
    const result = await recoverSyntheticIncident(input);
    expect(result.status).toBe("INCONCLUSIVE"); expect(result.evidence.at(-1)?.detail).toMatchObject({ failureCode: "RSI_SANDBOX_CLEANUP" });
    expect(await recoverSyntheticIncident(input)).toMatchObject({ status: "BLOCKED", reasonCode: "DUPLICATE" });
    expect(verify).toHaveBeenCalledTimes(1); expect((await options.ledger.read()).runs).toHaveLength(1);
  });
  it("retains a reservation when checkpoint persistence fails instead of opening a replacement pool", async () => {
    const options = await setup(), obs = observation();
    vi.spyOn(options.checkpointStore, "persist").mockRejectedValue(new Error("uncertain fsync"));
    const input = { ...options, observation: obs, baseSource: await service(), agentSources: await loadSeedAgentSources() };
    expect(await recoverSyntheticIncident(input)).toMatchObject({ status: "BLOCKED", reasonCode: "ACCOUNTING_UNCERTAIN" });
    const run = (await options.ledger.read()).runs[0]; expect(run.maximumCostUnits).toBe(73552); expect(run.settlement).toBeNull();
    expect(await recoverSyntheticIncident(input)).toMatchObject({ status: "BLOCKED", reasonCode: "ACCOUNTING_UNCERTAIN" });
    expect((await options.ledger.read()).runs).toHaveLength(1);
  });
  it("charges unconfirmed fake usage at the entire reserved pool (injected capabilities only)", async () => {
    const options = await setup();
    vi.spyOn(DockerSandbox, "verify").mockResolvedValue({} as DockerSandbox);
    vi.spyOn(NativeExecutor, "verify").mockResolvedValue({} as NativeExecutor);
    const result = await recoverSyntheticIncident({ ...options, observation: observation(), baseSource: await service(), agentSources: await loadSeedAgentSources(), scenarios: [{ kind: "INVALID_USAGE" }] });
    expect(result).toMatchObject({ status: "INCONCLUSIVE", reasonCode: "EVIDENCE_UNKNOWN", candidateCount: 0 });
    expect((await options.ledger.read()).runs[0].settlement).toMatchObject({ kind: "AMBIGUOUS", consumedUnits: 73552 });
    expect(result.evidence.some(row => row.custody === "ACTUAL_NATIVE")).toBe(false);
  });
});

describe.runIf(process.env.RSI_CONTROLLER_PROBE === "1")("actual Docker/native single incident", () => {
  // Abort the opt-in campaign on the first uncertain lifecycle. Subsequent cases
  // must not obtain replacement capabilities to conceal its failure.
  let campaignHealthy = true;
  async function actual(input: Parameters<typeof recoverSyntheticIncident>[0], expected: string) {
    expect(campaignHealthy, "previous actual case was unverified; campaign quarantined").toBe(true);
    campaignHealthy = false;
    const result = await recoverSyntheticIncident(input);
    appendFileSync(new URL("../../.superpowers/sdd/r3-implementation-plan/controller-receipts.jsonl", import.meta.url), JSON.stringify({ caseName: expected, result }) + "\n", { mode: 0o600 });
    expect(result.status, result.reasonCode).toBe(expected);
    expect(result.evidence.some(e => e.custody === "ACTUAL_NATIVE" && e.reference.verdict === "UNKNOWN"), "incomplete native receipt quarantines campaign").toBe(false);
    campaignHealthy = true; return result;
  }
  it("executes isolated strategy, actual RED/GREEN, four independent regressions and synthetic PR_READY", async () => {
    const options = await setup(), obs = observation(), good = await service(), bad = good.replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)");
    const result = await actual({ ...options, observation: obs, baseSource: bad, agentSources: await loadSeedAgentSources(),
      scenarios: [{ kind: "JSON_RESPONSE", response: diagnosis(obs) }, { kind: "JSON_RESPONSE", response: patch(bad) }] }, "PR_READY");
    expect(manifestRead.unitReads).toBe(0); expect(manifestRead.liveReads).toBeGreaterThan(0);
    expect(result.actualRecovery).toBe(false);
    expect(result.candidateCount).toBe(1); expect(result.evidence.filter(e => e.custody === "ACTUAL_NATIVE")).toHaveLength(6);
    expect(result.evidence.filter(e => e.reference.kind === "CI").every(e => e.custody === "LOCAL_SYNTHETIC_CI")).toBe(true);
    expect((await options.ledger.read()).runs[0].status).toBe("PR_READY");
    expect(await recoverSyntheticIncident({ ...options, observation: obs, baseSource: bad, agentSources: await loadSeedAgentSources() })).toMatchObject({ status: "BLOCKED", reasonCode: "DUPLICATE" });
  }, 125000);
  it("honors the default NO_CHANGE answer for an already correct source and preserves an external failure", async () => {
    for (const fixture of ["NATIVE_RECEIVER", "HTTP_FAILURE"] as const) {
      const options = await setup(), obs = observation(fixture === "NATIVE_RECEIVER");
      const result = await actual({ ...options, observation: obs, baseSource: await service(), agentSources: await loadSeedAgentSources(), baselineFixture: fixture }, "NO_CHANGE");
      expect(result.candidateCount).toBe(0); expect(result.reasonCode).toBe(fixture === "HTTP_FAILURE" ? "EXTERNAL_FAILURE" : "NORMAL");
      expect(result.evidence.some(e => e.reference.kind === "DIFF" || e.reference.kind === "CI")).toBe(false);
    }
  }, 125000);
  it("honors a NO_CHANGE refusal on a reproduced failure and rejects a forbidden patch without applying it", async () => {
    for (const forbidden of [false, true]) {
      const options = await setup(), obs = observation(), bad = (await service()).replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)");
      const result = await actual({ ...options, observation: obs, baseSource: bad, agentSources: await loadSeedAgentSources(),
        scenarios: forbidden ? [{ kind: "JSON_RESPONSE", response: diagnosis(obs) }, { kind: "JSON_RESPONSE", response: { ...patch(bad), path: "app/features/operations/rsi-self-check.server.ts" } }] : [] }, forbidden ? "REJECTED" : "INCONCLUSIVE");
      expect(result.reasonCode).toBe(forbidden ? "POLICY_REJECTED" : "NO_CHANGE_UNCONFIRMED");
      expect(result.evidence.filter(e => e.custody === "ACTUAL_NATIVE")).toHaveLength(1);
    }
  }, 125000);
  it("stops at two unsuccessful proposals with actual negative native receipts", async () => {
      const options = await setup(), obs = observation(), bad = (await service()).replace("input.fetch.bind(globalThis)", "input.fetch.bind(input)");
      const proposal = patch(bad, "input.fetch.bind(input).bind(input)");
      const result = await actual({ ...options, observation: obs, baseSource: bad, agentSources: await loadSeedAgentSources(), scenarios: [
        { kind: "JSON_RESPONSE", response: diagnosis(obs) }, { kind: "JSON_RESPONSE", response: proposal }, { kind: "JSON_RESPONSE", response: proposal },
      ] }, "INCONCLUSIVE");
      expect(result.candidateCount).toBe(2);
      const settled = (await options.ledger.read()).runs[0].settlement!;
      expect(settled.kind).toBe("CONFIRMED");
      expect(result.reasonCode).toBe("CANDIDATE_LIMIT");
  }, 125000);
  it("uses the same compiled active source for the improve-agent ABI in a real container", async () => {
    expect(campaignHealthy).toBe(true); campaignHealthy = false;
    const agent = await compileAgentSources(await loadSeedAgentSources()), sandbox = await DockerSandbox.verify();
    const input = { schemaVersion: 1, taskKind: "improve-agent", payload: { modelReply: { action: "NO_CHANGE", reason: "LOCAL_FAKE" } } };
    const result = await sandbox.execute({ schemaVersion: 1, source: agent.source, input });
    appendFileSync(new URL("../../.superpowers/sdd/r3-implementation-plan/controller-receipts.jsonl", import.meta.url), JSON.stringify({ caseName: "improve-agent-ABI", agentHash: agent.agentHash, result }) + "\n", { mode: 0o600 });
    expect(result.evidence).toMatchObject({ transportKind: "DOCKER_CLI", sourceDigest: agent.compiledDigest, inputDigest: hash(JSON.stringify(input)) });
    expect(result.untrustedOutput).toEqual(input.payload.modelReply); campaignHealthy = true;
  }, 15000);
});
