import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";
import { z } from "zod";
import {
  assertTransition, deriveIncidentKey, deriveKst, deriveObservationFingerprint,
  parseEvidenceReference, parseLineage, parseObservation,
  type RsiLineage, type RsiObservation, type RsiStatus, type RsiTransition,
} from "./contracts";
import {
  parseImprovementReservation, parseImprovementEvent, parseImprovementSettlement, parseLabCatalogCommit,
  R4_PHASE_QUOTAS, R4_POLICY,
  type R4Reservation, type R4ImprovementEvent, type R4ExecutionStatus, type R4Settlement,
  type R4SourceArtifactReference, type R4ValidationBinding, type R4CatalogCommit, type R4ModelPhase,
} from "./execution-contracts";

// Local synthetic storage, not a provider broker. The controller owns the clock,
// receipt provenance and trusted head checkpoint. Hashes detect changes against
// that checkpoint; they do not authenticate a writer or an execution receipt.
const MAX_EVENT_BYTES = 262_144;
const MAX_REVISIONS = 10_000;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.uuid().transform((v) => v.toLowerCase());
const units = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const utc = z.string().refine((v) => { try { deriveKst(v); return true; } catch { return false; } });
const configSchema = z.strictObject({
  schemaVersion: z.literal(1), environment: z.literal("LOCAL_SYNTHETIC"), campaignId: id,
  currencyUnit: z.literal("MICRO_USD"),
  limits: z.strictObject({ incident: units.positive(), campaign: units.positive(), day: units.positive(), month: units.positive() }),
});
const reserveSchema = z.strictObject({
  requestId: id, maximumCostUnits: units.positive(),
  observation: z.unknown().transform(parseObservation), lineage: z.unknown().transform(parseLineage),
});
const receiptSchema = z.strictObject({
  runId: id, receiptId: id, kind: z.enum(["CONFIRMED", "AMBIGUOUS"]),
  chargedUnits: units.nullable(), receiptDigest: digest,
}).refine((v) => v.kind === "AMBIGUOUS" ? v.chargedUnits === null : v.chargedUnits !== null);
const transitionSchema = z.strictObject({ runId: id, transition: z.unknown().transform(assertTransition) });
const closureIdentity = {
  incidentKey: digest, incidentEpoch: z.number().int().min(1).max(1_000_000),
};
const closureSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...closureIdentity, kind: z.literal("RECOVERY_CONFIRMED"),
    evidence: z.unknown().transform(parseEvidenceReference),
  }).refine((v) => v.evidence.kind === "LIVE_PROBE" && v.evidence.verdict === "PASS"),
  z.strictObject({
    ...closureIdentity, kind: z.literal("OPERATOR_CLOSED"),
    authorization: z.unknown().transform(parseEvidenceReference),
    evidence: z.unknown().transform(parseEvidenceReference),
  }).refine((v) => v.authorization.kind === "AUTHORIZATION" && v.authorization.verdict === "PASS"
    && v.evidence.kind === "OUTCOME" && v.evidence.verdict === "PASS"
    && v.authorization.evidenceId !== v.evidence.evidenceId),
]);
// OPERATOR_CLOSED receipts attest to the authorized closure action, not recovery.
// As with other evidence, their provenance must be supplied by the trusted caller.
const eventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("CREATE"), atUtc: utc, data: configSchema }),
  z.strictObject({ type: z.literal("RESERVE"), atUtc: utc, data: reserveSchema }),
  z.strictObject({ type: z.literal("SETTLE"), atUtc: utc, data: receiptSchema }),
  z.strictObject({ type: z.literal("TRANSITION"), atUtc: utc, data: transitionSchema }),
  z.strictObject({ type: z.literal("CLOSE"), atUtc: utc, data: closureSchema }),
  z.strictObject({ type: z.literal("EXECUTION_RESERVE"), atUtc: utc, data: z.unknown().transform(parseImprovementReservation) }),
  z.strictObject({ type: z.literal("EXECUTION_EVENT"), atUtc: utc, data: z.unknown().transform(parseImprovementEvent) }),
  z.strictObject({ type: z.literal("EXECUTION_SETTLE"), atUtc: utc, data: z.unknown().transform(parseImprovementSettlement) }),
  z.strictObject({ type: z.literal("CATALOG_COMMIT"), atUtc: utc, data: z.unknown().transform(parseLabCatalogCommit) }),
]);
const checkpointSchema = z.strictObject({ revision: z.number().int().min(0).max(MAX_REVISIONS - 1), hash: digest });
const revisionSchema = z.strictObject({ schemaVersion: z.literal(1), revision: checkpointSchema.shape.revision,
  parentHash: digest.nullable(), event: eventSchema, hash: digest });
export type RsiLedgerCheckpoint = z.infer<typeof checkpointSchema>;
export type RsiLedgerConfig = z.infer<typeof configSchema>;
type Event = z.infer<typeof eventSchema>;
type Receipt = z.infer<typeof receiptSchema>;
type Reservation = z.infer<typeof reserveSchema>;
export interface RsiLedgerRun extends Reservation {
  status: RsiStatus;
  reservedAtUtc: string;
  day: string;
  month: string;
  transitions: RsiTransition[];
  settlement: (Receipt & { consumedUnits: number; atUtc: string; day: string; month: string }) | null;
}
export interface RsiLedgerState {
  config: RsiLedgerConfig;
  lastAtUtc: string;
  runs: RsiLedgerRun[];
  aliases: (Reservation & { targetRunId: string })[];
  closures: (z.infer<typeof closureSchema> & { atUtc: string })[];
}
export interface RsiReservationResult { authorized: boolean; runId: string; requestId: string; maximumCostUnits: number }
export interface R4ReservationResult { authorized: boolean; executionId: string; requestId: string; maximumCostUnits: number }
export interface R4Call {
  sequence: number; phase: R4ModelPhase; callId: string; requestDigest: string;
  outcome: Extract<R4ImprovementEvent, { kind: "CALL_RETURNED" | "CALL_REJECTED" }> | null;
}
export interface R4LedgerExecution extends R4Reservation {
  status: R4ExecutionStatus; reservedAtUtc: string; day: string; month: string;
  events: R4ImprovementEvent[]; calls: R4Call[];
  proposal: Extract<R4ImprovementEvent, { kind: "PROPOSED" }> | null;
  baseline: R4ValidationBinding | null; validation: R4ValidationBinding | null;
  settlement: (R4Settlement & { consumedUnits: number; atUtc: string; day: string; month: string }) | null;
}
export interface R4CatalogVersion {
  revision: number; hash: string; parentHash: string | null; ledgerRevision: number; atUtc: string;
  commit: R4CatalogCommit;
  kind: R4CatalogCommit["kind"]; source: R4SourceArtifactReference; executionId: string | null;
  previousVerifiedRevision: number | null; binding: R4ValidationBinding | null; settlementDigest: string | null;
}
export interface R4LedgerState { executions: R4LedgerExecution[]; catalog: R4CatalogVersion[] }
interface CombinedState extends RsiLedgerState { improvement: R4LedgerState }
type TransactionResult = RsiReservationResult | R4ReservationResult | boolean;
const terminalStatuses: readonly RsiStatus[] = ["REJECTED", "BLOCKED", "INCONCLUSIVE", "NO_CHANGE", "LIVE_VERIFIED"];
function fail(code = "RSI_LEDGER_INVALID"): never { throw new Error(code); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  try { return schema.parse(input); } catch { return fail(); }
}
async function boundary<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    const codes = ["RSI_LEDGER_INVALID", "RSI_LEDGER_UNAVAILABLE", "RSI_LEDGER_STALE", "RSI_LEDGER_BUDGET"];
    if (error instanceof Error && codes.includes(error.message)) throw error;
    throw new Error("RSI_LEDGER_UNAVAILABLE");
  }
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function period(time: string) { const kst = deriveKst(time); return { day: kst.slice(0, 10), month: kst.slice(0, 7) }; }
function add(a: number, b: number): number { const sum = a + b; if (!Number.isSafeInteger(sum)) fail("RSI_LEDGER_BUDGET"); return sum; }
function result(run: RsiLedgerRun, authorized: boolean): RsiReservationResult {
  return { authorized, runId: run.lineage.runId, requestId: run.requestId, maximumCostUnits: run.maximumCostUnits };
}
function reservationOf(run: RsiLedgerRun): Reservation {
  return { requestId: run.requestId, maximumCostUnits: run.maximumCostUnits, observation: run.observation, lineage: run.lineage };
}
function checkObservation(data: { observation: RsiObservation; lineage: RsiLineage }, atUtc: string) {
  if (data.lineage.incidentKey !== deriveIncidentKey(data.observation.incident)
    || data.lineage.eventFingerprint !== deriveObservationFingerprint(data.observation)
    || data.lineage.baseAppSha !== data.observation.incident.baseAppSha
    || data.observation.observedAtUtc > atUtc) fail();
}
function reserve(state: CombinedState, data: Reservation, atUtc: string): RsiReservationResult {
  checkObservation(data, atUtc);
  if ([data.requestId, data.lineage.runId].some(value => improvementIds(state).includes(value))) fail();
  const duplicate = state.runs.find((r) => r.requestId === data.requestId || r.lineage.runId === data.lineage.runId);
  if (duplicate) {
    if (!same(reservationOf(duplicate), data)) fail();
    return result(duplicate, false);
  }
  const alias = state.aliases.find((r) => r.requestId === data.requestId || r.lineage.runId === data.lineage.runId);
  if (alias) {
    const { targetRunId, ...original } = alias;
    if (!same(original, data)) fail();
    const target = state.runs.find((r) => r.lineage.runId === targetRunId);
    if (!target) fail();
    return result(target, false);
  }
  const related = state.runs.filter((r) => r.lineage.incidentKey === data.lineage.incidentKey);
  const epochRuns = related.filter((r) => r.lineage.incidentEpoch === data.lineage.incidentEpoch);
  if (data.lineage.attempt === 1 && epochRuns.length > 0) {
    state.aliases.push({ ...data, targetRunId: epochRuns[0].lineage.runId });
    return result(epochRuns[0], false);
  }
  const latest = related.at(-1);
  if (data.lineage.attempt === 1) {
    if (!latest ? data.lineage.incidentEpoch !== 1 : data.lineage.incidentEpoch !== latest.lineage.incidentEpoch + 1) fail();
    if (latest) {
      const closed = state.closures.find((c) => c.incidentKey === data.lineage.incidentKey && c.incidentEpoch === latest.lineage.incidentEpoch);
      if (!closed || data.observation.observedAtUtc <= closed.atUtc) fail();
    }
  } else {
    const parent = epochRuns.at(-1);
    if (!parent || data.lineage.parentRunId !== parent.lineage.runId || data.lineage.attempt !== parent.lineage.attempt + 1
      || data.lineage.parentAgentHash !== parent.lineage.candidateAgentHash
      || !terminalStatuses.includes(parent.status) || !parent.settlement
      || state.closures.some((c) => c.incidentKey === data.lineage.incidentKey && c.incidentEpoch === data.lineage.incidentEpoch)) fail();
  }
  checkBudget(state, data.lineage.incidentKey, data.maximumCostUnits, atUtc);
  const current = period(atUtc);
  const run: RsiLedgerRun = { ...data, status: "OBSERVED", reservedAtUtc: atUtc, ...current, transitions: [], settlement: null };
  state.runs.push(run);
  return result(run, true);
}
// One accounting implementation for both purposes. The store's configured caps
// are never replaced by the larger R4 policy ceiling.
function checkBudget(state: CombinedState, incidentKey: string, maximumCostUnits: number, atUtc: string) {
  const current = period(atUtc);
  const totals = { incident: 0, campaign: 0, day: 0, month: 0 };
  const costs = [...state.runs.map(run => ({ ...run, incidentKey: run.lineage.incidentKey })),
    ...state.improvement.executions.map(run => ({ ...run, incidentKey: run.intent.incidentKey }))];
  for (const run of costs) {
    const cost = run.settlement?.consumedUnits ?? run.maximumCostUnits;
    totals.campaign = add(totals.campaign, cost);
    if (run.incidentKey === incidentKey) totals.incident = add(totals.incident, cost);
    // Pending exposure carries into EVERY current accounting period. Confirmed
    // cost counts in both reservation and settlement periods (conservative).
    if (!run.settlement || run.day === current.day || run.settlement.day === current.day) totals.day = add(totals.day, cost);
    if (!run.settlement || run.month === current.month || run.settlement.month === current.month) totals.month = add(totals.month, cost);
  }
  for (const key of ["incident", "campaign", "day", "month"] as const) {
    if (add(totals[key], maximumCostUnits) > state.config.limits[key]) fail("RSI_LEDGER_BUDGET");
  }
}
function legacyIds(state: CombinedState): string[] {
  return [...state.runs.flatMap(r => [r.requestId, r.lineage.runId, ...(r.settlement ? [r.settlement.receiptId] : [])]),
    ...state.aliases.flatMap(r => [r.requestId, r.lineage.runId])];
}
function improvementIds(state: CombinedState): string[] {
  return state.improvement.executions.flatMap(r => [r.intent.requestId, r.intent.executionId,
    ...r.calls.map(c => c.callId), ...(r.settlement ? [r.settlement.receiptId] : [])]);
}
function allIds(state: CombinedState) { return [...legacyIds(state), ...improvementIds(state)]; }
function currentCatalog(state: CombinedState) { const row = state.improvement.catalog.at(-1); if (!row) fail(); return row; }
function checkArtifact(state: CombinedState, source: R4SourceArtifactReference) {
  const references = [...state.improvement.catalog.map(c => c.source), ...state.improvement.executions.flatMap(r => r.proposal ? [r.proposal.source] : [])];
  if (references.some(ref => ref.artifactDigest === source.artifactDigest && !same(ref, source))) fail();
}
function checkCas(state: CombinedState, data: { expectedCatalogRevision: number; expectedCatalogHash: string }) {
  const active = currentCatalog(state);
  if (active.revision !== data.expectedCatalogRevision || active.hash !== data.expectedCatalogHash) fail();
  return active;
}
function improvementResult(run: R4LedgerExecution, authorized: boolean): R4ReservationResult {
  return { authorized, executionId: run.intent.executionId, requestId: run.intent.requestId, maximumCostUnits: run.maximumCostUnits };
}
function reserveImprovement(state: CombinedState, data: R4Reservation, atUtc: string): R4ReservationResult {
  const input = data.intent;
  if (input.campaignId !== state.config.campaignId || input.observation.observedAtUtc > atUtc) fail();
  const related = state.runs.filter(r => r.lineage.incidentKey === input.incidentKey);
  if (related.length ? !related.some(r => r.lineage.incidentEpoch === input.incidentEpoch) : input.incidentEpoch !== 1) fail();
  const duplicate = state.improvement.executions.find(r => r.intent.executionId === input.executionId || r.intent.requestId === input.requestId);
  if (duplicate) {
    if (!same({ intent: duplicate.intent, maximumCostUnits: duplicate.maximumCostUnits }, data)) fail();
    return improvementResult(duplicate, false);
  }
  const ids = allIds(state);
  if ([input.executionId, input.requestId].some(value => ids.includes(value))
    || state.improvement.executions.some(r => r.intent.generation === input.generation || !r.settlement)) fail();
  const active = checkCas(state, input);
  if (active.source.agentHash !== input.activeAgentHash || active.source.compiledDigest !== input.activeCompiledDigest
    || active.source.artifactDigest !== input.activeSourceArtifactDigest) fail();
  if (input.generation === 1) {
    if (state.improvement.executions.length || active.kind !== "SEED") fail();
  } else {
    const parent = state.improvement.executions[0];
    if (!parent || parent.intent.generation !== 1 || parent.intent.executionId !== input.parentExecutionId
      || parent.status !== "PROMOTED" || parent.settlement?.kind !== "CONFIRMED"
      || active.kind !== "PROMOTE" || active.executionId !== parent.intent.executionId
      || !parent.proposal || !same(active.source, parent.proposal.source)) fail();
    for (const key of ["incidentKey", "incidentEpoch", "observationFingerprint", "baseAppSha", "controllerHash", "evaluatorHash", "memorySnapshotHash", "policyDigest", "fakeFixtureDigest"] as const) {
      if (parent.intent[key] !== input[key]) fail();
    }
  }
  checkBudget(state, input.incidentKey, data.maximumCostUnits, atUtc);
  const run: R4LedgerExecution = { ...data, status: "RESERVED", reservedAtUtc: atUtc, ...period(atUtc),
    events: [], calls: [], proposal: null, baseline: null, validation: null, settlement: null };
  state.improvement.executions.push(run);
  return improvementResult(run, true);
}
function checkBinding(run: R4LedgerExecution, binding: R4ValidationBinding) {
  for (const key of ["controllerHash", "evaluatorHash", "memorySnapshotHash", "policyDigest", "fakeFixtureDigest"] as const) {
    if (binding[key] !== run.intent[key]) fail();
  }
}
function checkCallStage(run: R4LedgerExecution, phase: R4ModelPhase) {
  const stage = { BASELINE_REPAIR: "RESERVED", GENERATE_AGENT: "GENERATING", PROMOTION_REPAIR: "PROBING" };
  if (run.status !== stage[phase] || run.baseline && phase === "BASELINE_REPAIR"
    || run.calls.filter(c => c.phase === phase).length >= R4_PHASE_QUOTAS[run.intent.generation][phase]) fail();
}
function completedPhase(run: R4LedgerExecution, phase: R4ModelPhase, count: number) {
  const calls = run.calls.filter(c => c.phase === phase);
  return calls.length === count && calls.every(c => c.outcome?.kind === "CALL_RETURNED");
}
function recordImprovement(state: CombinedState, executionId: string, event: R4ImprovementEvent) {
  const run = state.improvement.executions.find(r => r.intent.executionId === executionId);
  if (!run || ["PROMOTED", "REJECTED", "BLOCKED", "INCONCLUSIVE"].includes(run.status)) fail();
  const inFlight = run.calls.find(c => !c.outcome);
  switch (event.kind) {
    case "CALL_STARTED":
    case "CALL_REJECTED": {
      if (run.settlement) fail();
      if (event.kind === "CALL_REJECTED" && event.usage !== "REJECTED_INPUT") {
        if (!inFlight || inFlight.callId !== event.callId || inFlight.sequence !== event.sequence
          || inFlight.phase !== event.phase || inFlight.requestDigest !== event.requestDigest) fail();
        inFlight.outcome = event; break;
      }
      checkCallStage(run, event.phase);
      if (inFlight || run.calls.length >= R4_POLICY.maxCalls || event.sequence !== run.calls.length + 1 || allIds(state).includes(event.callId)) fail();
      run.calls.push({ sequence: event.sequence, phase: event.phase, callId: event.callId, requestDigest: event.requestDigest,
        outcome: event.kind === "CALL_REJECTED" ? event : null });
      break;
    }
    case "CALL_RETURNED":
      if (run.settlement || !inFlight || inFlight.sequence !== event.sequence || inFlight.callId !== event.callId) fail();
      inFlight.outcome = event; break;
    case "BASELINE_VALIDATED":
      if (run.intent.generation !== 1 || run.status !== "RESERVED" || run.baseline || !completedPhase(run, "BASELINE_REPAIR", 2)) fail();
      checkBinding(run, event.binding); run.baseline = event.binding; break;
    case "GENERATING":
      if (run.status !== "RESERVED" || run.intent.generation === 1 && !run.baseline) fail();
      run.status = "GENERATING"; break;
    case "PROPOSED": {
      checkArtifact(state, event.source);
      const binding = event.generationBinding, call = run.calls.find(c => c.sequence === binding.sequence);
      if (run.status !== "GENERATING" || run.proposal || inFlight || event.source.agentHash === run.intent.activeAgentHash
        || binding.executionId !== run.intent.executionId || binding.activeAgentHash !== run.intent.activeAgentHash
        || binding.activeCompiledDigest !== run.intent.activeCompiledDigest || !call || call.phase !== "GENERATE_AGENT"
        || call.callId !== binding.callId || call.requestDigest !== binding.brokerRequestDigest || call.outcome?.kind !== "CALL_RETURNED"
        || call.outcome.receiptDigest !== binding.brokerReceiptDigest || call.outcome.outputDigest !== binding.brokerOutputDigest) fail();
      run.proposal = event; run.status = "PROPOSED"; break;
    }
    case "PROBING":
      if (run.status !== "PROPOSED") fail(); run.status = "PROBING"; break;
    case "VALIDATED":
      if (run.status !== "PROBING" || inFlight || !completedPhase(run, "PROMOTION_REPAIR", 2)) fail();
      checkBinding(run, event.binding); run.validation = event.binding; run.status = "VALIDATED"; break;
    default:
      if (inFlight) fail(); run.status = event.kind;
  }
  run.events.push(event);
}
function settleImprovement(state: CombinedState, data: R4Settlement, atUtc: string): boolean {
  const run = state.improvement.executions.find(r => r.intent.executionId === data.executionId);
  if (!run) fail();
  if (run.settlement) {
    const { consumedUnits: _cost, atUtc: _at, day: _day, month: _month, ...receipt } = run.settlement;
    if (!same(receipt, data)) fail(); return false;
  }
  if (allIds(state).includes(data.receiptId)) fail();
  const uncertain = run.calls.some(c => !c.outcome || c.outcome.kind === "CALL_REJECTED" && c.outcome.usage === "WORST_CASE");
  const confirmedCost = run.calls.reduce((sum, c) => add(sum, c.outcome?.costUnits ?? 0), 0);
  if (data.kind === "CONFIRMED" && (uncertain || data.chargedUnits !== confirmedCost)) fail();
  const consumedUnits = data.kind === "AMBIGUOUS" ? run.maximumCostUnits : data.chargedUnits!;
  if (consumedUnits > run.maximumCostUnits) fail();
  run.settlement = { ...data, consumedUnits, atUtc, ...period(atUtc) }; return true;
}
function commitCatalog(state: CombinedState, data: R4CatalogCommit, atUtc: string, ledgerRevision: number) {
  const catalog = state.improvement.catalog;
  let source: R4SourceArtifactReference, executionId: string | null = null, previousVerifiedRevision: number | null = null;
  let binding: R4ValidationBinding | null = null, settlementDigest: string | null = null;
  if (data.kind === "SEED") {
    if (catalog.length || state.improvement.executions.length) fail(); source = data.source;
  } else {
    const active = checkCas(state, data);
    if (data.kind === "PROMOTE") {
      const run = state.improvement.executions.find(r => r.intent.executionId === data.executionId);
      if (!run || run.status !== "VALIDATED" || run.settlement?.kind !== "CONFIRMED" || !run.validation || !run.proposal
        || !same(data.source, run.proposal.source) || !same(data.binding, run.validation) || data.settlementDigest !== run.settlement.receiptDigest
        || run.intent.expectedCatalogRevision !== active.revision || run.intent.expectedCatalogHash !== active.hash) fail();
      if (active.kind === "SEED" ? !run.baseline : !active.binding) fail();
      source = data.source; executionId = data.executionId; previousVerifiedRevision = active.revision;
      binding = data.binding; settlementDigest = data.settlementDigest; run.status = "PROMOTED";
    } else {
      const target = catalog.find(c => c.revision === data.targetCatalogRevision && c.hash === data.targetCatalogHash);
      if (!target || active.previousVerifiedRevision !== target.revision
        || state.improvement.executions.some(r => !r.settlement)
        || target.kind === "SEED" && !state.improvement.executions.some(r => r.intent.generation === 1 && r.baseline
          && r.intent.expectedCatalogHash === target.hash) || target.kind !== "SEED" && !target.binding) fail();
      source = target.source; executionId = target.executionId; previousVerifiedRevision = target.previousVerifiedRevision;
      binding = target.binding ?? state.improvement.executions.find(r => r.intent.generation === 1)!.baseline;
      settlementDigest = target.settlementDigest;
    }
  }
  checkArtifact(state, source);
  const revision = catalog.length, parentHash = catalog.at(-1)?.hash ?? null;
  catalog.push({ revision, hash: hash({ revision, parentHash, data }), parentHash, ledgerRevision, atUtc, commit: data,
    kind: data.kind, source, executionId, previousVerifiedRevision, binding, settlementDigest });
}
function apply(state: CombinedState, event: Exclude<Event, { type: "CREATE" }>, revision: number): TransactionResult {
  if (event.atUtc < state.lastAtUtc) fail();
  let changed = true;
  switch (event.type) {
    case "RESERVE": {
      const previousAliases = state.aliases.length;
      const outcome = reserve(state, event.data, event.atUtc);
      if (outcome.authorized || state.aliases.length !== previousAliases) state.lastAtUtc = event.atUtc;
      return outcome;
    }
    case "SETTLE": {
      const data = event.data;
      const run = state.runs.find((r) => r.lineage.runId === data.runId);
      if (!run || improvementIds(state).includes(data.receiptId) || state.runs.some((r) => r.lineage.runId !== data.runId && r.settlement?.receiptId === data.receiptId)) fail();
      if (run.settlement) {
        const s = run.settlement;
        if (!same({ runId: s.runId, receiptId: s.receiptId, kind: s.kind, chargedUnits: s.chargedUnits, receiptDigest: s.receiptDigest }, data)) fail();
        changed = false;
      } else {
        const consumedUnits = data.kind === "AMBIGUOUS" ? run.maximumCostUnits : data.chargedUnits!;
        if (consumedUnits > run.maximumCostUnits) fail();
        run.settlement = { ...data, consumedUnits, atUtc: event.atUtc, ...period(event.atUtc) };
      }
      break;
    }
    case "TRANSITION": {
      const run = state.runs.find((r) => r.lineage.runId === event.data.runId);
      if (!run || run.status !== event.data.transition.from) fail();
      run.transitions.push(event.data.transition); run.status = event.data.transition.to;
      break;
    }
    case "CLOSE": {
      const data = event.data;
      const runs = state.runs.filter((r) => r.lineage.incidentKey === data.incidentKey && r.lineage.incidentEpoch === data.incidentEpoch);
      if (!runs.length || runs.some((r) => !terminalStatuses.includes(r.status) || !r.settlement)) fail();
      const previous = state.closures.find((c) => c.incidentKey === data.incidentKey && c.incidentEpoch === data.incidentEpoch);
      if (previous) {
        const { atUtc: _closedAt, ...original } = previous;
        if (!same(original, data)) fail();
        changed = false;
      } else state.closures.push({ ...data, atUtc: event.atUtc });
      break;
    }
    case "EXECUTION_RESERVE": {
      const outcome = reserveImprovement(state, event.data, event.atUtc);
      if (outcome.authorized) state.lastAtUtc = event.atUtc;
      return outcome;
    }
    case "EXECUTION_EVENT": recordImprovement(state, event.data.executionId, event.data.event); break;
    case "EXECUTION_SETTLE": changed = settleImprovement(state, event.data, event.atUtc); break;
    case "CATALOG_COMMIT": commitCatalog(state, event.data, event.atUtc, revision); break;
  }
  if (changed) state.lastAtUtc = event.atUtc;
  return changed;
}
function name(revision: number): string { return `${String(revision).padStart(5, "0")}.json`; }
async function safeDirectory(path: string) {
  if (!isAbsolute(path) || path !== resolve(path) || path.split("/").some((s) => s === "." || s === "..")) fail();
  let current = parsePath(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail();
  }
  return lstat(path);
}
async function syncDirectory(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

export class LocalRsiLedger {
  private constructor(private readonly path: string, private head: RsiLedgerCheckpoint, private readonly device: number,
    private readonly inode: number, private readonly openedAtRevision: number | null = null) {}
  get checkpoint(): RsiLedgerCheckpoint { return { ...this.head }; }

  static async create(path: string, config: unknown, nowUtc: unknown): Promise<LocalRsiLedger> {
    return boundary(async () => {
      const event = parse(eventSchema, { type: "CREATE", atUtc: nowUtc, data: config });
      if (!isAbsolute(path) || path !== resolve(path)) fail();
      await safeDirectory(dirname(path));
      // mkdir without recursive is deliberate: an existing/lost store is never
      // silently adopted or reset, including a concurrent create.
      await mkdir(path, { mode: 0o700 });
      await syncDirectory(dirname(path));
      const stat = await safeDirectory(path);
      const ledger = new LocalRsiLedger(path, { revision: 0, hash: "0".repeat(64) }, stat.dev, stat.ino);
      await mkdir(join(path, ".writer-lock"), { mode: 0o700 });
      await ledger.writeRevision(event, null, 0);
      await rmdir(join(path, ".writer-lock"));
      await syncDirectory(path);
      return ledger;
    });
  }

  static async open(path: string, trustedCheckpoint: unknown): Promise<LocalRsiLedger> {
    return boundary(async () => {
      const checkpoint = parse(checkpointSchema, trustedCheckpoint);
      const stat = await safeDirectory(path);
      const ledger = new LocalRsiLedger(path, checkpoint, stat.dev, stat.ino, checkpoint.revision);
      await ledger.load(false);
      return ledger;
    });
  }

  async read(): Promise<RsiLedgerState> {
    return boundary(async () => {
      const { improvement: _improvement, ...legacy } = await this.load(false);
      return structuredClone(legacy);
    });
  }
  async readImprovement(): Promise<R4LedgerState> { return boundary(async () => structuredClone((await this.load(false)).improvement)); }
  async reserve(input: unknown, nowUtc: unknown): Promise<RsiReservationResult> {
    return this.transaction({ type: "RESERVE", atUtc: nowUtc, data: input }) as Promise<RsiReservationResult>;
  }
  async settle(input: unknown, nowUtc: unknown): Promise<void> { await this.transaction({ type: "SETTLE", atUtc: nowUtc, data: input }); }
  async transition(input: unknown, nowUtc: unknown): Promise<void> { await this.transaction({ type: "TRANSITION", atUtc: nowUtc, data: input }); }
  async closeIncident(input: unknown, nowUtc: unknown): Promise<void> { await this.transaction({ type: "CLOSE", atUtc: nowUtc, data: input }); }
  async reserveImprovement(input: unknown, nowUtc: unknown): Promise<R4ReservationResult> {
    return this.transaction({ type: "EXECUTION_RESERVE", atUtc: nowUtc, data: input }) as Promise<R4ReservationResult>;
  }
  async recordImprovementEvent(input: unknown, nowUtc: unknown): Promise<void> { await this.transaction({ type: "EXECUTION_EVENT", atUtc: nowUtc, data: input }); }
  async settleImprovement(input: unknown, nowUtc: unknown): Promise<void> { await this.transaction({ type: "EXECUTION_SETTLE", atUtc: nowUtc, data: input }); }
  async commitLabCatalog(input: unknown, nowUtc: unknown): Promise<void> { await this.transaction({ type: "CATALOG_COMMIT", atUtc: nowUtc, data: input }); }

  private async checkRoot() {
    const stat = await safeDirectory(this.path);
    if (stat.dev !== this.device || stat.ino !== this.inode || (stat.mode & 0o077) !== 0) fail();
  }
  private async load(locked: boolean): Promise<CombinedState> {
    await this.checkRoot();
    const entries = await readdir(this.path);
    const files = entries.filter((entry) => !(locked && entry === ".writer-lock")).sort();
    if (!files.length || files.length > MAX_REVISIONS || files.some((file, index) => file !== name(index))) fail();
    let state: CombinedState | undefined;
    let previousHash: string | null = null;
    for (let index = 0; index < files.length; index++) {
      const handle = await open(join(this.path, files[index]), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let raw: string;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > MAX_EVENT_BYTES) fail();
        raw = await handle.readFile("utf8");
        if (Buffer.byteLength(raw) > MAX_EVENT_BYTES) fail();
      } finally { await handle.close(); }
      const row = parse(revisionSchema, JSON.parse(raw));
      // Exact bytes prohibit duplicate JSON keys, ignored fields and normalized
      // alternate representations that would otherwise evade parsed hashes.
      if (raw !== JSON.stringify(row)) fail();
      const payload = { schemaVersion: row.schemaVersion, revision: row.revision, parentHash: row.parentHash, event: row.event };
      if (row.revision !== index || row.parentHash !== previousHash || hash(payload) !== row.hash) fail();
      if (index === 0) {
        if (row.event.type !== "CREATE") fail();
        state = { config: row.event.data, lastAtUtc: row.event.atUtc, runs: [], aliases: [], closures: [], improvement: { executions: [], catalog: [] } };
      } else {
        if (!state || row.event.type === "CREATE") fail();
        const previousAliases = state.aliases.length;
        const applied = apply(state, row.event, index);
        if (applied === false || (typeof applied === "object" && !applied.authorized && state.aliases.length === previousAliases)) fail();
      }
      previousHash = row.hash;
    }
    await this.checkRoot();
    if (files.length - 1 !== this.head.revision || previousHash !== this.head.hash) fail("RSI_LEDGER_STALE");
    if (!state) fail();
    return state;
  }

  private async writeRevision(event: Event, parentHash: string | null, revision: number) {
    if (revision >= MAX_REVISIONS) fail();
    const payload = { schemaVersion: 1 as const, revision, parentHash, event };
    const row = { ...payload, hash: hash(payload) };
    const bytes = JSON.stringify(row);
    if (Buffer.byteLength(bytes) > MAX_EVENT_BYTES) fail();
    await this.checkRoot();
    const pending = join(this.path, ".pending");
    const handle = await open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await this.checkRoot();
    await rename(pending, join(this.path, name(revision)));
    await syncDirectory(this.path);
    this.head = { revision, hash: row.hash };
  }

  private async transaction(input: unknown): Promise<TransactionResult> {
    return boundary(async () => {
      const event = parse(eventSchema, input);
      if (event.type === "CREATE") fail();
      await this.checkRoot();
      const lock = join(this.path, ".writer-lock");
      await mkdir(lock, { mode: 0o700 });
      let writing = false;
      try {
        const state = await this.load(true);
        // Fresh trusted-checkpoint open is a capability boundary, not a field a
        // candidate or persisted intent can claim. Replay stays deterministic.
        if (event.type === "EXECUTION_RESERVE" && event.data.intent.generation === 2
          && !state.improvement.executions.some(r => r.intent.executionId === event.data.intent.executionId)) {
          if (this.openedAtRevision === null || this.openedAtRevision < currentCatalog(state).ledgerRevision) fail();
        }
        const previousAliases = state.aliases.length;
        const outcome = apply(state, event, this.head.revision + 1);
        if (outcome !== false && !(typeof outcome === "object" && !outcome.authorized && state.aliases.length === previousAliases)) {
          writing = true;
          await this.writeRevision(event, this.head.hash, this.head.revision + 1);
          writing = false;
        }
        await rmdir(lock); await syncDirectory(this.path);
        return outcome;
      } catch (error) {
        // Validation/stale failures have no partial write. An uncertain write
        // keeps the lock and any pending file: recovery is explicit, never stolen.
        if (!writing) { await rmdir(lock); await syncDirectory(this.path); }
        throw error;
      }
    });
  }
}
