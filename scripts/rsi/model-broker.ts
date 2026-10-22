import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import { LocalRsiLedger, type RsiLedgerCheckpoint } from "./ledger";
import { parseLineage, parseObservation } from "./contracts";
import { parseBoundedJsonObject, SANDBOX_POLICY } from "./sandbox";
import { parseImprovementIntent, R4_PHASE_QUOTAS, type R4ExecutionIntent, type R4ImprovementEvent, type R4ModelPhase } from "./execution-contracts";

export const MODEL_POLICY = Object.freeze({ mode: "LOCAL_FAKE" as const,
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", inputTokens: 16000, outputTokens: 2000,
  inputPricePer1000: 293, outputPricePer1000: 2253, maxCallCostUnits: 9194,
  maxCalls: 8, poolCostUnits: 73552, callTimeoutMs: 30000, recoveryTimeoutMs: 120000 });
const ipcSchema = z.strictObject({ schemaVersion: z.literal(1), task: z.enum(["repair", "improve-agent"]), message: z.string().min(1).max(16000) });
const intentSchema = z.strictObject({ requestId: z.uuid(), observation: z.unknown().transform(parseObservation), lineage: z.unknown().transform(parseLineage) });
const delayMsSchema = z.number().int().min(0).max(60000).optional();
const scenarioSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["SUCCESS", "INVALID_JSON", "INVALID_USAGE", "FAILURE", "LOST_RESPONSE", "OVERSIZED_OUTPUT", "FORGED_USAGE"]), delayMs: delayMsSchema }),
  z.strictObject({ kind: z.literal("JSON_RESPONSE"), response: z.unknown(), delayMs: delayMsSchema }),
]);
export type FakeScenario = z.infer<typeof scenarioSchema>;
type PreparedScenario = Exclude<FakeScenario, { kind: "JSON_RESPONSE" }> | { kind: "JSON_RESPONSE"; text: string; delayMs?: number };

// Inspect descriptors before Zod or the shared JSON parser can read properties.
// Proxy detection must come first: even introspection can execute proxy traps.
function assertPassiveScenarios(value: unknown) {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number) {
    // Allow the array/scenario wrappers; each response gets its exact JSON limits below.
    if (++nodes > 1 + MODEL_POLICY.maxCalls * (SANDBOX_POLICY.maxJsonNodes + 3)
      || depth > SANDBOX_POLICY.maxJsonDepth + 2) fail("SCENARIO");
    if (typeof item !== "object" || item === null) return;
    if (types.isProxy(item) || ancestors.has(item)) fail("SCENARIO");
    const array = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype)) fail("SCENARIO");
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") fail("SCENARIO");
      if (array && key === "length") continue;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) fail("SCENARIO");
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value, 0);
}
function prepareScenarios(value: unknown): readonly PreparedScenario[] {
  assertPassiveScenarios(value);
  return Object.freeze(z.array(scenarioSchema).max(MODEL_POLICY.maxCalls).parse(value).map(scenario => {
    if (scenario.kind !== "JSON_RESPONSE") return Object.freeze(scenario);
    // Serialize only the parser's plain data snapshot, never the caller's object.
    const text = JSON.stringify(parseBoundedJsonObject(scenario.response));
    if (Buffer.byteLength(text) > MODEL_POLICY.outputTokens) fail("SCENARIO");
    return Object.freeze({ kind: scenario.kind, text, delayMs: scenario.delayMs });
  }));
}
const receiptSchema = z.strictObject({ callId: z.uuid(), requestDigest: z.string().regex(/^[a-f0-9]{64}$/), receiptId: z.uuid(),
  model: z.literal(MODEL_POLICY.model), inputTokens: z.number().int().min(0).max(16000), outputTokens: z.number().int().min(0).max(2000),
  text: z.string().max(16000) });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(code: string): never { throw new Error(`RSI_BROKER_${code}`); }
const cost = (input: number, output: number) => Math.ceil((input * 293 + output * 2253) / 1000);

/** Supervisor-only dependencies; no part of this object is decoded from candidate IPC. */
export interface LocalFakeBrokerOptions {
  ledger: LocalRsiLedger;
  intent: unknown;
  checkpointSink: (checkpoint: RsiLedgerCheckpoint) => Promise<void>;
  nowUtc?: () => string;
  monotonicMs?: () => number;
  killSwitch: () => boolean;
  scenarios?: FakeScenario[];
}
export interface LocalFakeImprovementBrokerOptions extends LocalFakeBrokerOptions {
  /** Captured before input/compile by the trusted root; nested helpers cannot extend it. */
  rootTiming: { startedMs: number; deadlineMs: number };
}
interface CallRecord { sequence: number; callId: string; requestDigest: string; receiptDigest: string; costUnits: number; kind: "CONFIRMED" | "WORST_CASE" | "REJECTED_INPUT"; phase?: R4ModelPhase }

// Fixed, local-only fake. No URL/credentials/provider callback and no fetch path.
// Failure scenarios are selected by the trusted test supervisor, never candidate JSON.
async function fakeResponse(scenario: PreparedScenario, callId: string, requestDigest: string, inputTokens: number, signal: AbortSignal) {
  if (signal.aborted) fail("TIMEOUT");
  if (scenario.delayMs) await new Promise<void>((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new Error("RSI_BROKER_TIMEOUT")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, scenario.delayMs);
    signal.addEventListener("abort", cancel, { once: true });
  });
  if (signal.aborted) fail("TIMEOUT");
  if (scenario.kind === "FAILURE" || scenario.kind === "LOST_RESPONSE") fail("RESPONSE");
  const text = scenario.kind === "JSON_RESPONSE" ? scenario.text : scenario.kind === "INVALID_JSON" ? "{" : scenario.kind === "OVERSIZED_OUTPUT" ? "x".repeat(2001)
    : scenario.kind === "FORGED_USAGE" ? '{"usage":{"inputTokens":0,"outputTokens":0},"chargedUnits":0}'
    : '{"action":"NO_CHANGE","reason":"LOCAL_FAKE"}';
  return { callId, requestDigest, receiptId: randomUUID(), model: MODEL_POLICY.model,
    inputTokens: scenario.kind === "INVALID_USAGE" ? 16001 : inputTokens, outputTokens: Buffer.byteLength(text), text };
}

/** One capability per R1 attempt: reserve all eight worst-case calls atomically. */
export class LocalFakeModelBroker {
  private readonly records: CallRecord[] = [];
  private busy = false;
  private closed = false;
  private finished = false;
  private uncertain = false;
  private lastTime: number;
  private activeAbort?: AbortController;
  private readonly nowUtc: () => string;
  private readonly clock: () => number;
  private constructor(private readonly options: LocalFakeBrokerOptions, private readonly runId: string,
    private readonly started: number, private readonly scenarios: readonly PreparedScenario[],
    private readonly improvement?: { intent: R4ExecutionIntent; deadlineMs: number }) {
    this.lastTime = started; this.clock = options.monotonicMs ?? (() => performance.now());
    this.nowUtc = options.nowUtc ?? (() => new Date().toISOString());
  }
  static async open(options: LocalFakeBrokerOptions): Promise<LocalFakeModelBroker> {
    const intent = intentSchema.parse(options.intent);
    const scenarios = prepareScenarios(options.scenarios ?? []);
    const clock = options.monotonicMs ?? (() => performance.now()), started = clock();
    if (!Number.isFinite(started) || started < 0) fail("CLOCK");
    if (options.killSwitch()) fail("KILLED");
    const reserved = await options.ledger.reserve({ ...intent, maximumCostUnits: MODEL_POLICY.poolCostUnits }, (options.nowUtc ?? (() => new Date().toISOString()))());
    // Persist aliases too. A failed checkpoint cannot grant a replacement capability.
    try { await options.checkpointSink(options.ledger.checkpoint); } catch { return fail("ACCOUNTING"); }
    if (!reserved.authorized) fail("DUPLICATE");
    if (reserved.maximumCostUnits !== MODEL_POLICY.poolCostUnits || reserved.runId !== intent.lineage.runId) fail("ACCOUNTING");
    return new LocalFakeModelBroker(options, reserved.runId, started, scenarios);
  }
  static async openImprovement(options: LocalFakeImprovementBrokerOptions): Promise<LocalFakeModelBroker> {
    const intent = parseImprovementIntent(options.intent), scenarios = prepareScenarios(options.scenarios ?? []);
    const now = (options.monotonicMs ?? (() => performance.now()))();
    let startedMs: number, deadlineMs: number;
    try { ({ startedMs, deadlineMs } = z.strictObject({ startedMs: z.number(), deadlineMs: z.number() }).parse(options.rootTiming)); }
    catch { return fail("CLOCK"); }
    if (![now, startedMs, deadlineMs].every(Number.isFinite) || startedMs < 0 || now < startedMs || deadlineMs <= startedMs
      || deadlineMs - startedMs > MODEL_POLICY.recoveryTimeoutMs) fail("CLOCK");
    if (options.killSwitch()) fail("KILLED");
    if (now >= deadlineMs) fail("DEADLINE");
    const reserved = await options.ledger.reserveImprovement({ intent, maximumCostUnits: MODEL_POLICY.poolCostUnits }, (options.nowUtc ?? (() => new Date().toISOString()))());
    try { await options.checkpointSink(options.ledger.checkpoint); } catch { return fail("ACCOUNTING"); }
    if (!reserved.authorized) fail("DUPLICATE");
    if (reserved.maximumCostUnits !== MODEL_POLICY.poolCostUnits || reserved.executionId !== intent.executionId) fail("ACCOUNTING");
    const broker = new LocalFakeModelBroker(options, reserved.executionId, startedMs, scenarios, { intent, deadlineMs });
    broker.lastTime = now; broker.gate(); return broker;
  }
  private elapsed() {
    const now = this.clock();
    if (!Number.isFinite(now) || now < this.lastTime) { this.closed = true; this.uncertain = true; fail("CLOCK"); }
    this.lastTime = now; return now - this.started;
  }
  private gate() {
    if (this.closed) fail("CLOSED");
    if (this.options.killSwitch()) { this.closed = true; fail("KILLED"); }
    if (this.elapsed() >= (this.improvement ? this.improvement.deadlineMs - this.started : MODEL_POLICY.recoveryTimeoutMs)) { this.closed = true; fail("DEADLINE"); }
  }
  private async pendingPool() {
    try {
      const run = this.improvement
        ? (await this.options.ledger.readImprovement()).executions.find(r => r.intent.executionId === this.runId)
        : (await this.options.ledger.read()).runs.find(r => r.lineage.runId === this.runId);
      if (!run || run.settlement || run.maximumCostUnits !== MODEL_POLICY.poolCostUnits) fail("ACCOUNTING");
    } catch { this.closed = true; this.uncertain = true; fail("ACCOUNTING"); }
  }
  private async audit(event: R4ImprovementEvent) {
    if (!this.improvement) return;
    try {
      await this.options.ledger.recordImprovementEvent({ executionId: this.runId, event }, this.nowUtc());
      await this.options.checkpointSink(this.options.ledger.checkpoint);
    } catch { this.closed = true; this.uncertain = true; fail("ACCOUNTING"); }
  }
  /** Only the supervisor receives phase handles; candidate IPC still contains task/message. */
  phase(phase: R4ModelPhase) {
    if (!this.improvement) fail("PURPOSE");
    if (!Object.hasOwn(R4_PHASE_QUOTAS[this.improvement.intent.generation], phase)) fail("PHASE");
    return Object.freeze({ request: (sequence: number, rawIpc: unknown) => this.performRequest(sequence, rawIpc, phase) });
  }

  /** sequence is assigned by the supervisor, outside candidate task/message IPC. */
  async request(sequence: number, rawIpc: unknown) {
    if (this.improvement) fail("PURPOSE");
    return this.performRequest(sequence, rawIpc);
  }
  private async performRequest(sequence: number, rawIpc: unknown, phase?: R4ModelPhase) {
    this.gate();
    if (this.busy) fail("BUSY");
    if (this.records.length >= MODEL_POLICY.maxCalls) fail("LIMIT");
    if (this.improvement && phase && this.records.filter(r => r.phase === phase).length >= R4_PHASE_QUOTAS[this.improvement.intent.generation][phase]) fail("PHASE_LIMIT");
    if (!Number.isSafeInteger(sequence) || sequence !== this.records.length + 1) fail("ORDER");
    if (MODEL_POLICY.poolCostUnits - this.records.length * MODEL_POLICY.maxCallCostUnits < MODEL_POLICY.maxCallCostUnits) fail("LIMIT");
    const callId = randomUUID();
    // Count even malformed/oversized requests, without retaining their contents.
    const record: CallRecord = { sequence, callId, requestDigest: hash({ rejected: true, sequence }), receiptDigest: hash({ callId, kind: "REJECTED_INPUT" }), costUnits: 0, kind: "REJECTED_INPUT", ...(phase ? { phase } : {}) };
    this.records.push(record);
    let message: z.infer<typeof ipcSchema>, envelope: string;
    try {
      if (typeof rawIpc !== "string" || Buffer.byteLength(rawIpc) > MODEL_POLICY.inputTokens) fail("INPUT");
      const parsed: unknown = JSON.parse(rawIpc); message = ipcSchema.parse(parsed);
      if (phase && message.task !== (phase === "GENERATE_AGENT" ? "improve-agent" : "repair")) fail("INPUT");
      if (JSON.stringify(parsed) !== rawIpc) fail("INPUT");
      envelope = JSON.stringify({ model: MODEL_POLICY.model, max_tokens: MODEL_POLICY.outputTokens, messages: [{ role: "user", content: message.message }], task: message.task });
      // One token per UTF-8 byte plus 256 framing tokens is a conservative cap.
      if (Buffer.byteLength(envelope) + 256 > MODEL_POLICY.inputTokens) fail("INPUT");
    } catch {
      if (phase) {
        this.busy = true;
        try { await this.audit({ kind: "CALL_REJECTED", sequence, phase, callId, requestDigest: record.requestDigest,
          receiptDigest: record.receiptDigest, outputDigest: null, costUnits: 0, usage: "REJECTED_INPUT" }); }
        finally { this.busy = false; }
      }
      return fail("INPUT");
    }
    record.requestDigest = hash(envelope); record.costUnits = MODEL_POLICY.maxCallCostUnits; record.kind = "WORST_CASE";
    record.receiptDigest = hash({ callId, requestDigest: record.requestDigest, kind: "WORST_CASE" });
    this.busy = true; const abort = new AbortController(); this.activeAbort = abort;
    let timer: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined;
    let audited = false, startedAudited = false, outputDigest: string | null = null;
    try {
      // File/checkpoint IO is not hard real time. Await it completely, then gate
      // before dispatch; never race an unjoined persistence operation with finish.
      if (phase) {
        await this.pendingPool(); this.gate();
        await this.audit({ kind: "CALL_STARTED", sequence, phase, callId, requestDigest: record.requestDigest });
        startedAudited = true;
        this.gate(); if (abort.signal.aborted) fail("TIMEOUT");
      }
      const timeout = Math.min(MODEL_POLICY.callTimeoutMs,
        (this.improvement ? this.improvement.deadlineMs - this.started : MODEL_POLICY.recoveryTimeoutMs) - this.elapsed());
      const stop = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new Error("RSI_BROKER_TIMEOUT")); }, timeout);
        poll = setInterval(() => { try { this.gate(); } catch (error) { abort.abort(); reject(error); } }, 25);
      });
      const reply = await Promise.race([stop, (async () => {
        await this.pendingPool(); this.gate(); if (abort.signal.aborted) fail("TIMEOUT");
        return fakeResponse(this.scenarios[sequence - 1] ?? { kind: "SUCCESS" }, callId, record.requestDigest, Buffer.byteLength(envelope) + 256, abort.signal);
      })()]);
      this.gate(); if (abort.signal.aborted) fail("TIMEOUT");
      clearTimeout(timer); clearInterval(poll);
      const receipt = receiptSchema.parse(reply);
      if (receipt.callId !== callId || receipt.requestDigest !== record.requestDigest || Buffer.byteLength(receipt.text) > MODEL_POLICY.outputTokens) fail("RESPONSE");
      const charged = cost(receipt.inputTokens, receipt.outputTokens);
      if (charged > MODEL_POLICY.maxCallCostUnits) fail("RESPONSE");
      record.costUnits = charged; record.kind = "CONFIRMED"; record.receiptDigest = hash(receipt);
      outputDigest = hash(receipt.text);
      // Model text is untrusted task data, never the accounting receipt.
      const untrustedOutput = parseBoundedJsonObject(JSON.parse(receipt.text));
      if (phase) {
        await this.audit({ kind: "CALL_RETURNED", sequence, callId, receiptDigest: record.receiptDigest, outputDigest, costUnits: charged });
        audited = true; this.gate();
      }
      return { untrustedOutput, metadata: { mode: MODEL_POLICY.mode, callId, sequence, receiptDigest: record.receiptDigest,
        ...(phase ? { requestDigest: record.requestDigest, outputDigest } : {}) } };
    } catch (error) {
      // R1 has one receipt per attempt: one unknown call makes the entire
      // aggregate ambiguous, so finish consumes the complete reserved pool.
      if (record.kind !== "CONFIRMED") this.uncertain = true;
      if (phase && startedAudited && !audited && !(error instanceof Error && error.message === "RSI_BROKER_ACCOUNTING")) {
        await this.audit({ kind: "CALL_REJECTED", sequence, phase, callId, requestDigest: record.requestDigest, receiptDigest: record.receiptDigest,
          outputDigest, costUnits: record.costUnits, usage: record.kind === "CONFIRMED" ? "CONFIRMED" : "WORST_CASE" });
      }
      if (error instanceof Error && /^RSI_BROKER_(TIMEOUT|KILLED|DEADLINE|CLOCK|ACCOUNTING|CLOSED)$/.test(error.message)) throw error;
      return fail("RESPONSE");
    } finally { clearTimeout(timer); clearInterval(poll); abort.abort(); this.activeAbort = undefined; this.busy = false; }
  }

  /** A trusted stop keeps uncertain in-flight work fully reserved. */
  stop() { this.closed = true; this.uncertain ||= this.busy; this.activeAbort?.abort(); }

  async finish() {
    if (this.finished) fail("CLOSED");
    if (this.busy) fail("BUSY");
    this.closed = true; this.finished = true;
    const chargedUnits = this.uncertain ? MODEL_POLICY.poolCostUnits : this.records.reduce((sum, row) => sum + row.costUnits, 0);
    const receiptDigest = hash({ schemaVersion: 1, mode: MODEL_POLICY.mode, runId: this.runId, policy: MODEL_POLICY,
      callCount: this.records.length, records: this.records, uncertain: this.uncertain, chargedUnits,
      ...(this.improvement ? { purpose: "R4_SELF_IMPROVE", generation: this.improvement.intent.generation } : {}) });
    try {
      await this.pendingPool();
      const settlement = { receiptId: randomUUID(), kind: this.uncertain ? "AMBIGUOUS" as const : "CONFIRMED" as const,
        chargedUnits: this.uncertain ? null : chargedUnits, receiptDigest };
      if (this.improvement) await this.options.ledger.settleImprovement({ executionId: this.runId, ...settlement }, this.nowUtc());
      else await this.options.ledger.settle({ runId: this.runId, ...settlement }, this.nowUtc());
      await this.options.checkpointSink(this.options.ledger.checkpoint);
      return { callCount: this.records.length, chargedUnits, receiptDigest };
    } catch { return fail("ACCOUNTING"); }
  }
}
