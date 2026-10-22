import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { types } from "node:util";
import { z } from "zod";
import { deriveObservationFingerprint, parseObservation, type RsiEvidenceReference, type RsiObservation } from "./contracts";
import { MODEL_POLICY, type LocalFakeModelBroker } from "./model-broker";
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
const approvedReceiverFamily = Object.freeze({ schemaVersion: 1, family: "NATIVE_FETCH_INPUT_RECEIVER_V1",
  anchorAppSha: "741e919aedabdeadd6d46619a35a0105bafdce66",
  protectedContextDigest: "365fba0ded44c6d6e6a07dafbe271be6d2ff72314d32e62bc8a5a565a079f2fb" });
function identifier(node: unknown, name: string) { const value = node as { type?: string; name?: string } | null; return value?.type === "Identifier" && value.name === name; }
function member(node: Record<string, unknown>, property: string) { return node?.type === "MemberExpression" && !node.computed && !node.optional && identifier(node.property, property); }
/** Independent source-family contract, not an oracle or replacement generator.
 * The approved context binds the input/native fetch provenance and callsites;
 * FAIL/0 alone cannot distinguish a receiver fault from another TypeError. */
function receiverFamilyProof(source: string) {
  try {
    const init = initializer(source), callee = init.callee as Record<string, unknown>, args = init.arguments as unknown[];
    const fetch = callee?.object as Record<string, unknown>;
    if (init.type !== "CallExpression" || init.optional || init.typeParameters || init.typeArguments || !member(callee, "bind")
      || !member(fetch, "fetch") || !identifier(fetch.object, "input") || !Array.isArray(args) || args.length !== 1 || !identifier(args[0], "input")) fail("REPRODUCTION_FAILED");
    const protectedContextDigest = hash(source.slice(0, init.start) + "<rsi-receiver-initializer-v1>" + source.slice(init.end));
    if (protectedContextDigest !== approvedReceiverFamily.protectedContextDigest) fail("REPRODUCTION_FAILED");
    return snapshot({ ...approvedReceiverFamily, contractDigest: jsonHash(approvedReceiverFamily), initializerDigest: hash(source.slice(init.start, init.end)) });
  } catch { return fail("REPRODUCTION_FAILED"); }
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
    receiverFamilyProof(baseSource);
    if (patch.baseSourceDigest !== hash(baseSource) || patch.find === patch.replace || baseSource.split(patch.find).length !== 2) fail("PATCH");
    const before = initializer(baseSource), offset = baseSource.indexOf(patch.find);
    if (offset < before.start || offset + patch.find.length > before.end) fail("PATCH");
    const source = baseSource.slice(0, offset) + patch.replace + baseSource.slice(offset + patch.find.length), after = initializer(source);
    if (after.type === "Identifier" || !receiverExpression(after) || baseSource.slice(0, before.start) !== source.slice(0, after.start) || baseSource.slice(before.end) !== source.slice(after.end)) fail("PATCH");
    return snapshot({ path: NATIVE_SOURCE_PATH, source, sourceDigest: hash(source), diffDigest: jsonHash(patch) });
  } catch { return fail("PATCH"); }
}

const controllerFiles = ["scripts/rsi/controller.ts", "scripts/rsi/repair-core.ts", "scripts/rsi/fixtures/native-manifest.pinned.json", "scripts/rsi/contracts.ts", "scripts/rsi/execution-contracts.ts", "scripts/rsi/ledger.ts", "scripts/rsi/memory.ts", "scripts/rsi/model-broker.ts", "scripts/rsi/sandbox.ts", "scripts/rsi/container-backend.ts", "scripts/rsi/sandbox-policy.json", "package.json", "pnpm-lock.yaml"];
const evaluatorFiles = ["scripts/rsi/repair-core.ts", "scripts/rsi/fixtures/native-manifest.pinned.json", "scripts/rsi/evaluator.ts", "scripts/rsi/contracts.ts", "scripts/rsi/oracle.ts", "scripts/rsi/native-executor.ts", "scripts/rsi/native-wrapper.ts", "scripts/rsi/container-backend.ts", "scripts/rsi/fixtures/native-runtime.Dockerfile", "scripts/rsi/fixtures/development-manifest.json", "package.json", "pnpm-lock.yaml"];
const trustedNativeManifestDigest = "605ad858ec0c49edda87c5b733d06bf04c954388bb619a1e81664400d20627ae";
// Fixed backend: create/inspect/final-inspect/rm = 4*5000ms, plus
// start=3000/15000ms. Agent verify adds info/image inspect and the initial
// local endpoint discovery (5000ms); native verify adds info/two image
// inspections, isolation probe and runtime probe. Cleanup is included.
const admissionMs = Object.freeze({ agentVerify: 38000, nativeVerify: 85000, agentRun: 23000, nativeRun: 35000 });
const r4Files = ["scripts/rsi/execution-contracts.ts", "scripts/rsi/repair-core.ts", "scripts/rsi/promotion.ts", "scripts/rsi/self-improve.ts", "scripts/rsi/fixtures/native-manifest.pinned.json"];
async function fileDigests(paths: readonly string[]) {
  try { return Object.fromEntries(await Promise.all([...new Set(paths)].sort().map(async path => [path, hash(await readFile(join(root, path)))]))); }
  catch { return fail("CLOSURE_UNVERIFIED"); }
}
/** Fixed tracked artifact, never a runtime discovery or a manifest re-builder. */
export async function loadPinnedNativeManifest(): Promise<unknown> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(root, "scripts/rsi/fixtures/native-manifest.pinned.json"), "utf8"));
    if (jsonHash(manifest) !== trustedNativeManifestDigest) fail("MANIFEST_UNVERIFIED");
    return snapshot(manifest);
  } catch { return fail("MANIFEST_UNVERIFIED"); }
}
/** R3 and R4 measure separate fixed closures. Missing R4 files block R4 even
 * while R3 remains usable; no optional or empty digest can stand in for bytes.
 * This is the supervisor closure API, not the unchanged R2 evaluator hash API. */
export async function measureFixedClosure(scope: "R3" | "R4") {
  if (scope !== "R3" && scope !== "R4") fail("CLOSURE_UNVERIFIED");
  const manifest = await loadPinnedNativeManifest(), extra = scope === "R4" ? r4Files : [];
  const controller = { schemaVersion: 1, scope: scope === "R3" ? "LOCAL_SYNTHETIC_RECEIVER_ONLY" : "LOCAL_SYNTHETIC_R4_SELF_IMPROVE",
    files: await fileDigests([...controllerFiles, ...extra]), modelPolicy: MODEL_POLICY, admissionMs,
    receiverFamily: approvedReceiverFamily, sandboxPolicyDigest: SANDBOX_POLICY_DIGEST, hostNode: process.versions.node };
  const evaluator = { schemaVersion: 1, files: await fileDigests([...evaluatorFiles, ...extra, ...(scope === "R4" ? ["scripts/rsi/controller.ts"] : [])]), manifestDigest: jsonHash(manifest), nativeLimits: NATIVE_LIMITS };
  return snapshot({ controller, evaluator, controllerHash: jsonHash(controller), evaluatorHash: jsonHash(evaluator), manifest });
}
export type FixedRepairClosure = Awaited<ReturnType<typeof measureFixedClosure>>;

export interface RepairRootGate {
  readonly rootTiming: Readonly<{ startedMs: number; deadlineMs: number }>;
  check(requiredMs?: number): void;
}
/** The trusted root captures timing before input/compile. This helper requires
 * that existing timing; neither a nested helper nor phase gets a fresh 120s. */
export function createRepairRootGate(options: { rootTiming: { startedMs: number; deadlineMs: number }; killSwitch: () => boolean; monotonicMs: () => number }): RepairRootGate {
  const { startedMs, deadlineMs } = options.rootTiming;
  if (![startedMs, deadlineMs].every(Number.isFinite) || startedMs < 0 || deadlineMs <= startedMs || deadlineMs - startedMs > MODEL_POLICY.recoveryTimeoutMs) fail("CLOCK");
  let lastTime = startedMs;
  return Object.freeze({ rootTiming: Object.freeze({ startedMs, deadlineMs }), check(requiredMs = 0) {
    if (options.killSwitch()) fail("OPERATOR_STOP");
    const now = options.monotonicMs();
    if (!Number.isFinite(now) || now < lastTime || !Number.isFinite(requiredMs) || requiredMs < 0) fail("CLOCK");
    lastTime = now; if (now + requiredMs >= deadlineMs) fail("DEADLINE");
  } });
}
export interface ControllerEvidence { readonly reference: RsiEvidenceReference; readonly custody: "SUPERVISOR" | "ACTUAL_AGENT_CONTAINER" | "ACTUAL_NATIVE" | "LOCAL_SYNTHETIC_CI"; readonly detail: unknown }
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


/** Only a trusted supervisor supplies an already-reserved broker/phase handle.
 * The core never opens, reserves, settles or finishes a model pool. */
export type ModelRequestCapability = Pick<LocalFakeModelBroker, "request">;
export type RepairRequest =
  | { purpose: "R1_RECOVERY"; capability: ModelRequestCapability; nextSequence: () => number }
  | { purpose: "R4_BASELINE_REPAIR" | "R4_PROMOTION_REPAIR"; capability: ReturnType<LocalFakeModelBroker["phase"]>; nextSequence: () => number };
export type RepairCoreEvent =
  | { kind: "EVIDENCE"; evidence: ControllerEvidence }
  | { kind: "STAGE"; status: "TRIAGED" | "REPRODUCED" | "PATCHED"; evidence: readonly RsiEvidenceReference[] }
  | { kind: "CANDIDATE"; candidateCount: number };
export interface ActualRepairOptions {
  agent: CompiledAgent; closure: FixedRepairClosure; rootGate: RepairRootGate; request: RepairRequest;
  observation: unknown; baseSource: string; lessons: readonly { lessonId: string; policy: string }[];
  baselineFixture?: RsiFixture;
  /** Awaited recording only. Return values never select execution or PASS. */
  onEvent?: (event: RepairCoreEvent) => void | Promise<void>;
}
export type ActualRepairResult =
  | { outcome: "NO_CHANGE"; disposition: "NORMAL" | "EXTERNAL_FAILURE"; nativeReference: RsiEvidenceReference; candidateCount: 0; evidence: readonly ControllerEvidence[] }
  | { outcome: "REPAIRED"; candidate: Awaited<ReturnType<typeof validateReceiverPatch>>; greenReference: RsiEvidenceReference; regressionReferences: readonly RsiEvidenceReference[]; candidateCount: number; evidence: readonly ControllerEvidence[] };
export interface ActualAgentStepOptions {
  agent: CompiledAgent; rootGate: RepairRootGate; capability: ModelRequestCapability;
  sequence: number; taskKind: "repair" | "improve-agent"; publicInput: Record<string, unknown>;
}
function checkedAgent(agent: CompiledAgent) {
  if (hash(agent.source) !== agent.compiledDigest || jsonHash({ schemaVersion: 1, modules: agent.moduleDigests }) !== agent.agentHash) fail("AGENT_CUSTODY");
  return snapshot(agent);
}
async function executeAgentStep(options: ActualAgentStepOptions, sandbox: DockerSandbox, inputKind: "BOUNDED" | "CONSTRUCTED_R1" = "BOUNDED") {
  const { rootGate, sequence, taskKind, capability } = options, agent = checkedAgent(options.agent);
  // The fixed R1 repair input must reach its broker's canonical byte guard so
  // a rejected request still consumes its original ordinal. The public helper
  // and R4 inputs retain the bounded passive guard before requesting a model.
  const publicInput = snapshot(inputKind === "CONSTRUCTED_R1" ? options.publicInput : parseBoundedJsonObject(options.publicInput)); rootGate.check(MODEL_POLICY.callTimeoutMs);
  const reply = await capability.request(sequence, JSON.stringify({ schemaVersion: 1, task: taskKind, message: JSON.stringify(publicInput) })); rootGate.check();
  const input = { schemaVersion: 1, taskKind, payload: { ...publicInput, modelReply: reply.untrustedOutput } };
  rootGate.check(admissionMs.agentRun);
  const returned = await sandbox.execute({ schemaVersion: 1, source: agent.source, input }); rootGate.check();
  if (returned.evidence.transportKind !== "DOCKER_CLI" || returned.evidence.sourceDigest !== agent.compiledDigest
    || returned.evidence.inputDigest !== jsonHash(input) || returned.evidence.policyDigest !== SANDBOX_POLICY_DIGEST
    || returned.evidence.outputDigest !== jsonHash({ schemaVersion: 1, output: returned.untrustedOutput })) fail("AGENT_CUSTODY");
  return snapshot({ untrustedOutput: returned.untrustedOutput, evidence: returned.evidence, brokerMetadata: reply.metadata,
    activeAgentHash: agent.agentHash, actualInputDigest: returned.evidence.inputDigest, actualOutputDigest: returned.evidence.outputDigest });
}
/** Same fixed actual agent step used by repair and R4 improve-agent generation.
 * No caller executor, transport, success predicate or provider callback exists. */
export async function runActualAgentStep(options: ActualAgentStepOptions) {
  options.rootGate.check(admissionMs.agentVerify); const sandbox = await DockerSandbox.verify(); options.rootGate.check();
  return executeAgentStep(options, sandbox);
}

/** Shared real-capability repair algorithm. Only the R1 wrapper owns R1 status,
 * finish/settlement and durable terminal policy. R4 supplies its own phase and
 * shared timing, never calls that wrapper or creates another reservation. */
export async function runActualRepairCore(options: ActualRepairOptions): Promise<ActualRepairResult> {
  const gate = options.rootGate.check, agent = checkedAgent(options.agent), observation = parseObservation(options.observation);
  if (observation.incident.source !== "LOCAL_SYNTHETIC" || typeof options.baseSource !== "string" || Buffer.byteLength(options.baseSource) > 65536) fail("INPUT");
  const maxCandidates = options.request.purpose === "R1_RECOVERY" ? 2
    : ["R4_BASELINE_REPAIR", "R4_PROMOTION_REPAIR"].includes(options.request.purpose) ? 1 : fail("INPUT");
  const evidence: ControllerEvidence[] = []; let candidateCount = 0;
  async function emit(event: RepairCoreEvent) { await options.onEvent?.(snapshot(event)); gate(); }
  async function record(kind: RsiEvidenceReference["kind"], verdict: RsiEvidenceReference["verdict"], detail: unknown, custody: ControllerEvidence["custody"] = "SUPERVISOR", commandId: RsiEvidenceReference["commandId"] = null) {
    const row = snapshot({ reference: { evidenceId: randomUUID(), kind, digest: jsonHash(detail), verdict, commandId }, custody, detail });
    evidence.push(row); await emit({ kind: "EVIDENCE", evidence: row }); return row.reference;
  }
  async function stage(status: "TRIAGED" | "REPRODUCED" | "PATCHED", rows: RsiEvidenceReference[]) { await emit({ kind: "STAGE", status, evidence: rows }); }
  gate(admissionMs.agentVerify); const sandbox = await DockerSandbox.verify(); gate();
  gate(admissionMs.nativeVerify); const native = await NativeExecutor.verify(options.closure.manifest); gate();
  async function agentStep(phase: "DIAGNOSE" | "PATCH") {
    gate();
    const publicInput = { phase, source: options.baseSource, sourceDigest: hash(options.baseSource), observation,
      allowedEdit: { path: NATIVE_SOURCE_PATH, region: "fetchPath initializer only", maxCandidates }, lessons: options.lessons };
    const returned = await executeAgentStep({ agent, rootGate: options.rootGate, capability: options.request.capability,
      sequence: options.request.nextSequence(), taskKind: "repair", publicInput }, sandbox, options.request.purpose === "R1_RECOVERY" ? "CONSTRUCTED_R1" : "BOUNDED");
    await record("INPUT_MATCH", "PASS", { ...returned.evidence, brokerMetadata: returned.brokerMetadata, activeAgentHash: agent.agentHash }, "ACTUAL_AGENT_CONTAINER");
    return returned.untrustedOutput;
  }
  async function evaluate(source: string, fixture: RsiFixture, kind: "RED_TEST" | "GREEN_TEST" | "REGRESSION") {
    gate(admissionMs.nativeRun); const value = snapshot(await native.evaluate({ path: NATIVE_SOURCE_PATH, source, sourceDigest: hash(source), fixture }));
    const verified = nativeCustody(value, hash(source), fixture, options.closure.evaluator.manifestDigest) && value.verdict !== "UNKNOWN";
    const reference = await record(kind, verified ? value.verdict === "FAIL" ? "FAIL" : "PASS" : "UNKNOWN", value,
      value.provenance.transportKind === "DOCKER_CLI" ? "ACTUAL_NATIVE" : "SUPERVISOR", kind === "REGRESSION" ? "REGRESSION_TEST" : "FOCUSED_TEST");
    gate(); if (!verified) fail("NATIVE_UNKNOWN"); return { value, reference };
  }
  const initial = await agentStep("DIAGNOSE"), noChange = noChangeSchema.safeParse(initial);
  const diagnosis = noChange.success ? null : validateDiagnosis(initial, observation);
  if (diagnosis) {
    const hypotheses: RsiEvidenceReference[] = [];
    for (const hypothesis of diagnosis.hypotheses) hypotheses.push(await record("HYPOTHESIS", hypothesis.supportingEvidenceIds === "UNKNOWN" ? "UNKNOWN" : "PASS", hypothesis));
    await stage("TRIAGED", hypotheses);
  }
  const fixture = options.baselineFixture ?? "NATIVE_RECEIVER", red = await evaluate(options.baseSource, fixture, "RED_TEST");
  if (red.value.verdict === "NO_CHANGE" || (noChange.success && observation.verdict === "PASS" && red.value.verdict === "PASS")) {
    const normal = ((fixture === "NORMAL" && red.value.reasonCode === "NORMAL") || (fixture === "NATIVE_RECEIVER" && red.value.reasonCode === "SIX_PATHS_VERIFIED")) && red.value.greenVerified && red.value.provenance.callCount === 6;
    const external = ["HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"].includes(fixture) && red.value.reasonCode === "EXTERNAL_FAILURE" && !red.value.greenVerified && red.value.provenance.callCount === 6;
    if (!normal && !external) fail("NATIVE_UNKNOWN");
    return snapshot({ outcome: "NO_CHANGE", disposition: normal ? "NORMAL" : "EXTERNAL_FAILURE", nativeReference: red.reference, candidateCount: 0, evidence });
  }
  if (noChange.success) fail("NO_CHANGE_UNCONFIRMED");
  const receiver = diagnosis!.hypotheses.find(h => h.cause === "NATIVE_FETCH_RECEIVER"), receiverFamily = receiverFamilyProof(options.baseSource);
  if (fixture !== "NATIVE_RECEIVER" || observation.verdict !== "FAIL" || observation.incident.failedPaths.length !== 6 || !receiver || receiver.supportingEvidenceIds === "UNKNOWN"
    || red.value.verdict !== "FAIL" || red.value.reason !== "ORACLE_RESULT" || red.value.provenance.callCount !== 0) fail("REPRODUCTION_FAILED");
  await stage("REPRODUCED", [red.reference, await record("REPRODUCTION", "PASS", { observationFingerprint: deriveObservationFingerprint(observation), hypothesisDigest: jsonHash(receiver), sourceDigest: hash(options.baseSource), nativeDigest: red.reference.digest, receiverFamily })]);
  let green: Awaited<ReturnType<typeof evaluate>> | undefined, candidate: Awaited<ReturnType<typeof validateReceiverPatch>> | undefined;
  for (; candidateCount < maxCandidates;) {
    const proposal = await agentStep("PATCH"); if (noChangeSchema.safeParse(proposal).success) fail("NO_CHANGE_UNCONFIRMED");
    candidateCount++; await emit({ kind: "CANDIDATE", candidateCount });
    const checked = await validateReceiverPatch(options.baseSource, proposal), evaluation = await evaluate(checked.source, "NATIVE_RECEIVER", "GREEN_TEST");
    if (evaluation.value.verdict === "PASS" && evaluation.value.greenVerified && evaluation.value.reasonCode === "SIX_PATHS_VERIFIED" && evaluation.value.provenance.callCount === 6) { candidate = checked; green = evaluation; break; }
  }
  if (!candidate || !green) fail("CANDIDATE_LIMIT");
  await stage("PATCHED", [await record("DIFF", "PASS", { path: candidate.path, diffDigest: candidate.diffDigest, sourceDigest: candidate.sourceDigest }), await record("PATH_ALLOWLIST", "PASS", { path: NATIVE_SOURCE_PATH, region: "fetchPath initializer only" }), await record("INPUT_MATCH", "PASS", { baseSourceDigest: hash(options.baseSource), candidateSourceDigest: candidate.sourceDigest })]);
  const regressionReferences: RsiEvidenceReference[] = [];
  for (const regression of ["NORMAL", "HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"] as const) {
    const result = await evaluate(candidate.source, regression, "REGRESSION");
    if (result.value.verdict !== "NO_CHANGE" || result.value.reasonCode !== (regression === "NORMAL" ? "NORMAL" : "EXTERNAL_FAILURE") || result.value.greenVerified !== (regression === "NORMAL") || result.value.provenance.callCount !== 6) fail("REGRESSION");
    regressionReferences.push(result.reference);
  }
  return snapshot({ outcome: "REPAIRED", candidate, greenReference: green.reference, regressionReferences, candidateCount, evidence });
}
