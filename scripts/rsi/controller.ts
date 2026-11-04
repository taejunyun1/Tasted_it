import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";
import { z } from "zod";
import { deriveIncidentKey, deriveObservationFingerprint, parseLineage, parseObservation, type RsiEvidenceReference, type RsiLineage, type RsiStatus, type RsiTransition } from "./contracts";
import { LocalRsiLedger, type RsiLedgerCheckpoint } from "./ledger";
import { createApprovedSnapshot, retrieveApprovedMemory, type RsiApprovedSnapshot } from "./memory";
import { LocalFakeModelBroker, MODEL_POLICY, type FakeScenario } from "./model-broker";
import type { RsiFixture } from "./oracle";
import { compileAgentSources, createRepairRootGate, measureFixedClosure, runActualRepairCore, type ControllerEvidence } from "./repair-core";
export { AGENT_PATHS, compileAgentSources, loadSeedAgentSources, validateDiagnosis, validateReceiverPatch } from "./repair-core";
export type { AgentSources, CompiledAgent, ControllerEvidence } from "./repair-core";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const jsonHash = (value: unknown) => hash(JSON.stringify(value));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
function fail(code: string): never { throw new Error(`RSI_CONTROLLER_${code}`); }
function snapshot<T>(value: T): T {
  const copy: T = structuredClone(value);
  function freeze(item: unknown) { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } }
  freeze(copy); return copy;
}

const checkpointSchema = z.strictObject({ revision: z.number().int().min(0).max(9999), hash: digest });
async function checkpointDirectory(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path) fail("CHECKPOINT");
  let current = parsePath(path).root;
  for (const part of dirname(path).slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part); const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("CHECKPOINT");
  }
  if (((await lstat(dirname(path))).mode & 0o077) !== 0) fail("CHECKPOINT");
}
async function readCheckpoint(path: string) {
  await checkpointDirectory(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 256 || (stat.mode & 0o077) !== 0) fail("CHECKPOINT");
    const text = await handle.readFile("utf8"), value = checkpointSchema.parse(JSON.parse(text));
    if (JSON.stringify(value) !== text) fail("CHECKPOINT");
    return value;
  } finally { await handle.close(); }
}
/** Supervisor-owned external checkpoint. Missing/stale/uncertain state is never
 * repaired by reading a ledger head or deleting a pending write. */
export class ControllerCheckpointStore {
  private constructor(readonly path: string, private current: RsiLedgerCheckpoint) {}
  static async create(path: string, trustedCheckpoint: unknown) {
    try {
      await checkpointDirectory(path); const checkpoint = checkpointSchema.parse(trustedCheckpoint);
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify(checkpoint)); await handle.sync(); } finally { await handle.close(); }
      await syncDirectory(dirname(path)); return new ControllerCheckpointStore(path, checkpoint);
    } catch { return fail("CHECKPOINT"); }
  }
  static async open(path: string, trustedCheckpoint: unknown) {
    try {
      const value = checkpointSchema.parse(trustedCheckpoint), store = new ControllerCheckpointStore(path, value);
      await store.assertCurrent(value); return store;
    } catch { return fail("CHECKPOINT"); }
  }
  async assertCurrent(checkpoint: RsiLedgerCheckpoint) {
    try {
      try { await lstat(`${this.path}.pending`); fail("CHECKPOINT"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (JSON.stringify(this.current) !== JSON.stringify(checkpoint) || JSON.stringify(await readCheckpoint(this.path)) !== JSON.stringify(this.current)) fail("CHECKPOINT");
    } catch { return fail("CHECKPOINT"); }
  }
  async persist(checkpoint: RsiLedgerCheckpoint) {
    try {
      await this.assertCurrent(this.current); const next = checkpointSchema.parse(checkpoint);
      if (next.revision < this.current.revision || (next.revision === this.current.revision && next.hash !== this.current.hash)) fail("CHECKPOINT");
      if (JSON.stringify(next) === JSON.stringify(this.current)) return;
      const handle = await open(`${this.path}.pending`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); } finally { await handle.close(); }
      await rename(`${this.path}.pending`, this.path); await syncDirectory(dirname(this.path)); this.current = next;
    } catch { return fail("CHECKPOINT"); }
  }
}
async function syncDirectory(path: string) { const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); } }

export interface SyntheticRecoveryOptions {
  ledger: LocalRsiLedger; checkpointStore: ControllerCheckpointStore;
  observation: unknown; baseSource: string; agentSources: unknown;
  killSwitch: () => boolean; nowUtc?: () => string; monotonicMs?: () => number;
  scenarios?: FakeScenario[]; requestId?: string; runId?: string; parentAgentHash?: string;
  // All options are trusted supervisor inputs, never decoded from candidate IPC.
  baselineFixture?: RsiFixture;
  memory?: { snapshot: RsiApprovedSnapshot; expectedHash: string; approvals: unknown };
}
export interface SyntheticRecoveryResult {
  readonly schemaVersion: 1; readonly mode: "LOCAL_SYNTHETIC"; readonly status: RsiStatus;
  readonly reasonCode: string; readonly actualRecovery: false; readonly candidateCount: number;
  readonly lineage: RsiLineage | null; readonly evidence: readonly ControllerEvidence[];
  readonly checkpoint: RsiLedgerCheckpoint; readonly broker: unknown;
}
/** One local synthetic incident. No provider, GitHub, app write, merge, close
 * incident, deployment, live probe or remote operation is reachable here. */
export async function recoverSyntheticIncident(options: SyntheticRecoveryOptions): Promise<SyntheticRecoveryResult> {
  const evidence: ControllerEvidence[] = [];
  let status: RsiStatus = "OBSERVED", reasonCode = "EVIDENCE_UNKNOWN", lineage: RsiLineage | null = null, candidateCount = 0;
  let broker: LocalFakeModelBroker | undefined, brokerReceipt: unknown = null, finishing = false, checkpointBroken = false;
  const nowUtc = options.nowUtc ?? (() => new Date().toISOString()), clock = options.monotonicMs ?? (() => performance.now());
  const started = clock();
  let rootGate: ReturnType<typeof createRepairRootGate>;
  const gate = (requiredMs = 0) => rootGate.check(requiredMs);
  function record(kind: RsiEvidenceReference["kind"], verdict: RsiEvidenceReference["verdict"], detail: unknown, custody: ControllerEvidence["custody"] = "SUPERVISOR", commandId: RsiEvidenceReference["commandId"] = null) {
    const row = snapshot({ reference: { evidenceId: randomUUID(), kind, digest: jsonHash(detail), verdict, commandId }, custody, detail });
    evidence.push(row); return row.reference;
  }
  async function persist(checkpoint: RsiLedgerCheckpoint) { try { await options.checkpointStore.persist(checkpoint); } catch { checkpointBroken = true; fail("CHECKPOINT"); } }
  async function transition(to: RsiStatus, rows: RsiEvidenceReference[], code: RsiTransition["reasonCode"] = "STAGE_EVIDENCE") {
    if (!lineage) fail("ACCOUNTING");
    const advancing = ["TRIAGED", "REPRODUCED", "PATCHED", "VERIFIED", "PR_READY", "NO_CHANGE"].includes(to);
    if (advancing) gate();
    await options.ledger.transition({ runId: lineage.runId, transition: { schemaVersion: 1, from: status, to, evidence: rows, reasonCode: code } }, nowUtc());
    await persist(options.ledger.checkpoint); status = to;
    // NO_CHANGE is terminal: a successful ledger+checkpoint commit wins over
    // a later stop/deadline. No external/candidate work follows this commit.
    // Failed persistence still throws before status is accepted as committed.
    if (advancing && to !== "NO_CHANGE") gate();
  }
  async function finish() {
    if (broker && !finishing) { finishing = true; brokerReceipt = await broker.finish(); }
  }
  const result = () => snapshot({ schemaVersion: 1 as const, mode: "LOCAL_SYNTHETIC" as const, status, reasonCode, actualRecovery: false as const, candidateCount, lineage, evidence, checkpoint: options.ledger.checkpoint, broker: brokerReceipt });
  try {
    if (options.killSwitch()) fail("OPERATOR_STOP");
    rootGate = createRepairRootGate({ rootTiming: { startedMs: started, deadlineMs: started + MODEL_POLICY.recoveryTimeoutMs }, killSwitch: options.killSwitch, monotonicMs: clock });
    gate(); await options.checkpointStore.assertCurrent(options.ledger.checkpoint);
    const observation = parseObservation(options.observation);
    if (observation.incident.source !== "LOCAL_SYNTHETIC" || typeof options.baseSource !== "string" || Buffer.byteLength(options.baseSource) > 65536) fail("INPUT");
    const agent = await compileAgentSources(options.agentSources), closure = await measureFixedClosure("R3"); gate();
    const memory = options.memory ?? { snapshot: createApprovedSnapshot([], [], nowUtc()), expectedHash: createApprovedSnapshot([], [], nowUtc()).hash, approvals: [] };
    const retrieval = retrieveApprovedMemory(memory.snapshot, { expectedHash: memory.expectedHash, approvals: memory.approvals, nowUtc: nowUtc(), query: {
      errorCode: observation.incident.errorCode === "NONE" ? "UNKNOWN" : observation.incident.errorCode,
      runtime: "WORKER_SYNTHETIC", conditions: [observation.incident.errorCode === "REDIRECT_MISMATCH" ? "REDIRECT_FAILURE" : observation.incident.errorCode === "NETWORK_TIMEOUT" ? "TIMEOUT" : observation.incident.errorCode === "HTTP_STATUS" ? "STATUS_FAILURE" : "UNKNOWN_EVIDENCE"],
    } });
    lineage = parseLineage({ schemaVersion: 1, runId: options.runId ?? randomUUID(), parentRunId: null, attempt: 1,
      incidentKey: deriveIncidentKey(observation.incident), incidentEpoch: 1, parentIncidentId: null, eventFingerprint: deriveObservationFingerprint(observation), baseAppSha: observation.incident.baseAppSha,
      parentAgentHash: options.parentAgentHash ?? agent.agentHash, candidateAgentHash: agent.agentHash, controllerHash: closure.controllerHash, evaluatorHash: closure.evaluatorHash, memorySnapshotHash: retrieval.snapshotHash });
    broker = await LocalFakeModelBroker.open({ ledger: options.ledger, intent: { requestId: options.requestId ?? randomUUID(), observation, lineage }, checkpointSink: persist, killSwitch: options.killSwitch, nowUtc, monotonicMs: clock, scenarios: options.scenarios });
    record("OBSERVATION", observation.verdict, { observation, retrieval, closure: { controller: closure.controller, evaluator: closure.evaluator }, agent: { agentHash: agent.agentHash, compiledDigest: agent.compiledDigest, moduleDigests: agent.moduleDigests } });
    let sequence = 0;
    const repaired = await runActualRepairCore({ agent, closure, rootGate, observation, baseSource: options.baseSource,
      baselineFixture: options.baselineFixture,
      lessons: memory.snapshot.lessons.filter(l => retrieval.selectedLessonIds.includes(l.lessonId)).map(l => ({ lessonId: l.lessonId, policy: l.policy })),
      request: { purpose: "R1_RECOVERY", capability: broker, nextSequence: () => ++sequence },
      onEvent: async event => {
        if (event.kind === "EVIDENCE") evidence.push(event.evidence);
        else if (event.kind === "CANDIDATE") candidateCount = event.candidateCount;
        else await transition(event.status, [...event.evidence]);
      },
    });
    if (repaired.outcome === "NO_CHANGE") {
      await finish(); gate(); reasonCode = repaired.disposition;
      await transition("NO_CHANGE", [record("NO_CHANGE", "PASS", { nativeDigest: repaired.nativeReference.digest, disposition: repaired.disposition, commitPolicy: "DURABLE_TERMINAL_WINS" })], repaired.disposition); return result();
    }
    const candidate = repaired.candidate, green = repaired.greenReference, regressionRefs = repaired.regressionReferences;
    await finish(); gate();
    const state = await options.ledger.read(), run = state.runs.find(r => r.lineage.runId === lineage!.runId);
    if (run?.settlement?.kind !== "CONFIRMED") fail("ACCOUNTING");
    const syntheticCi = (["CI_UNIT", "CI_INTEGRATION", "CI_BUILD", "CI_PLAYWRIGHT_SMOKE"] as const).map(command => record("CI", "PASS", { mode: "LOCAL_SYNTHETIC", command, executedGithubCi: false, greenDigest: green.digest, regressionDigests: regressionRefs.map(r => r.digest) }, "LOCAL_SYNTHETIC_CI", command));
    await transition("VERIFIED", [green, ...regressionRefs, ...syntheticCi, record("AUTHORIZATION", "PASS", { scope: "LOCAL_SYNTHETIC_RECEIVER_ONLY", operationsAllowed: false }), record("BUDGET", "PASS", { settlement: run.settlement, candidateCount, maxCandidates: 2, maxCalls: 8, deadlineMs: 120000 })]); gate();
    reasonCode = "LOCAL_SYNTHETIC_PR_READY";
    await transition("PR_READY", [record("OUTCOME", "PASS", { mode: "LOCAL_SYNTHETIC", candidateSourceDigest: candidate.sourceDigest, actualRecovery: false }), record("PR_REVIEW", "PASS", { review: "FIXED_LOCAL_SYNTHETIC_GATE", githubPrCreated: false, mergeAllowed: false, liveVerified: false })]);
    return result();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    reasonCode = message === "RSI_BROKER_DUPLICATE" ? "DUPLICATE" : message === "RSI_LEDGER_BUDGET" ? "BUDGET_UNAVAILABLE"
      : ["RSI_CONTROLLER_MANIFEST_UNVERIFIED", "RSI_CONTROLLER_CLOSURE_UNVERIFIED"].includes(message) ? "MANIFEST_UNVERIFIED"
      : /(?:KILLED|OPERATOR_STOP)$/.test(message) ? "OPERATOR_STOP" : /(?:DEADLINE|CLOCK)$/.test(message) ? "DEADLINE_OR_CLOCK"
      : /(?:SANDBOX_BLOCKED|NATIVE_BLOCKED|ARTIFACT_MISMATCH|COMPATIBILITY_UNSUPPORTED)$/.test(message) ? "BACKEND_UNAVAILABLE"
      : message === "RSI_CONTROLLER_PATCH" ? "POLICY_REJECTED" : message === "RSI_CONTROLLER_REPRODUCTION_FAILED" ? "REPRODUCTION_FAILED"
      : message === "RSI_CONTROLLER_REGRESSION" ? "REGRESSION_FAILED" : message === "RSI_CONTROLLER_CANDIDATE_LIMIT" ? "CANDIDATE_LIMIT"
      : message === "RSI_CONTROLLER_NO_CHANGE_UNCONFIRMED" ? "NO_CHANGE_UNCONFIRMED" : /(?:CHECKPOINT|ACCOUNTING)$/.test(message) ? "ACCOUNTING_UNCERTAIN" : "EVIDENCE_UNKNOWN";
    try { await finish(); } catch { checkpointBroken = true; reasonCode = "ACCOUNTING_UNCERTAIN"; }
    const target = reasonCode === "POLICY_REJECTED" ? "REJECTED" : ["MANIFEST_UNVERIFIED", "BACKEND_UNAVAILABLE", "DUPLICATE", "BUDGET_UNAVAILABLE", "OPERATOR_STOP", "DEADLINE_OR_CLOCK", "ACCOUNTING_UNCERTAIN"].includes(reasonCode) ? "BLOCKED" : "INCONCLUSIVE";
    if (broker && !checkpointBroken && lineage) {
      try { await transition(target, [record("OUTCOME", "UNKNOWN", { reasonCode, failureCode: /^RSI_(?:CONTROLLER|BROKER|NATIVE|SANDBOX|LEDGER)_[A-Z0-9_]+$/.test(message) ? message : "UNVERIFIED", actualRecovery: false })], reasonCode === "POLICY_REJECTED" ? "POLICY_REJECTED" : reasonCode === "OPERATOR_STOP" ? "OPERATOR_STOP" : reasonCode === "REPRODUCTION_FAILED" ? "REPRODUCTION_FAILED" : "EVIDENCE_UNKNOWN"); }
      catch { reasonCode = "ACCOUNTING_UNCERTAIN"; status = "BLOCKED"; }
    } else status = target;
    return result();
  }
}
