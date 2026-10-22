import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";
import { types } from "node:util";
import { ControllerCheckpointStore } from "./controller";
import { LocalRsiLedger, type R4CatalogVersion, type R4LedgerExecution, type RsiLedgerCheckpoint } from "./ledger";
import { LocalFakeModelBroker, type FakeScenario } from "./model-broker";
import { retrieveApprovedMemory, type RsiApprovedSnapshot } from "./memory";
import { parseImprovementIntent, parseSourceArtifactReference, type R4ExecutionIntent, type R4ImprovementEvent, type R4SourceArtifactReference, type R4ValidationBinding } from "./execution-contracts";
import { AGENT_PATHS, compileAgentSources, createRepairRootGate, loadSeedAgentSources, measureFixedClosure, runActualAgentStep, runActualRepairCore,
  type AgentSources, type ActualRepairResult, type CompiledAgent, type FixedRepairClosure, type RepairRootGate } from "./repair-core";
import { parseBoundedJsonObject, SANDBOX_POLICY, SANDBOX_POLICY_DIGEST } from "./sandbox";

const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const jhash = (v: unknown) => hash(JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function fail(code: string): never { throw new Error(`RSI_PROMOTION_${code}`); }
function frozen<T>(v: T): T {
  const copy: T = structuredClone(v);
  function freeze(x: unknown) { if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); } }
  freeze(copy); return copy;
}
// Inspect before schema parsing, JSON serialization or property access. In
// particular, even a Proxy's introspection traps must never execute here.
function passive(value: unknown, limit = 262144): unknown {
  let nodes = 0; const ancestors = new Set<object>();
  function visit(v: unknown, depth: number): unknown {
    if (++nodes > 16384 || depth > 24) fail("INPUT");
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return v;
    if (!v || typeof v !== "object" || types.isProxy(v) || ancestors.has(v)) fail("INPUT");
    const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype)) fail("INPUT");
    ancestors.add(v); const descriptors = Object.getOwnPropertyDescriptors(v), out: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key) || array && !/^(0|[1-9][0-9]*)$/.test(key)) fail("INPUT");
      const d = descriptors[key]; if (!d.enumerable || !("value" in d)) fail("INPUT");
      out[key] = visit(d.value, depth + 1);
    }
    ancestors.delete(v);
    if (!array) return out;
    if (Object.keys(out).length !== descriptors.length.value) fail("INPUT");
    return Object.values(out);
  }
  const out = visit(value, 0); if (Buffer.byteLength(JSON.stringify(out)) > limit) fail("INPUT"); return out;
}
function exactObject(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || !same(Object.keys(v).sort(), [...keys].sort())) fail("INVALID_PROPOSAL");
  return v as Record<string, unknown>;
}
const require = createRequire(import.meta.url);
const parser = createRequire(require.resolve("@react-router/dev/package.json"))("@babel/parser") as { parse(source: string, options: Record<string, unknown>): { program: { body: Record<string, unknown>[] } } };
// Syntax inspection only. The default function is never imported/evaluated on
// the host; its actual input/output ABI is exercised by the fixed sandbox.
function checkAbi(agent: CompiledAgent) {
  const body = parser.parse(agent.source, { sourceType: "module" }).program.body;
  const functions = new Map<string, Record<string, unknown>>(); let target: Record<string, unknown> | undefined;
  for (const node of body) {
    if (node.type === "FunctionDeclaration") functions.set(String((node.id as { name?: string }).name), node);
    if (node.type === "VariableDeclaration") for (const d of node.declarations as { id: { name?: string }; init?: Record<string, unknown> }[]) {
      if (d.init && ["FunctionExpression", "ArrowFunctionExpression"].includes(String(d.init.type))) functions.set(String(d.id.name), d.init);
    }
  }
  for (const node of body) {
    if (node.type === "ExportDefaultDeclaration") { const d = node.declaration as Record<string, unknown>; target = d.type === "Identifier" ? functions.get(String(d.name)) : d; }
    if (node.type === "ExportNamedDeclaration") for (const s of node.specifiers as { exported: { name?: string }; local: { name?: string } }[]) {
      if (s.exported.name === "default") target = functions.get(String(s.local.name));
    }
  }
  if (!target || !["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(String(target.type)) || (target.params as unknown[]).length !== 1 || target.generator) fail("AGENT_ABI");
}
async function checkedModules(raw: unknown) {
  const modules = exactObject(passive(raw), AGENT_PATHS) as AgentSources;
  for (const path of AGENT_PATHS) if (typeof modules[path] !== "string" || Buffer.byteLength(modules[path]) < 1 || Buffer.byteLength(modules[path]) > 32000) fail("INVALID_PROPOSAL");
  const canonical = Object.fromEntries(AGENT_PATHS.map(path => [path, modules[path]])) as AgentSources;
  const agent = await compileAgentSources(canonical); checkAbi(agent); return frozen({ modules: canonical, agent });
}
/** Returns passive validated data, never proposal execution/promotion rights. */
export async function validateAgentProposal(raw: unknown, baseAgentHash: string) {
  const value = exactObject(passive(raw), ["schemaVersion", "action", "baseAgentHash", "modules"]);
  if (!/^[a-f0-9]{64}$/.test(baseAgentHash) || value.schemaVersion !== 1 || value.action !== "PROPOSE_AGENT" || value.baseAgentHash !== baseAgentHash) fail("INVALID_PROPOSAL");
  const checked = await checkedModules(value.modules);
  if (checked.agent.agentHash === baseAgentHash) fail("NO_AGENT_CHANGE"); return checked;
}

async function safeDirectory(path: string) {
  if (!isAbsolute(path) || path !== resolve(path)) fail("SOURCE_UNAVAILABLE");
  let cursor = parsePath(path).root;
  for (const part of path.slice(cursor.length).split("/").filter(Boolean)) {
    cursor = join(cursor, part); const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("SOURCE_UNAVAILABLE");
  }
  const stat = await lstat(path);
  if ((stat.mode & 0o777) !== 0o700 || typeof process.getuid === "function" && stat.uid !== process.getuid()) fail("SOURCE_UNAVAILABLE");
  return stat;
}
async function syncDirectory(path: string) { const h = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await h.sync(); } finally { await h.close(); } }
function equalFile(a: Stats, b: Stats) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mode === b.mode && a.nlink === b.nlink && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
interface StoreIdentity { dev: number; ino: number }
const stores = new WeakMap<ImmutableAgentSourceStore, StoreIdentity>();
async function assertStore(store: ImmutableAgentSourceStore) {
  const expected = stores.get(store), stat = await safeDirectory(store.directory);
  if (!expected || stat.dev !== expected.dev || stat.ino !== expected.ino) fail("SOURCE_UNAVAILABLE");
}
async function syncStoreDirectory(store: ImmutableAgentSourceStore) {
  await assertStore(store);
  const identity = stores.get(store)!, handle = await open(store.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isDirectory() || before.dev !== identity.dev || before.ino !== identity.ino || (before.mode & 0o777) !== 0o700
      || typeof process.getuid === "function" && before.uid !== process.getuid()) fail("SOURCE_UNAVAILABLE");
    await handle.sync();
    const after = await handle.stat(); await assertStore(store);
    if (after.dev !== before.dev || after.ino !== before.ino || after.mode !== before.mode || after.uid !== before.uid) fail("SOURCE_UNAVAILABLE");
  } finally { await handle.close(); }
}
async function readBlob(store: ImmutableAgentSourceStore, digest: string, kind: "source" | "evidence", length?: number, durable = false) {
  if (!/^[a-f0-9]{64}$/.test(digest)) fail("SOURCE_UNAVAILABLE");
  await assertStore(store); const path = join(store.directory, `${digest}.${kind}.json`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o777) !== 0o400 || before.size < 1 || before.size > 262144 || length !== undefined && before.size !== length
      || typeof process.getuid === "function" && before.uid !== process.getuid()) fail("SOURCE_UNAVAILABLE");
    const bytes = await handle.readFile(), after = await handle.stat(), entry = await lstat(path);
    await assertStore(store);
    if (!equalFile(before, after) || !equalFile(after, entry) || bytes.length !== before.size || hash(bytes) !== digest) fail("SOURCE_UNAVAILABLE");
    const text = bytes.toString("utf8"), value = passive(JSON.parse(text));
    if (JSON.stringify(value) !== text) fail("SOURCE_UNAVAILABLE");
    if (durable) {
      // EEXIST may be a complete write whose earlier fsync failed. Exact bytes
      // alone do not establish durability. Sync this verified descriptor and
      // the verified store directory, then recheck both identities before use.
      await handle.sync(); await syncStoreDirectory(store);
      const synced = await handle.stat(), current = await lstat(path); await assertStore(store);
      if (!equalFile(after, synced) || !equalFile(synced, current)) fail("SOURCE_UNAVAILABLE");
    }
    return value;
  } finally { await handle.close(); }
}
async function writeBlob(store: ImmutableAgentSourceStore, value: unknown, kind: "source" | "evidence") {
  const bytes = Buffer.from(JSON.stringify(passive(value))), digest = hash(bytes);
  await assertStore(store); const path = join(store.directory, `${digest}.${kind}.json`);
  let handle;
  try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (handle) { try { await handle.writeFile(bytes); } finally { await handle.close(); } }
  // New and pre-existing blobs have the same verified file+directory fsync
  // boundary. Damaged/partial blobs fail validation and are never overwritten.
  if (!same(await readBlob(store, digest, kind, bytes.length, true), value)) fail("SOURCE_UNAVAILABLE");
  return { digest, length: bytes.length };
}
/** Content-addressed data only. No file path, import capability or verdict is
 * accepted from an agent. Partial/replaced/missing blobs are never repaired. */
export class ImmutableAgentSourceStore {
  private constructor(readonly directory: string, identity: StoreIdentity) { stores.set(this, identity); Object.freeze(this); }
  static async create(directory: string) {
    try {
      if (!isAbsolute(directory) || resolve(directory) !== directory) fail("SOURCE_UNAVAILABLE");
      await safeDirectory(dirname(directory)); await mkdir(directory, { mode: 0o700 }); await syncDirectory(dirname(directory));
      return ImmutableAgentSourceStore.open(directory);
    } catch { return fail("SOURCE_UNAVAILABLE"); }
  }
  static async open(directory: string) { try { const stat = await safeDirectory(directory); return new ImmutableAgentSourceStore(directory, { dev: stat.dev, ino: stat.ino }); } catch { return fail("SOURCE_UNAVAILABLE"); } }
  async put(raw: unknown): Promise<R4SourceArtifactReference> {
    try {
      await assertStore(this); const { modules, agent } = await checkedModules(raw);
      const blob = await writeBlob(this, { schemaVersion: 1, modules }, "source");
      const ref = parseSourceArtifactReference({ schemaVersion: 1, modules: Object.fromEntries(AGENT_PATHS.map(path => [path, { digest: agent.moduleDigests[path], byteLength: Buffer.byteLength(modules[path]) }])),
        agentHash: agent.agentHash, compiledDigest: agent.compiledDigest, compiledByteLength: Buffer.byteLength(agent.source), artifactDigest: blob.digest, artifactByteLength: blob.length });
      await this.read(ref); return frozen(ref);
    } catch { return fail("SOURCE_UNAVAILABLE"); }
  }
  async read(reference: unknown) {
    try {
      const ref = parseSourceArtifactReference(reference), value = exactObject(await readBlob(this, ref.artifactDigest, "source", ref.artifactByteLength), ["schemaVersion", "modules"]);
      if (value.schemaVersion !== 1) fail("SOURCE_UNAVAILABLE");
      const checked = await checkedModules(value.modules);
      if (checked.agent.agentHash !== ref.agentHash || checked.agent.compiledDigest !== ref.compiledDigest || Buffer.byteLength(checked.agent.source) !== ref.compiledByteLength
        || AGENT_PATHS.some(path => checked.agent.moduleDigests[path] !== ref.modules[path].digest || Buffer.byteLength(checked.modules[path]) !== ref.modules[path].byteLength)) fail("SOURCE_UNAVAILABLE");
      return checked;
    } catch { return fail("SOURCE_UNAVAILABLE"); }
  }
}

export interface LabAccessOptions {
  ledger: LocalRsiLedger; checkpointStore: ControllerCheckpointStore; sourceStore: ImmutableAgentSourceStore;
  rootTiming: { startedMs: number; deadlineMs: number }; killSwitch: () => boolean; monotonicMs?: () => number; nowUtc?: () => string;
}
function rootGate(options: LabAccessOptions) { return createRepairRootGate({ rootTiming: options.rootTiming, killSwitch: options.killSwitch, monotonicMs: options.monotonicMs ?? (() => performance.now()) }); }
async function checkpoint(options: LabAccessOptions) { try { await options.checkpointStore.assertCurrent(options.ledger.checkpoint); } catch { fail("ACCOUNTING_UNCERTAIN"); } }
async function persist(options: LabAccessOptions) { try { await options.checkpointStore.persist(options.ledger.checkpoint); await checkpoint(options); } catch { fail("ACCOUNTING_UNCERTAIN"); } }
async function activeAgent(options: LabAccessOptions, gate: RepairRootGate) {
  gate.check(); await checkpoint(options); gate.check();
  const state = await options.ledger.readImprovement(); gate.check(); const catalog = state.catalog.at(-1);
  if (!catalog) fail("CATALOG_STALE");
  const source = parseSourceArtifactReference(catalog.source), checked = await options.sourceStore.read(source); gate.check();
  if (catalog.binding) await historicalValidation(options.sourceStore, catalog.binding, source);
  gate.check(); await checkpoint(options); gate.check(); return frozen({ catalog, source, ...checked });
}
/** Trusted main seed is loaded from fixed tracked paths, never caller source. */
export async function initializeLabCatalog(options: LabAccessOptions) {
  const gate = rootGate(options); gate.check(); await checkpoint(options); gate.check();
  const state = await options.ledger.readImprovement(); gate.check(); if (state.catalog.length || state.executions.length) fail("CATALOG_STALE");
  const modules = await loadSeedAgentSources(); gate.check(); const source = await options.sourceStore.put(modules); gate.check();
  await options.sourceStore.read(source); gate.check(); await checkpoint(options); gate.check();
  await options.ledger.commitLabCatalog({ kind: "SEED", expectedCatalogRevision: -1, expectedCatalogHash: null, source }, (options.nowUtc ?? (() => new Date().toISOString()))());
  const catalog = (await options.ledger.readImprovement()).catalog.at(-1)!;
  await persist(options); // Durable publication wins over a later stop.
  return frozen({ catalog, source });
}
/** A reference is read/compiled again; it grants no generation/promotion rights. */
export async function loadLabActiveAgent(options: LabAccessOptions) { return activeAgent(options, rootGate(options)); }

export interface R4FakeFixture {
  schemaVersion: 1; mode: "LOCAL_FAKE";
  generations: { "1": FakeScenario[]; "2": FakeScenario[] };
}
function checkedFixture(raw: unknown): R4FakeFixture {
  const fixture = exactObject(passive(raw), ["schemaVersion", "mode", "generations"]);
  if (fixture.schemaVersion !== 1 || fixture.mode !== "LOCAL_FAKE") fail("FIXTURE_CUSTODY");
  const generations = exactObject(fixture.generations, ["1", "2"]);
  for (const generation of ["1", "2"]) {
    const scenarios = generations[generation];
    if (!Array.isArray(scenarios) || scenarios.length > 8) fail("FIXTURE_CUSTODY");
    for (const scenario of scenarios) {
      if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) fail("FIXTURE_CUSTODY");
      const keys = ["kind", ...(Object.hasOwn(scenario, "delayMs") ? ["delayMs"] : []), ...(scenario.kind === "JSON_RESPONSE" ? ["response"] : [])];
      exactObject(scenario, keys);
      if (!["SUCCESS", "INVALID_JSON", "INVALID_USAGE", "FAILURE", "LOST_RESPONSE", "OVERSIZED_OUTPUT", "FORGED_USAGE", "JSON_RESPONSE"].includes(scenario.kind)
        || Object.hasOwn(scenario, "delayMs") && (!Number.isSafeInteger(scenario.delayMs) || scenario.delayMs < 0 || scenario.delayMs > 60000)) fail("FIXTURE_CUSTODY");
      if (scenario.kind === "JSON_RESPONSE" && Buffer.byteLength(JSON.stringify(parseBoundedJsonObject(scenario.response))) > 2000) fail("FIXTURE_CUSTODY");
    }
  }
  return frozen(fixture as unknown as R4FakeFixture);
}
/** Trusted supervisor extracts exactly this generation's broker scenarios. The
 * corpus (including future replies) is never delivered to candidate publicInput. */
export function labGenerationScenarios(fixture: unknown, generation: 1 | 2): FakeScenario[] {
  if (generation !== 1 && generation !== 2) fail("FIXTURE_CUSTODY");
  return checkedFixture(fixture).generations[generation];
}
function fixtureOutputDigest(scenario: FakeScenario | undefined) {
  const kind = scenario?.kind ?? "SUCCESS";
  const text = kind === "JSON_RESPONSE" ? JSON.stringify(parseBoundedJsonObject((scenario as Extract<FakeScenario, { kind: "JSON_RESPONSE" }>).response))
    : kind === "FORGED_USAGE" ? '{"usage":{"inputTokens":0,"outputTokens":0},"chargedUnits":0}'
    : kind === "SUCCESS" ? '{"action":"NO_CHANGE","reason":"LOCAL_FAKE"}' : fail("FIXTURE_CUSTODY");
  // Preserve the broker convention: hash JSON.stringify(raw model text), not
  // raw text bytes or the actual agent's transformed canonical output bytes.
  return jhash(text);
}

export interface LabPromotionOptions extends LabAccessOptions {
  broker: LocalFakeModelBroker; intent: unknown; baseSource: string; fakeFixture: unknown;
  memory: { snapshot: RsiApprovedSnapshot; approvals: unknown };
}
export interface LabMemoryEvidence {
  readonly snapshotHash: string; readonly retrieval: ReturnType<typeof retrieveApprovedMemory>;
  readonly deliveredLessonIds: readonly string[]; readonly usage: "UNCONFIRMED";
  readonly usageReasonCode: "SELECTION_AND_DELIVERY_DO_NOT_PROVE_USE";
}
declare const generatedProposalBrand: unique symbol;
export interface GeneratedAgentProposal {
  readonly [generatedProposalBrand]: true;
  readonly source: R4SourceArtifactReference; readonly generationEvidenceDigest: string;
}
interface ProposalAuthority { session: LabPromotionSession; source: R4SourceArtifactReference; generationEvidenceDigest: string; consumed: boolean }
const proposals = new WeakMap<object, ProposalAuthority>();
const claimedBrokers = new WeakSet<LocalFakeModelBroker>();
const claimedExecutions = new WeakMap<LocalRsiLedger, Set<string>>();
type FailureReason = Extract<R4ImprovementEvent, { kind: "REJECTED" | "BLOCKED" | "INCONCLUSIVE" }>["reasonCode"];
function failureReason(error: unknown): FailureReason {
  const message = error instanceof Error ? error.message : "";
  if (/ACCOUNTING|CHECKPOINT/.test(message)) return "ACCOUNTING_UNCERTAIN";
  if (/OPERATOR_STOP|KILLED/.test(message)) return "OPERATOR_STOP";
  if (/DEADLINE|TIMEOUT|CLOCK/.test(message)) return "DEADLINE_EXPIRED";
  if (/SOURCE/.test(message)) return "SOURCE_UNAVAILABLE";
  if (/PROPOSAL|AGENT_ABI|AGENT_CLOSURE/.test(message)) return "INVALID_PROPOSAL";
  if (/NO_AGENT_CHANGE/.test(message)) return "NO_AGENT_CHANGE";
  if (/CATALOG/.test(message)) return "CATALOG_STALE";
  return "EVIDENCE_UNKNOWN";
}
interface ValidationDocument {
  schemaVersion: 1; kind: "ACTUAL_REPAIR_VALIDATION"; phase: "BASELINE_REPAIR" | "PROMOTION_REPAIR";
  executionId: string; source: R4SourceArtifactReference; context: Omit<R4ValidationBinding, "evidenceDigest">;
  baseSourceDigest: string; repairedSourceDigest: string; evidence: ActualRepairResult["evidence"]; memory: LabMemoryEvidence;
}
function context(intent: R4ExecutionIntent) { return { controllerHash: intent.controllerHash, evaluatorHash: intent.evaluatorHash, memorySnapshotHash: intent.memorySnapshotHash, policyDigest: intent.policyDigest, fakeFixtureDigest: intent.fakeFixtureDigest }; }
async function historicalValidation(store: ImmutableAgentSourceStore, binding: R4ValidationBinding, source: R4SourceArtifactReference) {
  try {
    const doc = await readBlob(store, binding.evidenceDigest, "evidence") as unknown as ValidationDocument;
    const { evidenceDigest: _digest, ...expected } = binding;
    if (doc.schemaVersion !== 1 || doc.kind !== "ACTUAL_REPAIR_VALIDATION" || !["BASELINE_REPAIR", "PROMOTION_REPAIR"].includes(doc.phase) || !same(doc.source, source)
      || !same(doc.context, expected) || doc.memory.snapshotHash !== binding.memorySnapshotHash || doc.memory.usage !== "UNCONFIRMED") fail("EVIDENCE_UNKNOWN");
    return doc;
  } catch { return fail("EVIDENCE_UNKNOWN"); }
}
/** One already-reserved broker, one root deadline, one K, one complete proposal.
 * Only this module's direct actual-agent return can mint its opaque authority.
 * All dependency objects are trusted supervisor wiring, never candidate IPC. */
export class LabPromotionSession {
  private busy = false; private terminal = false; private prepared = false; private generated = false; private sequence = 0; private finishAttempted = false;
  private active!: Awaited<ReturnType<typeof activeAgent>>; private closure!: FixedRepairClosure; private memoryEvidence!: LabMemoryEvidence;
  private lessons: { lessonId: string; policy: string }[] = [];
  private scenarios: FakeScenario[] = [];
  private constructor(private readonly options: LabPromotionOptions, readonly intent: R4ExecutionIntent, private readonly gate: RepairRootGate) {}
  static async open(options: LabPromotionOptions) {
    const intent = parseImprovementIntent(options.intent);
    if (!(options.broker instanceof LocalFakeModelBroker) || !(options.ledger instanceof LocalRsiLedger) || !(options.checkpointStore instanceof ControllerCheckpointStore) || !stores.has(options.sourceStore)) fail("INPUT");
    const claimed = claimedExecutions.get(options.ledger) ?? new Set<string>();
    if (claimedBrokers.has(options.broker) || claimed.has(intent.executionId)) fail("EXECUTION_ALREADY_CLAIMED");
    claimed.add(intent.executionId); claimedExecutions.set(options.ledger, claimed); claimedBrokers.add(options.broker);
    const session = new LabPromotionSession({ ...options, baseSource: options.baseSource }, frozen(intent), rootGate(options));
    try {
      session.gate.check();
      const fixture = checkedFixture(options.fakeFixture);
      session.scenarios = labGenerationScenarios(fixture, intent.generation);
      if (typeof options.baseSource !== "string" || Buffer.byteLength(options.baseSource) > 65536 || jhash(fixture) !== intent.fakeFixtureDigest) fail("INPUT");
      session.active = await activeAgent(options, session.gate);
      if (session.active.catalog.revision !== intent.expectedCatalogRevision || session.active.catalog.hash !== intent.expectedCatalogHash || session.active.source.agentHash !== intent.activeAgentHash
        || session.active.source.compiledDigest !== intent.activeCompiledDigest || session.active.source.artifactDigest !== intent.activeSourceArtifactDigest) fail("CATALOG_STALE");
      const run = await session.readRun(); if (run.status !== "RESERVED" || run.events.length || run.calls.length || run.settlement) fail("EXECUTION_ALREADY_STARTED");
      session.closure = await session.measureClosure();
      const memory = passive(options.memory) as unknown as LabPromotionOptions["memory"];
      const code = intent.observation.incident.errorCode;
      const retrieval = retrieveApprovedMemory(memory.snapshot, { expectedHash: intent.memorySnapshotHash, approvals: memory.approvals, nowUtc: session.now(), query: {
        errorCode: code === "NONE" ? "UNKNOWN" : code, runtime: "WORKER_SYNTHETIC", conditions: [code === "REDIRECT_MISMATCH" ? "REDIRECT_FAILURE" : code === "NETWORK_TIMEOUT" ? "TIMEOUT" : code === "HTTP_STATUS" ? "STATUS_FAILURE" : "UNKNOWN_EVIDENCE"],
      } });
      session.lessons = memory.snapshot.lessons.filter(l => retrieval.selectedLessonIds.includes(l.lessonId)).map(l => ({ lessonId: l.lessonId, policy: l.policy }));
      session.memoryEvidence = frozen({ snapshotHash: retrieval.snapshotHash, retrieval, deliveredLessonIds: session.lessons.map(l => l.lessonId), usage: "UNCONFIRMED", usageReasonCode: "SELECTION_AND_DELIVERY_DO_NOT_PROVE_USE" });
      session.gate.check(); return session;
    } catch (error) { return session.abort(error); }
  }
  private now() { return (this.options.nowUtc ?? (() => new Date().toISOString()))(); }
  private async readRun() {
    await checkpoint(this.options); this.gate.check(); const state = await this.options.ledger.readImprovement(); this.gate.check();
    const run = state.executions.find(r => r.intent.executionId === this.intent.executionId);
    if (!run || !same(run.intent, this.intent)) fail("ACCOUNTING_UNCERTAIN"); return run;
  }
  private async measureClosure() {
    const closure = await measureFixedClosure("R4"); this.gate.check();
    if (closure.controller.scope !== "LOCAL_SYNTHETIC_R4_SELF_IMPROVE" || closure.controllerHash !== this.intent.controllerHash || closure.evaluatorHash !== this.intent.evaluatorHash) fail("CLOSURE_UNVERIFIED");
    return closure;
  }
  private async event(event: R4ImprovementEvent) {
    this.gate.check(); await checkpoint(this.options); this.gate.check();
    await this.options.ledger.recordImprovementEvent({ executionId: this.intent.executionId, event }, this.now()); await persist(this.options); this.gate.check();
  }
  private phase(phase: "BASELINE_REPAIR" | "GENERATE_AGENT" | "PROMOTION_REPAIR") { return LocalFakeModelBroker.prototype.phase.call(this.options.broker, phase); }
  private verifyCall(run: R4LedgerExecution, metadata: Record<string, unknown>, phase: string, sequence: number) {
    const call = run.calls.find(c => c.sequence === sequence);
    if (metadata.mode !== "LOCAL_FAKE" || metadata.sequence !== sequence || !call || call.phase !== phase || call.callId !== metadata.callId || call.requestDigest !== metadata.requestDigest
      || call.outcome?.kind !== "CALL_RETURNED" || call.outcome.receiptDigest !== metadata.receiptDigest || call.outcome.outputDigest !== metadata.outputDigest) fail("GENERATION_CUSTODY");
    if (call.outcome.outputDigest !== fixtureOutputDigest(this.scenarios[sequence - 1])) fail("FIXTURE_CUSTODY");
    return call;
  }
  private async repair(agent: CompiledAgent, source: R4SourceArtifactReference, phase: "BASELINE_REPAIR" | "PROMOTION_REPAIR") {
    const purpose = phase === "BASELINE_REPAIR" ? "R4_BASELINE_REPAIR" : "R4_PROMOTION_REPAIR";
    const before = this.sequence;
    const result = await runActualRepairCore({ agent, closure: this.closure, rootGate: this.gate, request: { purpose, capability: this.phase(phase), nextSequence: () => ++this.sequence },
      observation: this.intent.observation, baseSource: this.options.baseSource, lessons: this.lessons }); this.gate.check();
    if (result.outcome !== "REPAIRED" || result.candidateCount !== 1 || result.regressionReferences.length !== 4 || this.sequence !== before + 2) fail("PROBE_FAILED");
    const run = await this.readRun(), agentRows = result.evidence.filter(e => e.custody === "ACTUAL_AGENT_CONTAINER");
    if (agentRows.length !== 2) fail("GENERATION_CUSTODY");
    for (const [index, row] of agentRows.entries()) {
      const d = row.detail as Record<string, unknown>;
      if (d.transportKind !== "DOCKER_CLI" || d.activeAgentHash !== source.agentHash || d.sourceDigest !== source.compiledDigest || d.policyDigest !== SANDBOX_POLICY_DIGEST) fail("GENERATION_CUSTODY");
      this.verifyCall(run, d.brokerMetadata as Record<string, unknown>, phase, before + index + 1);
    }
    const native = result.evidence.filter(e => ["RED_TEST", "GREEN_TEST", "REGRESSION"].includes(e.reference.kind));
    if (native.length !== 6) fail("PROBE_FAILED");
    const fixtures = ["NATIVE_RECEIVER", "NATIVE_RECEIVER", "NORMAL", "HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"];
    for (const [index, row] of native.entries()) {
      const p = (row.detail as { provenance: Record<string, unknown> }).provenance;
      const logs = p.logs as { valid?: boolean; warningCount?: number; rejectedCount?: number; forbiddenMarkerCount?: number; custody?: { stdoutEof?: boolean; stderrEof?: boolean; errorCount?: number; prematureCloseCount?: number } };
      if (row.custody !== "ACTUAL_NATIVE" || row.reference.verdict !== (index === 0 ? "FAIL" : "PASS") || p.transportKind !== "DOCKER_CLI" || p.fixture !== fixtures[index]
        || p.sourceDigest !== (index === 0 ? hash(this.options.baseSource) : result.candidate.sourceDigest) || p.manifestDigest !== this.closure.evaluator.manifestDigest
        || p.callCount !== (index === 0 ? 0 : 6) || p.childSpawns !== 1 || p.dispatchAttempts !== 1 || p.deadlineExpired !== false || p.cleanupConfirmed !== true || p.disposalConfirmed !== true
        || !logs?.valid || logs.warningCount !== 1 || logs.rejectedCount !== 0 || logs.forbiddenMarkerCount !== 0 || !logs.custody?.stdoutEof || !logs.custody.stderrEof || logs.custody.errorCount !== 0 || logs.custody.prematureCloseCount !== 0) fail("PROBE_FAILED");
    }
    const document: ValidationDocument = { schemaVersion: 1, kind: "ACTUAL_REPAIR_VALIDATION", phase, executionId: this.intent.executionId, source,
      context: context(this.intent), baseSourceDigest: hash(this.options.baseSource), repairedSourceDigest: result.candidate.sourceDigest, evidence: result.evidence, memory: this.memoryEvidence };
    const stored = await writeBlob(this.options.sourceStore, document, "evidence"); this.gate.check();
    return frozen({ evidenceDigest: stored.digest, ...context(this.intent) });
  }
  private async prepare() {
    if (this.prepared) return;
    if (this.intent.generation === 1) { const binding = await this.repair(this.active.agent, this.active.source, "BASELINE_REPAIR"); await this.event({ kind: "BASELINE_VALIDATED", binding }); }
    await this.event({ kind: "GENERATING" }); this.prepared = true;
  }
  async generateProposal(): Promise<GeneratedAgentProposal> {
    if (this.busy || this.terminal || this.generated) fail("PROPOSAL_LIMIT"); this.busy = true;
    try {
      this.gate.check(); await this.prepare();
      const active = await activeAgent(this.options, this.gate);
      if (!same(active.source, this.active.source) || active.catalog.hash !== this.intent.expectedCatalogHash) fail("CATALOG_STALE");
      await this.measureClosure();
      const returned = await runActualAgentStep({ agent: active.agent, rootGate: this.gate, capability: this.phase("GENERATE_AGENT"), sequence: ++this.sequence, taskKind: "improve-agent",
        publicInput: { phase: "PROPOSE_AGENT", schemaVersion: 1, baseAgentHash: active.source.agentHash, modules: active.modules, observation: this.intent.observation, lessons: this.lessons,
          allowedModules: [...AGENT_PATHS], proposalLimit: 1 } }); this.gate.check();
      const run = await this.readRun();
      this.verifyCall(run, returned.brokerMetadata as Record<string, unknown>, "GENERATE_AGENT", this.sequence);
      if (returned.activeAgentHash !== active.source.agentHash || returned.evidence.transportKind !== "DOCKER_CLI" || returned.evidence.sourceDigest !== active.source.compiledDigest
        || returned.evidence.imageDigest !== SANDBOX_POLICY.image || returned.evidence.runtime !== `${SANDBOX_POLICY.nodeVersion} linux arm64` || returned.evidence.policyDigest !== SANDBOX_POLICY_DIGEST
        || returned.evidence.inputDigest !== returned.actualInputDigest || returned.evidence.outputDigest !== returned.actualOutputDigest || returned.actualOutputDigest !== jhash({ schemaVersion: 1, output: returned.untrustedOutput })) fail("GENERATION_CUSTODY");
      const output = passive(returned.untrustedOutput) as Record<string, unknown>;
      if (output && typeof output === "object" && !Array.isArray(output) && same(Object.keys(output).sort(), ["action", "reason"]) && output.action === "NO_CHANGE"
        && typeof output.reason === "string" && output.reason.length > 0 && output.reason.length <= 128) fail("NO_AGENT_CHANGE");
      const checked = await validateAgentProposal(output, active.source.agentHash); this.gate.check();
      this.generated = true; // First complete proposal closes generation exploration.
      const source = await this.options.sourceStore.put(checked.modules); this.gate.check();
      await this.options.sourceStore.read(source); this.gate.check();
      if (source.agentHash !== checked.agent.agentHash || source.compiledDigest !== checked.agent.compiledDigest) fail("GENERATION_CUSTODY");
      const generationEvidence = await writeBlob(this.options.sourceStore, { schemaVersion: 1, kind: "ACTUAL_AGENT_GENERATION", executionId: this.intent.executionId, activeSource: active.source, source,
        context: context(this.intent), actualInputDigest: returned.actualInputDigest, actualOutputDigest: returned.actualOutputDigest, evidence: returned.evidence, brokerMetadata: returned.brokerMetadata, memory: this.memoryEvidence }, "evidence"); this.gate.check();
      const metadata = returned.brokerMetadata;
      await this.event({ kind: "PROPOSED", source, generationBinding: { executionId: this.intent.executionId, activeAgentHash: active.source.agentHash, activeCompiledDigest: active.source.compiledDigest,
        sequence: this.sequence, callId: metadata.callId, brokerRequestDigest: metadata.requestDigest!, brokerReceiptDigest: metadata.receiptDigest, brokerOutputDigest: metadata.outputDigest!,
        actualInputDigest: returned.actualInputDigest, actualOutputDigest: returned.actualOutputDigest, generationEvidenceDigest: generationEvidence.digest } });
      const token = frozen({ source, generationEvidenceDigest: generationEvidence.digest }) as GeneratedAgentProposal;
      proposals.set(token, { session: this, source, generationEvidenceDigest: generationEvidence.digest, consumed: false }); return token;
    } catch (error) { return this.abort(error); } finally { this.busy = false; }
  }
  async promote(proposal: GeneratedAgentProposal) {
    const authority = proposal && typeof proposal === "object" ? proposals.get(proposal) : undefined;
    if (!authority || authority.session !== this || authority.consumed) fail("PROPOSAL_AUTHORITY");
    if (this.busy || this.terminal) fail("CLOSED"); this.busy = true; authority.consumed = true;
    try {
      this.gate.check(); const candidate = await this.options.sourceStore.read(authority.source); this.gate.check();
      const run = await this.readRun();
      if (run.status !== "PROPOSED" || !run.proposal || !same(run.proposal.source, authority.source) || run.proposal.generationBinding.generationEvidenceDigest !== authority.generationEvidenceDigest) fail("PROPOSAL_AUTHORITY");
      const generation = await readBlob(this.options.sourceStore, authority.generationEvidenceDigest, "evidence") as Record<string, unknown>; this.gate.check();
      if (generation.kind !== "ACTUAL_AGENT_GENERATION" || generation.executionId !== this.intent.executionId || !same(generation.source, authority.source) || !same(generation.activeSource, this.active.source) || !same(generation.context, context(this.intent))) fail("GENERATION_CUSTODY");
      await this.measureClosure(); await this.event({ kind: "PROBING" });
      const binding = await this.repair(candidate.agent, authority.source, "PROMOTION_REPAIR");
      await this.event({ kind: "VALIDATED", binding });
      this.finishAttempted = true;
      const settlement = await LocalFakeModelBroker.prototype.finish.call(this.options.broker); this.gate.check();
      await checkpoint(this.options); this.gate.check();
      const settled = await this.readRun();
      if (settled.status !== "VALIDATED" || settled.settlement?.kind !== "CONFIRMED" || settled.settlement.receiptDigest !== settlement.receiptDigest || settled.settlement.chargedUnits !== settlement.chargedUnits
        || settled.calls.length !== settlement.callCount || !same(settled.validation, binding)) fail("ACCOUNTING_UNCERTAIN");
      await this.options.sourceStore.read(authority.source); this.gate.check(); await historicalValidation(this.options.sourceStore, binding, authority.source); this.gate.check();
      await this.measureClosure();
      const current = await activeAgent(this.options, this.gate);
      if (current.catalog.revision !== this.intent.expectedCatalogRevision || current.catalog.hash !== this.intent.expectedCatalogHash || !same(current.source, this.active.source)) fail("CATALOG_STALE");
      await checkpoint(this.options); this.gate.check(); // Final time/kill/CAS/source/closure gate before append.
      await this.options.ledger.commitLabCatalog({ kind: "PROMOTE", executionId: this.intent.executionId, expectedCatalogRevision: current.catalog.revision, expectedCatalogHash: current.catalog.hash,
        source: authority.source, binding, settlementDigest: settlement.receiptDigest }, this.now());
      const catalog = (await this.options.ledger.readImprovement()).catalog.at(-1)!;
      await persist(this.options);
      this.terminal = true; // No gate after both durable writes: late stop applies to the next action.
      return frozen({ status: "PROMOTED" as const, active: { catalog, source: authority.source }, checkpoint: this.options.ledger.checkpoint, settlement, memoryEvidence: this.memoryEvidence });
    } catch (error) { return this.abort(error); } finally { this.busy = false; }
  }
  private async abort(error: unknown): Promise<never> {
    this.terminal = true; let uncertain = failureReason(error) === "ACCOUNTING_UNCERTAIN";
    // Finish is never retried after an uncertain append. No fresh reservation,
    // replay, replacement broker, seed fallback or cost deletion occurs here.
    if (!this.finishAttempted) {
      this.finishAttempted = true;
      try { await LocalFakeModelBroker.prototype.finish.call(this.options.broker); } catch { uncertain = true; }
    }
    try {
      await checkpoint(this.options);
      const run = (await this.options.ledger.readImprovement()).executions.find(r => r.intent.executionId === this.intent.executionId);
      if (!run || run.status === "PROMOTED") uncertain = true;
      else if (!["REJECTED", "BLOCKED", "INCONCLUSIVE"].includes(run.status) && !run.calls.some(c => !c.outcome)) {
        const reasonCode = uncertain ? "ACCOUNTING_UNCERTAIN" : failureReason(error);
        await this.options.ledger.recordImprovementEvent({ executionId: this.intent.executionId, event: { kind: ["INVALID_PROPOSAL", "NO_AGENT_CHANGE"].includes(reasonCode) ? "REJECTED" : "BLOCKED", reasonCode } }, this.now());
        await persist(this.options);
      }
    } catch { uncertain = true; }
    if (uncertain) fail("ACCOUNTING_UNCERTAIN"); throw error;
  }
}

/** Restores only the immediate previous verified catalog source. Caller chooses
 * neither a hash nor source bytes. No new model call/reservation is possible. */
export async function rollbackLabCatalog(options: LabAccessOptions) {
  const gate = rootGate(options); gate.check(); await checkpoint(options); gate.check();
  const state = await options.ledger.readImprovement(); gate.check(); const current = state.catalog.at(-1);
  if (!current || current.previousVerifiedRevision === null || state.executions.some(r => !r.settlement)) fail("ROLLBACK_UNVERIFIED");
  const target = state.catalog.find(c => c.revision === current.previousVerifiedRevision);
  if (!target) fail("ROLLBACK_UNVERIFIED");
  const baseline = state.executions.find(r => r.intent.generation === 1 && r.intent.expectedCatalogHash === target.hash);
  const binding = target.binding ?? (target.kind === "SEED" ? baseline?.baseline : null);
  if (!binding) fail("ROLLBACK_UNVERIFIED");
  await options.sourceStore.read(target.source); gate.check(); await historicalValidation(options.sourceStore, binding, target.source); gate.check();
  const closure = await measureFixedClosure("R4"); gate.check();
  if (closure.controllerHash !== binding.controllerHash || closure.evaluatorHash !== binding.evaluatorHash) fail("CLOSURE_UNVERIFIED");
  await checkpoint(options); gate.check();
  await options.ledger.commitLabCatalog({ kind: "ROLLBACK", expectedCatalogRevision: current.revision, expectedCatalogHash: current.hash, targetCatalogRevision: target.revision, targetCatalogHash: target.hash, reasonCode: "FOLLOWUP_FAILED" }, (options.nowUtc ?? (() => new Date().toISOString()))());
  const catalog: R4CatalogVersion = (await options.ledger.readImprovement()).catalog.at(-1)!;
  await persist(options);
  return frozen({ status: "ROLLED_BACK" as const, active: { catalog, source: target.source }, checkpoint: options.ledger.checkpoint });
}
