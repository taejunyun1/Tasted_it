import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";
import { ControllerCheckpointStore } from "./controller";
import { deriveIncidentKey, deriveObservationFingerprint, parseObservation } from "./contracts";
import { R4_POLICY, R4_POLICY_DIGEST, parseImprovementIntent, type R4ExecutionIntent } from "./execution-contracts";
import { LocalRsiLedger, type R4CatalogVersion, type R4LedgerExecution, type RsiLedgerCheckpoint, type RsiLedgerConfig } from "./ledger";
import { LocalFakeModelBroker } from "./model-broker";
import { type RsiApprovedSnapshot } from "./memory";
import { ImmutableAgentSourceStore, LabPromotionSession, initializeLabCatalog, labGenerationScenarios, loadLabActiveAgent, rollbackLabCatalog, type R4FakeFixture } from "./promotion";
import { createRepairRootGate, measureFixedClosure, type FixedRepairClosure } from "./repair-core";
import { parseBoundedJsonObject } from "./sandbox";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bytesHash = (value: string) => createHash("sha256").update(value).digest("hex");
function frozen<T>(value: T): T { const result = structuredClone(value); const freeze = (v: unknown) => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } }; freeze(result); return result; }
function fail(code: SelfImprovementReason): never { throw new Error(`RSI_SELF_IMPROVE_${code}`); }
export type SelfImprovementReason = "TWO_GENERATIONS_PROMOTED" | "ROLLED_BACK" | "RESTART_FORBIDDEN" | "OPERATOR_STOP" | "DEADLINE_EXPIRED" | "BUDGET_UNAVAILABLE" | "SOURCE_UNAVAILABLE" | "CATALOG_STALE" | "INVALID_INPUT" | "ACCOUNTING_UNCERTAIN" | "RECEIPT_UNCERTAIN" | "GENERATION_FAILED";
interface StoragePaths { ledgerPath: string; checkpointPath: string; sourceDirectory: string; receiptDirectory: string }
export type SelfImprovementStorage = StoragePaths & ({ mode: "CREATE"; config: RsiLedgerConfig } | { mode: "OPEN"; trustedCheckpoint: RsiLedgerCheckpoint });
/** Trusted local operator inputs only. No provider, candidate executor, verdict,
 * generation number, source override, retry count or paid capability is accepted. */
export interface SelfImprovementOptions {
  storage: SelfImprovementStorage; observation: unknown; baseSource: string; fakeFixture: R4FakeFixture;
  memory: { snapshot: RsiApprovedSnapshot; approvals: unknown }; killSwitch: () => boolean;
  nowUtc?: () => string; monotonicMs?: () => number;
}
export interface SelfImprovementGeneration {
  readonly generation: 1 | 2; readonly executionId: string; readonly status: R4LedgerExecution["status"];
  readonly intentDigest: string; readonly activeAgentHash: string; readonly proposedAgentHash: string | null;
  readonly calls: number; readonly phaseCalls: Readonly<Record<"BASELINE_REPAIR" | "GENERATE_AGENT" | "PROMOTION_REPAIR", number>>;
  readonly settlement: R4LedgerExecution["settlement"];
}
export interface SelfImprovementResult {
  readonly schemaVersion: 1; readonly mode: "LOCAL_SYNTHETIC"; readonly actualRecovery: false;
  readonly status: "COMPLETED" | "BLOCKED" | "PARTIAL" | "ROLLED_BACK"; readonly reasonCode: SelfImprovementReason;
  readonly completedGenerations: number; readonly generations: readonly SelfImprovementGeneration[];
  // Only a successful ledger+external-checkpoint boundary is returned here.
  // lastPublished records a completed fact, not an assertion about an uncertain newer disk head.
  readonly checkpoint: RsiLedgerCheckpoint | null; readonly lastPublished: R4CatalogVersion | null;
  readonly receiptPaths: readonly string[]; readonly receiptUncertain: boolean;
}
function reason(error: unknown): SelfImprovementReason {
  const message = error instanceof Error ? error.message : "";
  if (/RESTART_FORBIDDEN/.test(message)) return "RESTART_FORBIDDEN";
  if (/RECEIPT/.test(message)) return "RECEIPT_UNCERTAIN";
  if (/ACCOUNTING|CHECKPOINT|STALE|PARTIAL|LOCK/.test(message) && !/CATALOG/.test(message)) return "ACCOUNTING_UNCERTAIN";
  if (/STOP|KILLED/.test(message)) return "OPERATOR_STOP";
  if (/CLOCK|DEADLINE|TIMEOUT/.test(message)) return "DEADLINE_EXPIRED";
  if (/BUDGET/.test(message)) return "BUDGET_UNAVAILABLE";
  if (/SOURCE/.test(message)) return "SOURCE_UNAVAILABLE";
  if (/CATALOG/.test(message)) return "CATALOG_STALE";
  if (/INPUT|CONTRACT|MEMORY|FIXTURE/.test(message)) return "INVALID_INPUT";
  return "GENERATION_FAILED";
}
// Receipts are bounded passive metadata, separate from immutable raw source
// artifacts. O_EXCL preserves previous attempts; no append/reset/rewrite API.
async function receiptDirectory(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path) fail("RECEIPT_UNCERTAIN");
  let cursor = parsePath(path).root;
  for (const part of path.slice(cursor.length).split("/").filter(Boolean)) {
    cursor = join(cursor, part); const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("RECEIPT_UNCERTAIN");
  }
  const stat = await lstat(path);
  if ((stat.mode & 0o777) !== 0o700 || typeof process.getuid === "function" && stat.uid !== process.getuid()) fail("RECEIPT_UNCERTAIN");
  return stat;
}
async function appendReceipt(directory: string, name: string, value: unknown) {
  try {
    const bytes = Buffer.from(JSON.stringify(value)); if (bytes.length > 65536) fail("RECEIPT_UNCERTAIN");
    const before = await receiptDirectory(directory), path = join(directory, name);
    const h = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
    try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
    const d = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { const stat = await d.stat(); if (stat.dev !== before.dev || stat.ino !== before.ino) fail("RECEIPT_UNCERTAIN"); await d.sync(); } finally { await d.close(); }
    const after = await receiptDirectory(directory); if (before.dev !== after.dev || before.ino !== after.ino) fail("RECEIPT_UNCERTAIN");
    return path;
  } catch { return fail("RECEIPT_UNCERTAIN"); }
}
function summary(run: R4LedgerExecution): SelfImprovementGeneration {
  return frozen({ generation: run.intent.generation, executionId: run.intent.executionId, status: run.status, intentDigest: hash(run.intent), activeAgentHash: run.intent.activeAgentHash,
    proposedAgentHash: run.proposal?.source.agentHash ?? null, calls: run.calls.length,
    phaseCalls: Object.fromEntries(["BASELINE_REPAIR", "GENERATE_AGENT", "PROMOTION_REPAIR"].map(p => [p, run.calls.filter(c => c.phase === p).length])) as Record<"BASELINE_REPAIR" | "GENERATE_AGENT" | "PROMOTION_REPAIR", number>, settlement: run.settlement });
}
function fixedInputs(options: SelfImprovementOptions) {
  const observation = parseObservation(parseBoundedJsonObject(options.observation));
  if (observation.incident.source !== "LOCAL_SYNTHETIC" || typeof options.baseSource !== "string" || Buffer.byteLength(options.baseSource) > 65536) fail("INVALID_INPUT");
  // The passive Task3 validator returns detached frozen arrays. Capture one
  // complete corpus before any reservation; future replies stay host-private.
  const fakeFixture: R4FakeFixture = { schemaVersion: 1, mode: "LOCAL_FAKE", generations: { "1": labGenerationScenarios(options.fakeFixture, 1), "2": labGenerationScenarios(options.fakeFixture, 2) } };
  const memory = parseBoundedJsonObject(options.memory) as unknown as SelfImprovementOptions["memory"];
  return frozen({ observation, baseSource: options.baseSource, fakeFixture, memory });
}
function timing(options: Pick<SelfImprovementOptions, "monotonicMs" | "killSwitch">) {
  const monotonicMs = options.monotonicMs ?? (() => performance.now()), startedMs = monotonicMs();
  const rootTiming = { startedMs, deadlineMs: startedMs + R4_POLICY.executionTimeoutMs };
  const gate = createRepairRootGate({ rootTiming, monotonicMs, killSwitch: options.killSwitch }); gate.check();
  return { rootTiming, monotonicMs, gate };
}
interface Progress { checkpoint: RsiLedgerCheckpoint | null; published: R4CatalogVersion | null; generations: SelfImprovementGeneration[]; receiptPaths: string[]; completed: number; receiptUncertain: boolean }
function result(progress: Progress, status: SelfImprovementResult["status"], reasonCode: SelfImprovementReason): SelfImprovementResult {
  return frozen({ schemaVersion: 1, mode: "LOCAL_SYNTHETIC", actualRecovery: false, status, reasonCode, completedGenerations: progress.completed,
    generations: progress.generations, checkpoint: progress.checkpoint, lastPublished: progress.published, receiptPaths: progress.receiptPaths, receiptUncertain: progress.receiptUncertain });
}
async function openStorage(storage: SelfImprovementStorage, root: ReturnType<typeof timing>, now: () => string, initialize: boolean) {
  const check = () => root.gate.check(); check();
  const ledger = storage.mode === "CREATE" && initialize ? await LocalRsiLedger.create(storage.ledgerPath, storage.config, now()) : await LocalRsiLedger.open(storage.ledgerPath, storage.mode === "OPEN" ? storage.trustedCheckpoint : fail("INVALID_INPUT")); check();
  const checkpointStore = storage.mode === "CREATE" && initialize ? await ControllerCheckpointStore.create(storage.checkpointPath, ledger.checkpoint) : await ControllerCheckpointStore.open(storage.checkpointPath, storage.mode === "OPEN" ? storage.trustedCheckpoint : fail("INVALID_INPUT")); check();
  const sourceStore = storage.mode === "CREATE" && initialize ? await ImmutableAgentSourceStore.create(storage.sourceDirectory) : await ImmutableAgentSourceStore.open(storage.sourceDirectory); check();
  if (storage.mode === "CREATE" && initialize) { await receiptDirectory(dirname(storage.receiptDirectory)); check(); await mkdir(storage.receiptDirectory, { mode: 0o700 });
    const parent = await open(dirname(storage.receiptDirectory), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await parent.sync(); } finally { await parent.close(); } check(); }
  await receiptDirectory(storage.receiptDirectory); check();
  return { ledger, checkpointStore, sourceStore };
}
/** A generation's broker/session/compiled source die with this scope. Only the
 * durable external checkpoint and bounded metadata leave it. */
async function generation(options: SelfImprovementOptions, storage: SelfImprovementStorage, generationNumber: 1 | 2, fixed: ReturnType<typeof fixedInputs>, progress: Progress, root: ReturnType<typeof timing>) {
  const now = options.nowUtc ?? (() => new Date().toISOString()), check = () => root.gate.check();
  const stores = await openStorage(storage, root, now, generationNumber === 1);
  const { ledger, checkpointStore, sourceStore } = stores;
  const access = { ...stores, rootTiming: root.rootTiming, monotonicMs: root.monotonicMs, nowUtc: now, killSwitch: options.killSwitch };
  await checkpointStore.assertCurrent(ledger.checkpoint); check(); progress.checkpoint = ledger.checkpoint;
  let state = await ledger.readImprovement(); check();
  if (generationNumber === 1 && state.executions.length) fail("RESTART_FORBIDDEN");
  if (generationNumber === 1 && !state.catalog.length) { await initializeLabCatalog(access); progress.checkpoint = ledger.checkpoint; check(); }
  state = await ledger.readImprovement(); check();
  const active = await loadLabActiveAgent(access); check();
  const parent = state.executions[0];
  if (generationNumber === 2 && (state.executions.length !== 1 || parent.intent.generation !== 1 || parent.status !== "PROMOTED" || parent.settlement?.kind !== "CONFIRMED"
    || active.catalog.kind !== "PROMOTE" || active.catalog.executionId !== parent.intent.executionId || active.source.artifactDigest !== parent.proposal?.source.artifactDigest)) fail("CATALOG_STALE");
  const config = (await ledger.read()).config; check();
  const closure = await measureFixedClosure("R4"); check();
  const intent = parseImprovementIntent({ schemaVersion: 1, purpose: "R4_SELF_IMPROVE", executionId: randomUUID(), requestId: randomUUID(), campaignId: config.campaignId,
    generation: generationNumber, parentExecutionId: generationNumber === 1 ? null : parent.intent.executionId,
    expectedCatalogRevision: active.catalog.revision, expectedCatalogHash: active.catalog.hash, activeAgentHash: active.source.agentHash, activeCompiledDigest: active.source.compiledDigest, activeSourceArtifactDigest: active.source.artifactDigest,
    observation: fixed.observation, incidentKey: deriveIncidentKey(fixed.observation.incident), incidentEpoch: generationNumber === 2 ? parent.intent.incidentEpoch : (await ledger.read()).runs.find(r => r.lineage.incidentKey === deriveIncidentKey(fixed.observation.incident))?.lineage.incidentEpoch ?? 1,
    observationFingerprint: deriveObservationFingerprint(fixed.observation), baseAppSha: fixed.observation.incident.baseAppSha,
    controllerHash: closure.controllerHash, evaluatorHash: closure.evaluatorHash, memorySnapshotHash: fixed.memory.snapshot.hash, policyDigest: R4_POLICY_DIGEST, fakeFixtureDigest: hash(fixed.fakeFixture) }); check();
  if (generationNumber === 2 && ["controllerHash", "evaluatorHash", "memorySnapshotHash", "policyDigest", "fakeFixtureDigest", "incidentKey", "observationFingerprint", "baseAppSha"].some(k => intent[k as keyof R4ExecutionIntent] !== parent.intent[k as keyof R4ExecutionIntent])) fail("CATALOG_STALE");
  progress.receiptPaths.push(await appendReceipt(storage.receiptDirectory, `generation-${generationNumber}.intent.json`, { schemaVersion: 1, mode: "LOCAL_SYNTHETIC", actualRecovery: false, intent,
    activeSource: active.source, baseSourceDigest: bytesHash(fixed.baseSource), approvalsDigest: hash(fixed.memory.approvals), closure: closureMetadata(closure), rootTiming: root.rootTiming })); check();
  try {
    const broker = await LocalFakeModelBroker.openImprovement({ ledger, intent, rootTiming: root.rootTiming, monotonicMs: root.monotonicMs, nowUtc: now, killSwitch: options.killSwitch,
      checkpointSink: async c => { await checkpointStore.persist(c); progress.checkpoint = { ...c }; }, scenarios: labGenerationScenarios(fixed.fakeFixture, generationNumber) }); check();
    const session = await LabPromotionSession.open({ ...access, broker, intent, baseSource: fixed.baseSource, fakeFixture: fixed.fakeFixture, memory: fixed.memory }); check();
    const accepted = await session.promote(await session.generateProposal());
    // Durable publication wins. Receipt IO and the next generation's gate may
    // stop follow-up, but cannot revoke PROMOTED or relabel its settled cost.
    progress.checkpoint = accepted.checkpoint; progress.published = accepted.active.catalog; progress.completed++;
    try {
      const run = (await ledger.readImprovement()).executions.find(r => r.intent.executionId === intent.executionId)!;
      progress.generations.push(summary(run));
      progress.receiptPaths.push(await appendReceipt(storage.receiptDirectory, `generation-${generationNumber}.outcome.json`, { schemaVersion: 1, mode: "LOCAL_SYNTHETIC", actualRecovery: false,
      status: "PROMOTED", execution: run, catalog: accepted.active.catalog, checkpoint: accepted.checkpoint, memory: accepted.memoryEvidence })); }
    catch { progress.receiptUncertain = true; fail("RECEIPT_UNCERTAIN"); }
  } catch (error) {
    if (progress.published?.executionId === intent.executionId) throw error;
    let run: R4LedgerExecution | undefined, durable = false;
    try { await checkpointStore.assertCurrent(ledger.checkpoint); progress.checkpoint = ledger.checkpoint; durable = true; run = (await ledger.readImprovement()).executions.find(r => r.intent.executionId === intent.executionId); } catch { /* Preserve last trusted checkpoint; do not adopt disk head. */ }
    if (run) progress.generations.push(summary(run));
    try { progress.receiptPaths.push(await appendReceipt(storage.receiptDirectory, `generation-${generationNumber}.outcome.json`, { schemaVersion: 1, mode: "LOCAL_SYNTHETIC", actualRecovery: false,
      status: "BLOCKED", reasonCode: durable ? reason(error) : "ACCOUNTING_UNCERTAIN", execution: run ?? null, lastTrustedCheckpoint: progress.checkpoint, checkpointCurrent: durable })); }
    catch { progress.receiptUncertain = true; }
    if (!durable) fail("ACCOUNTING_UNCERTAIN"); throw error;
  }
}
function closureMetadata(closure: FixedRepairClosure) { return { controller: closure.controller, evaluator: closure.evaluator, controllerHash: closure.controllerHash, evaluatorHash: closure.evaluatorHash }; }
/** Exactly g0 -> g1 -> fresh-open exact g1 -> g2. No replay, source fallback,
 * generation three, candidate repair/selection, live service or provider path. */
export async function runSelfImprovement(options: SelfImprovementOptions): Promise<SelfImprovementResult> {
  const progress: Progress = { checkpoint: null, published: null, generations: [], receiptPaths: [], completed: 0, receiptUncertain: false };
  try {
    const root1 = timing(options); // Before input, compile and all storage IO.
    const fixed = fixedInputs(options); root1.gate.check();
    await generation(options, options.storage, 1, fixed, progress, root1);
    const root2 = timing(options); // Before fresh ledger/checkpoint/source IO.
    const fresh: SelfImprovementStorage = { mode: "OPEN", ledgerPath: options.storage.ledgerPath, checkpointPath: options.storage.checkpointPath, sourceDirectory: options.storage.sourceDirectory,
      receiptDirectory: options.storage.receiptDirectory, trustedCheckpoint: progress.checkpoint! };
    await generation(options, fresh, 2, fixed, progress, root2);
    return result(progress, "COMPLETED", "TWO_GENERATIONS_PROMOTED");
  } catch (error) { return result(progress, progress.receiptUncertain && progress.completed > 0 ? "PARTIAL" : "BLOCKED", reason(error)); }
}
/** Fresh operator action; target selection is exclusively the fixed Task3 CAS
 * rollback. The previous actual-validated artifact is reread and recompiled. */
export async function rollbackSelfImprovement(options: Pick<SelfImprovementOptions, "storage" | "killSwitch" | "monotonicMs" | "nowUtc">): Promise<SelfImprovementResult> {
  const progress: Progress = { checkpoint: null, published: null, generations: [], receiptPaths: [], completed: 0, receiptUncertain: false };
  try {
    const root = timing(options); if (options.storage.mode !== "OPEN") fail("INVALID_INPUT");
    const stores = await openStorage(options.storage, root, options.nowUtc ?? (() => new Date().toISOString()), false);
    progress.checkpoint = stores.ledger.checkpoint;
    const accepted = await rollbackLabCatalog({ ...stores, rootTiming: root.rootTiming, monotonicMs: root.monotonicMs, killSwitch: options.killSwitch, nowUtc: options.nowUtc });
    progress.checkpoint = accepted.checkpoint; progress.published = accepted.active.catalog;
    try { progress.receiptPaths.push(await appendReceipt(options.storage.receiptDirectory, `rollback-${accepted.active.catalog.revision}.json`, { schemaVersion: 1, mode: "LOCAL_SYNTHETIC", actualRecovery: false, ...accepted })); }
    catch { progress.receiptUncertain = true; return result(progress, "PARTIAL", "RECEIPT_UNCERTAIN"); }
    return result(progress, "ROLLED_BACK", "ROLLED_BACK");
  } catch (error) { return result(progress, "BLOCKED", reason(error)); }
}
