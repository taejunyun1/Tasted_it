import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { types } from "node:util";
import { z } from "zod";
import { deriveIncidentKey, deriveObservationFingerprint, parseLineage, parseObservation, type RsiEvidenceReference, type RsiLineage, type RsiObservation, type RsiStatus, type RsiTransition } from "./contracts";
import { LocalRsiLedger, type RsiLedgerCheckpoint } from "./ledger";
import { createApprovedSnapshot, retrieveApprovedMemory, type RsiApprovedSnapshot } from "./memory";
import { LocalFakeModelBroker, MODEL_POLICY, type FakeScenario } from "./model-broker";
import { NativeExecutor, NATIVE_LIMITS, NATIVE_SOURCE_PATH } from "./native-executor";
import { DockerSandbox, parseBoundedJsonObject, SANDBOX_POLICY_DIGEST } from "./sandbox";
import type { RsiFixture } from "./oracle";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const compiler = createRequire(require.resolve("wrangler"))("esbuild") as { build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[]; warnings: unknown[] }> };
const parser = createRequire(require.resolve("@react-router/dev/package.json"))("@babel/parser") as { parse(source: string, options: Record<string, unknown>): unknown };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const jsonHash = (value: unknown) => hash(JSON.stringify(value));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
function fail(code: string): never { throw new Error(`RSI_CONTROLLER_${code}`); }
function snapshot<T>(value: T): T {
  const copy: T = structuredClone(value);
  function freeze(item: unknown) { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } }
  freeze(copy); return copy;
}
function ast(source: string) {
  try { return parser.parse(source, { sourceType: "module", plugins: ["typescript"], createImportExpressions: true }) as Record<string, unknown>; }
  catch { return fail("SYNTAX"); }
}
function walk(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(item => walk(item, visit)); return; }
  const node = value as Record<string, unknown>; visit(node); Object.values(node).forEach(item => walk(item, visit));
}

export const AGENT_PATHS = ["scripts/rsi/agent/diagnostic-policy.ts", "scripts/rsi/agent/repair-policy.ts"] as const;
export type AgentSources = Record<(typeof AGENT_PATHS)[number], string>;
export interface CompiledAgent { readonly source: string; readonly agentHash: string; readonly compiledDigest: string; readonly moduleDigests: Readonly<Record<string, string>> }
export async function loadSeedAgentSources(): Promise<AgentSources> {
  return Object.fromEntries(await Promise.all(AGENT_PATHS.map(async path => [path, await readFile(join(root, path), "utf8")]))) as AgentSources;
}
/** Closed syntax compilation only. No module execution/import on the host. */
export async function compileAgentSources(raw: unknown): Promise<CompiledAgent> {
  try {
    if (!raw || typeof raw !== "object" || types.isProxy(raw) || Object.getPrototypeOf(raw) !== Object.prototype) fail("AGENT_CLOSURE");
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(descriptors).length !== 2 || AGENT_PATHS.some(path => !descriptors[path] || !("value" in descriptors[path]) || !descriptors[path].enumerable)) fail("AGENT_CLOSURE");
    const sources = {} as AgentSources;
    for (const path of AGENT_PATHS) {
      const source = descriptors[path].value;
      if (typeof source !== "string" || Buffer.byteLength(source) > 32000) fail("AGENT_CLOSURE");
      walk(ast(source), node => {
        if (node.type === "ImportDeclaration") {
          if (path !== AGENT_PATHS[1] || (node.source as { value?: string }).value !== "./diagnostic-policy") fail("AGENT_CLOSURE");
        } else if (["ImportExpression", "Import", "TSImportEqualsDeclaration", "TSImportType", "ExportAllDeclaration", "MetaProperty"].includes(String(node.type))
          || (node.type === "ExportNamedDeclaration" && node.source)
          || (node.type === "Identifier" && ["require", "eval", "Function"].includes(String(node.name)))) fail("AGENT_CLOSURE");
      });
      sources[path] = source;
    }
    const built = await compiler.build({ stdin: { contents: sources[AGENT_PATHS[1]], loader: "ts", sourcefile: AGENT_PATHS[1] },
      plugins: [{ name: "two-strategy-closure", setup(build: { onResolve(options: { filter: RegExp }, callback: (arg: { path: string }) => unknown): void; onLoad(options: { filter: RegExp; namespace: string }, callback: () => unknown): void }) {
        build.onResolve({ filter: /.*/ }, arg => arg.path === "./diagnostic-policy" ? { path: AGENT_PATHS[0], namespace: "rsi-agent" } : { errors: [{ text: "RSI_AGENT_CLOSURE" }] });
        build.onLoad({ filter: /.*/, namespace: "rsi-agent" }, () => ({ contents: sources[AGENT_PATHS[0]], loader: "ts" }));
      } }], bundle: true, platform: "neutral", format: "esm", target: "es2022", write: false, sourcemap: false, legalComments: "none", logLevel: "silent" });
    if (built.warnings.length || built.outputFiles.length !== 1 || Buffer.byteLength(built.outputFiles[0].text) > 65536) fail("AGENT_CLOSURE");
    const source = built.outputFiles[0].text, moduleDigests = Object.fromEntries(AGENT_PATHS.map(path => [path, hash(sources[path])]));
    return snapshot({ source, compiledDigest: hash(source), agentHash: jsonHash({ schemaVersion: 1, modules: moduleDigests }), moduleDigests });
  } catch { return fail("AGENT_CLOSURE"); }
}

const evidenceIds = z.union([z.literal("UNKNOWN"), z.array(z.uuid()).min(1).max(6).refine(ids => new Set(ids).size === ids.length)]);
const diagnosisSchema = z.strictObject({ action: z.literal("DIAGNOSE"), hypotheses: z.array(z.strictObject({
  cause: z.enum(["NATIVE_FETCH_RECEIVER", "UPSTREAM_HTTP", "AUTH_CONTRACT", "UNKNOWN"]), supportingEvidenceIds: evidenceIds, refutingEvidenceIds: evidenceIds,
})).min(2).max(4), reproducer: z.literal("PUBLIC_SIX_PATHS"), relatedRegressions: z.array(z.enum(["NORMAL", "HTTP_STATUS", "AUTH_REDIRECT", "AUTH_STATUS"])).min(1).max(4) });
export function validateDiagnosis(raw: unknown, observation: unknown) {
  try {
    const value = diagnosisSchema.parse(parseBoundedJsonObject(raw)), obs = parseObservation(observation);
    if (new Set(value.hypotheses.map(row => row.cause)).size !== value.hypotheses.length || new Set(value.relatedRegressions).size !== value.relatedRegressions.length) fail("DIAGNOSIS");
    const ids = new Set(obs.evidence.map(e => e.evidenceId));
    for (const row of value.hypotheses) {
      for (const list of [row.supportingEvidenceIds, row.refutingEvidenceIds]) if (list !== "UNKNOWN" && list.some(id => !ids.has(id))) fail("DIAGNOSIS");
      if (row.supportingEvidenceIds !== "UNKNOWN" && row.refutingEvidenceIds !== "UNKNOWN" && row.supportingEvidenceIds.some(id => row.refutingEvidenceIds.includes(id))) fail("DIAGNOSIS");
    }
    return snapshot(value);
  } catch { return fail("DIAGNOSIS"); }
}
const noChangeSchema = z.strictObject({ action: z.literal("NO_CHANGE"), reason: z.string().min(1).max(128) });
const patchSchema = z.strictObject({ action: z.literal("PATCH"), path: z.literal(NATIVE_SOURCE_PATH), baseSourceDigest: digest, find: z.string().min(1).max(512), replace: z.string().min(1).max(512) });
function initializer(source: string) {
  const matches: Record<string, unknown>[] = [];
  walk(ast(source), node => { if (node.type === "VariableDeclarator" && (node.id as { name?: string })?.name === "fetchPath") matches.push(node.init as Record<string, unknown>); });
  if (matches.length !== 1 || !matches[0] || !Number.isInteger(matches[0].start) || !Number.isInteger(matches[0].end)) fail("PATCH");
  return matches[0] as Record<string, unknown> & { start: number; end: number };
}
// Deliberately receiver-only: no statements, assignment, computed access, new
// objects, callbacks, network overrides or changes to the six-path contract.
function receiverExpression(node: Record<string, unknown>): boolean {
  if (node.type === "Identifier") return ["input", "globalThis"].includes(String(node.name));
  if (node.type === "MemberExpression" && !node.computed && !node.optional) {
    const property = node.property as { type?: string; name?: string };
    return property.type === "Identifier" && ["fetch", "bind"].includes(property.name ?? "") && receiverExpression(node.object as Record<string, unknown>);
  }
  if (node.type === "CallExpression" && !node.optional && (node.callee as { type?: string }).type === "MemberExpression") {
    const callee = node.callee as Record<string, unknown>, property = callee.property as { name?: string }, args = node.arguments as Record<string, unknown>[];
    return property.name === "bind" && receiverExpression(callee) && args.length === 1 && args[0].type === "Identifier" && ["input", "globalThis"].includes(String(args[0].name));
  }
  return false;
}
export async function validateReceiverPatch(baseSource: string, raw: unknown) {
  try {
    const patch = patchSchema.parse(parseBoundedJsonObject(raw));
    if (patch.baseSourceDigest !== hash(baseSource) || patch.find === patch.replace || baseSource.split(patch.find).length !== 2) fail("PATCH");
    const before = initializer(baseSource), offset = baseSource.indexOf(patch.find);
    if (offset < before.start || offset + patch.find.length > before.end) fail("PATCH");
    const source = baseSource.slice(0, offset) + patch.replace + baseSource.slice(offset + patch.find.length), after = initializer(source);
    if (!receiverExpression(after) || baseSource.slice(0, before.start) !== source.slice(0, after.start) || baseSource.slice(before.end) !== source.slice(after.end)) fail("PATCH");
    return snapshot({ path: NATIVE_SOURCE_PATH, source, sourceDigest: hash(source), diffDigest: jsonHash(patch) });
  } catch { return fail("PATCH"); }
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

const controllerFiles = ["scripts/rsi/controller.ts", "scripts/rsi/contracts.ts", "scripts/rsi/ledger.ts", "scripts/rsi/memory.ts", "scripts/rsi/model-broker.ts", "scripts/rsi/sandbox.ts", "scripts/rsi/container-backend.ts", "scripts/rsi/sandbox-policy.json", "package.json", "pnpm-lock.yaml"];
const evaluatorFiles = ["scripts/rsi/evaluator.ts", "scripts/rsi/contracts.ts", "scripts/rsi/oracle.ts", "scripts/rsi/native-executor.ts", "scripts/rsi/native-wrapper.ts", "scripts/rsi/container-backend.ts", "scripts/rsi/fixtures/native-runtime.Dockerfile", "scripts/rsi/fixtures/development-manifest.json", "package.json", "pnpm-lock.yaml"];
const trustedNativeManifestDigest = "605ad858ec0c49edda87c5b733d06bf04c954388bb619a1e81664400d20627ae";
// Fixed backend: create/inspect/final-inspect/rm = 4*5000ms, plus
// start=3000/15000ms. Agent verify adds info/image inspect and the initial
// local endpoint discovery (5000ms); native verify adds info/two image
// inspections, isolation probe and runtime probe. Cleanup is included.
const admissionMs = Object.freeze({ agentVerify: 38000, nativeVerify: 85000, agentRun: 23000, nativeRun: 35000 });
async function fileDigests(paths: string[]) { return Object.fromEntries(await Promise.all([...paths].sort().map(async path => [path, hash(await readFile(join(root, path)))]))); }
async function fixedClosure() {
  const manifest = JSON.parse(await readFile(join(root, ".superpowers/sdd/r3-implementation-plan/native-manifest.json"), "utf8"));
  if (jsonHash(manifest) !== trustedNativeManifestDigest) fail("MANIFEST");
  const controller = { schemaVersion: 1, scope: "LOCAL_SYNTHETIC_RECEIVER_ONLY", files: await fileDigests(controllerFiles), modelPolicy: MODEL_POLICY, admissionMs, sandboxPolicyDigest: SANDBOX_POLICY_DIGEST, hostNode: process.versions.node };
  const evaluator = { schemaVersion: 1, files: await fileDigests(evaluatorFiles), manifestDigest: jsonHash(manifest), nativeLimits: NATIVE_LIMITS };
  return snapshot({ controller, evaluator, controllerHash: jsonHash(controller), evaluatorHash: jsonHash(evaluator), manifest });
}
export interface ControllerEvidence { readonly reference: RsiEvidenceReference; readonly custody: "SUPERVISOR" | "ACTUAL_AGENT_CONTAINER" | "ACTUAL_NATIVE" | "LOCAL_SYNTHETIC_CI"; readonly detail: unknown }
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
type NativeResult = Awaited<ReturnType<NativeExecutor["evaluate"]>>;
/** Positive receipts are accepted only from the capability called by this fixed
 * supervisor. This predicate is additional validation, never receipt authority. */
function nativeCustody(value: NativeResult, sourceDigest: string, fixture: RsiFixture, manifestDigest: string) {
  const p = value.provenance;
  return p.transportKind === "DOCKER_CLI" && p.sourceDigest === sourceDigest && p.fixture === fixture && p.manifestDigest === manifestDigest
    && "logs" in p && p.logs?.valid && p.logs.warningCount === 1 && p.logs.rejectedCount === 0 && p.logs.forbiddenMarkerCount === 0
    && p.logs.custody.stdoutEof && p.logs.custody.stderrEof && p.logs.custody.errorCount === 0 && p.logs.custody.prematureCloseCount === 0
    && p.cleanupConfirmed === true && p.disposalConfirmed === true && p.deadlineExpired === false && p.childSpawns === 1 && p.dispatchAttempts === 1
    && typeof p.receiptDigest === "string" && typeof p.traceDigest === "string" && typeof p.responseDigest === "string";
}

/** One local synthetic incident. No provider, GitHub, app write, merge, close
 * incident, deployment, live probe or remote operation is reachable here. */
export async function recoverSyntheticIncident(options: SyntheticRecoveryOptions): Promise<SyntheticRecoveryResult> {
  const evidence: ControllerEvidence[] = [];
  let status: RsiStatus = "OBSERVED", reasonCode = "EVIDENCE_UNKNOWN", lineage: RsiLineage | null = null, candidateCount = 0;
  let broker: LocalFakeModelBroker | undefined, brokerReceipt: unknown = null, finishing = false, checkpointBroken = false;
  const nowUtc = options.nowUtc ?? (() => new Date().toISOString()), clock = options.monotonicMs ?? (() => performance.now());
  const started = clock(); let lastTime = started;
  function gate(requiredMs = 0) {
    if (options.killSwitch()) fail("OPERATOR_STOP");
    const now = clock();
    if (!Number.isFinite(started) || started < 0 || !Number.isFinite(now) || now < lastTime) fail("CLOCK");
    lastTime = now; if (now - started + requiredMs >= MODEL_POLICY.recoveryTimeoutMs) fail("DEADLINE");
  }
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
    if (advancing) gate();
  }
  async function finish() {
    if (broker && !finishing) { finishing = true; brokerReceipt = await broker.finish(); }
  }
  const result = () => snapshot({ schemaVersion: 1 as const, mode: "LOCAL_SYNTHETIC" as const, status, reasonCode, actualRecovery: false as const, candidateCount, lineage, evidence, checkpoint: options.ledger.checkpoint, broker: brokerReceipt });
  try {
    gate(); await options.checkpointStore.assertCurrent(options.ledger.checkpoint);
    const observation = parseObservation(options.observation);
    if (observation.incident.source !== "LOCAL_SYNTHETIC" || typeof options.baseSource !== "string" || Buffer.byteLength(options.baseSource) > 65536) fail("INPUT");
    const agent = await compileAgentSources(options.agentSources), closure = await fixedClosure(); gate();
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
    // No adapter parameters exist on this entrypoint. Test monkeypatches are not
    // evidence of a real capability; injected transports fail the custody gates.
    gate(admissionMs.agentVerify); const sandbox = await DockerSandbox.verify(); gate();
    gate(admissionMs.nativeVerify); const native = await NativeExecutor.verify(closure.manifest); gate();
    let sequence = 0;
    async function agentStep(phase: "DIAGNOSE" | "PATCH") {
      gate();
      const publicInput = { phase, source: options.baseSource, sourceDigest: hash(options.baseSource), observation,
        allowedEdit: { path: NATIVE_SOURCE_PATH, region: "fetchPath initializer only", maxCandidates: 2 },
        lessons: memory.snapshot.lessons.filter(l => retrieval.selectedLessonIds.includes(l.lessonId)).map(l => ({ lessonId: l.lessonId, policy: l.policy })) };
      gate(MODEL_POLICY.callTimeoutMs);
      const reply = await broker!.request(++sequence, JSON.stringify({ schemaVersion: 1, task: "repair", message: JSON.stringify(publicInput) })); gate();
      const input = { schemaVersion: 1, taskKind: "repair", payload: { ...publicInput, modelReply: reply.untrustedOutput } };
      gate(admissionMs.agentRun); const returned = await sandbox.execute({ schemaVersion: 1, source: agent.source, input }); gate();
      if (returned.evidence.transportKind !== "DOCKER_CLI" || returned.evidence.sourceDigest !== agent.compiledDigest || returned.evidence.inputDigest !== jsonHash(input) || returned.evidence.policyDigest !== SANDBOX_POLICY_DIGEST) fail("AGENT_CUSTODY");
      record("INPUT_MATCH", "PASS", { ...returned.evidence, brokerMetadata: reply.metadata, activeAgentHash: agent.agentHash }, "ACTUAL_AGENT_CONTAINER");
      return returned.untrustedOutput;
    }
    async function evaluate(source: string, fixture: RsiFixture, kind: "RED_TEST" | "GREEN_TEST" | "REGRESSION") {
      gate(admissionMs.nativeRun); const value = snapshot(await native.evaluate({ path: NATIVE_SOURCE_PATH, source, sourceDigest: hash(source), fixture }));
      const verified = nativeCustody(value, hash(source), fixture, closure.evaluator.manifestDigest) && value.verdict !== "UNKNOWN";
      // Keep the first incomplete invocation and its custody/cleanup diagnostic;
      // an actual attempt with UNKNOWN is not a verified native success.
      const reference = record(kind, verified ? value.verdict === "FAIL" ? "FAIL" : "PASS" : "UNKNOWN", value,
        value.provenance.transportKind === "DOCKER_CLI" ? "ACTUAL_NATIVE" : "SUPERVISOR", kind === "REGRESSION" ? "REGRESSION_TEST" : "FOCUSED_TEST");
      gate(); if (!verified) fail("NATIVE_UNKNOWN");
      return { value, reference };
    }
    const initial = await agentStep("DIAGNOSE"), noChange = noChangeSchema.safeParse(initial);
    const diagnosis = noChange.success ? null : validateDiagnosis(initial, observation);
    if (diagnosis) await transition("TRIAGED", diagnosis.hypotheses.map(h => record("HYPOTHESIS", h.supportingEvidenceIds === "UNKNOWN" ? "UNKNOWN" : "PASS", h)));
    const fixture = options.baselineFixture ?? "NATIVE_RECEIVER";
    const red = await evaluate(options.baseSource, fixture, "RED_TEST");
    if (red.value.verdict === "NO_CHANGE" || (noChange.success && observation.verdict === "PASS" && red.value.verdict === "PASS")) {
      const normal = ((fixture === "NORMAL" && red.value.reasonCode === "NORMAL") || (fixture === "NATIVE_RECEIVER" && red.value.reasonCode === "SIX_PATHS_VERIFIED")) && red.value.greenVerified && red.value.provenance.callCount === 6;
      const external = ["HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"].includes(fixture) && red.value.reasonCode === "EXTERNAL_FAILURE" && !red.value.greenVerified && red.value.provenance.callCount === 6;
      if (!normal && !external) fail("NATIVE_UNKNOWN");
      await finish(); gate(); const disposition = normal ? "NORMAL" : "EXTERNAL_FAILURE"; reasonCode = disposition;
      await transition("NO_CHANGE", [record("NO_CHANGE", "PASS", { nativeDigest: red.reference.digest, disposition })], disposition); return result();
    }
    if (noChange.success) fail("NO_CHANGE_UNCONFIRMED");
    const receiver = diagnosis!.hypotheses.find(h => h.cause === "NATIVE_FETCH_RECEIVER");
    const init = initializer(options.baseSource);
    if (fixture !== "NATIVE_RECEIVER" || observation.verdict !== "FAIL" || observation.incident.failedPaths.length !== 6 || !receiver || receiver.supportingEvidenceIds === "UNKNOWN"
      || red.value.verdict !== "FAIL" || red.value.reason !== "ORACLE_RESULT" || red.value.provenance.callCount !== 0 || !receiverExpression(init)) fail("REPRODUCTION_FAILED");
    await transition("REPRODUCED", [red.reference, record("REPRODUCTION", "PASS", { observationFingerprint: lineage.eventFingerprint, hypothesisDigest: jsonHash(receiver), sourceDigest: hash(options.baseSource), nativeDigest: red.reference.digest })]);
    let green: Awaited<ReturnType<typeof evaluate>> | undefined, candidate: Awaited<ReturnType<typeof validateReceiverPatch>> | undefined;
    for (; candidateCount < 2;) {
      const proposal = await agentStep("PATCH");
      if (noChangeSchema.safeParse(proposal).success) fail("NO_CHANGE_UNCONFIRMED");
      candidateCount++; const checked = await validateReceiverPatch(options.baseSource, proposal);
      const evaluation = await evaluate(checked.source, "NATIVE_RECEIVER", "GREEN_TEST");
      if (evaluation.value.verdict === "PASS" && evaluation.value.greenVerified && evaluation.value.reasonCode === "SIX_PATHS_VERIFIED" && evaluation.value.provenance.callCount === 6) { candidate = checked; green = evaluation; break; }
    }
    if (!candidate || !green) fail("CANDIDATE_LIMIT");
    await transition("PATCHED", [record("DIFF", "PASS", { path: candidate.path, diffDigest: candidate.diffDigest, sourceDigest: candidate.sourceDigest }), record("PATH_ALLOWLIST", "PASS", { path: NATIVE_SOURCE_PATH, region: "fetchPath initializer only" }), record("INPUT_MATCH", "PASS", { baseSourceDigest: hash(options.baseSource), candidateSourceDigest: candidate.sourceDigest })]);
    const regressionRefs: RsiEvidenceReference[] = [];
    for (const regression of ["NORMAL", "HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"] as const) {
      const result = await evaluate(candidate.source, regression, "REGRESSION");
      if (result.value.verdict !== "NO_CHANGE" || result.value.reasonCode !== (regression === "NORMAL" ? "NORMAL" : "EXTERNAL_FAILURE") || result.value.greenVerified !== (regression === "NORMAL") || result.value.provenance.callCount !== 6) fail("REGRESSION");
      regressionRefs.push(result.reference);
    }
    await finish(); gate();
    const state = await options.ledger.read(), run = state.runs.find(r => r.lineage.runId === lineage!.runId);
    if (run?.settlement?.kind !== "CONFIRMED") fail("ACCOUNTING");
    const syntheticCi = (["CI_UNIT", "CI_INTEGRATION", "CI_BUILD", "CI_PLAYWRIGHT_SMOKE"] as const).map(command => record("CI", "PASS", { mode: "LOCAL_SYNTHETIC", command, executedGithubCi: false, greenDigest: green.reference.digest, regressionDigests: regressionRefs.map(r => r.digest) }, "LOCAL_SYNTHETIC_CI", command));
    await transition("VERIFIED", [green.reference, ...regressionRefs, ...syntheticCi, record("AUTHORIZATION", "PASS", { scope: "LOCAL_SYNTHETIC_RECEIVER_ONLY", operationsAllowed: false }), record("BUDGET", "PASS", { settlement: run.settlement, candidateCount, maxCandidates: 2, maxCalls: 8, deadlineMs: 120000 })]); gate();
    reasonCode = "LOCAL_SYNTHETIC_PR_READY";
    await transition("PR_READY", [record("OUTCOME", "PASS", { mode: "LOCAL_SYNTHETIC", candidateSourceDigest: candidate.sourceDigest, actualRecovery: false }), record("PR_REVIEW", "PASS", { review: "FIXED_LOCAL_SYNTHETIC_GATE", githubPrCreated: false, mergeAllowed: false, liveVerified: false })]);
    return result();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    reasonCode = message === "RSI_BROKER_DUPLICATE" ? "DUPLICATE" : message === "RSI_LEDGER_BUDGET" ? "BUDGET_UNAVAILABLE"
      : /(?:KILLED|OPERATOR_STOP)$/.test(message) ? "OPERATOR_STOP" : /(?:DEADLINE|CLOCK)$/.test(message) ? "DEADLINE_OR_CLOCK"
      : /(?:SANDBOX_BLOCKED|NATIVE_BLOCKED|ARTIFACT_MISMATCH|COMPATIBILITY_UNSUPPORTED)$/.test(message) ? "BACKEND_UNAVAILABLE"
      : message === "RSI_CONTROLLER_PATCH" ? "POLICY_REJECTED" : message === "RSI_CONTROLLER_REPRODUCTION_FAILED" ? "REPRODUCTION_FAILED"
      : message === "RSI_CONTROLLER_REGRESSION" ? "REGRESSION_FAILED" : message === "RSI_CONTROLLER_CANDIDATE_LIMIT" ? "CANDIDATE_LIMIT"
      : message === "RSI_CONTROLLER_NO_CHANGE_UNCONFIRMED" ? "NO_CHANGE_UNCONFIRMED" : /(?:CHECKPOINT|ACCOUNTING)$/.test(message) ? "ACCOUNTING_UNCERTAIN" : "EVIDENCE_UNKNOWN";
    try { await finish(); } catch { checkpointBroken = true; reasonCode = "ACCOUNTING_UNCERTAIN"; }
    const target = reasonCode === "POLICY_REJECTED" ? "REJECTED" : ["BACKEND_UNAVAILABLE", "DUPLICATE", "BUDGET_UNAVAILABLE", "OPERATOR_STOP", "DEADLINE_OR_CLOCK", "ACCOUNTING_UNCERTAIN"].includes(reasonCode) ? "BLOCKED" : "INCONCLUSIVE";
    if (broker && !checkpointBroken && lineage) {
      try { await transition(target, [record("OUTCOME", "UNKNOWN", { reasonCode, failureCode: /^RSI_(?:CONTROLLER|BROKER|NATIVE|SANDBOX|LEDGER)_[A-Z0-9_]+$/.test(message) ? message : "UNVERIFIED", actualRecovery: false })], reasonCode === "POLICY_REJECTED" ? "POLICY_REJECTED" : reasonCode === "OPERATOR_STOP" ? "OPERATOR_STOP" : reasonCode === "REPRODUCTION_FAILED" ? "REPRODUCTION_FAILED" : "EVIDENCE_UNKNOWN"); }
      catch { reasonCode = "ACCOUNTING_UNCERTAIN"; status = "BLOCKED"; }
    } else status = target;
    return result();
  }
}
