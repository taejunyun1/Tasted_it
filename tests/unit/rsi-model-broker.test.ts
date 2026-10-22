import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRsiLedger } from "../../scripts/rsi/ledger";
import { deriveIncidentKey, deriveKst, deriveObservationFingerprint, RSI_PUBLIC_PATHS } from "../../scripts/rsi/contracts";
import { LocalFakeModelBroker, MODEL_POLICY, type FakeScenario } from "../../scripts/rsi/model-broker";
import { R4_POLICY_DIGEST, deriveSourceAgentHash } from "../../scripts/rsi/execution-contracts";

const now = "2026-10-22T00:00:00.000Z", digest = "a".repeat(64), dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function intent() {
  const observation = { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", target: "RSI_PUBLIC_SIX_PATHS", incident: { source: "LOCAL_SYNTHETIC", baseAppSha: "a".repeat(40), workerVersion: randomUUID(), errorCode: "HTTP_STATUS", failedPaths: ["/places"] }, trigger: "scheduled", actor: "SYSTEM", sourceEventId: randomUUID(), observedAtUtc: now, observedAtKst: deriveKst(now), window: { startUtc: "2026-10-01T00:00:00.000Z", endUtc: "2026-12-01T00:00:00.000Z" }, checkedPaths: [...RSI_PUBLIC_PATHS], verdict: "FAIL", evidence: [{ evidenceId: randomUUID(), kind: "OBSERVATION", digest, verdict: "FAIL", commandId: null }] };
  return { requestId: randomUUID(), observation, lineage: { schemaVersion: 1, runId: randomUUID(), parentRunId: null, attempt: 1, incidentKey: deriveIncidentKey(observation.incident), incidentEpoch: 1, parentIncidentId: null, eventFingerprint: deriveObservationFingerprint(observation), baseAppSha: observation.incident.baseAppSha, parentAgentHash: digest, candidateAgentHash: digest, controllerHash: digest, evaluatorHash: digest, memorySnapshotHash: digest } };
}
const message = JSON.stringify({ schemaVersion: 1, task: "repair", message: "Synthetic repair only" });
async function prepare(scenarios: FakeScenario[] = []) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "rsi-broker-"))); dirs.push(dir);
  const ledger = await LocalRsiLedger.create(join(dir, "ledger"), { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", campaignId: randomUUID(), currencyUnit: "MICRO_USD", limits: { incident: 100000, campaign: 100000, day: 100000, month: 100000 } }, now);
  const checkpointSink = vi.fn(async () => {}), state = { time: 0, killed: false };
  const options = { ledger, intent: intent(), checkpointSink, nowUtc: () => now, monotonicMs: () => state.time, killSwitch: () => state.killed, scenarios };
  return { dir, ledger, state, options, checkpointSink };
}

async function setup(scenarios: FakeScenario[] = []) {
  const prepared = await prepare(scenarios);
  return { ...prepared, broker: await LocalFakeModelBroker.open(prepared.options) };
}

// Trusted fixture selection is never decoded from candidate IPC.
const fixture = (response: unknown, delayMs?: number) => ({ kind: "JSON_RESPONSE", response, ...(delayMs === undefined ? {} : { delayMs }) }) as FakeScenario;

describe("trusted LOCAL_FAKE JSON replies", () => {
  it("returns sequenced hypothesis and patch objects with the ordinary metadata envelope", async () => {
    const hypothesis = { action: "HYPOTHESIS", hypothesis: "Synthetic route repair", evidence: ["fixture"] };
    const patch = { action: "PATCH", files: [{ path: "agent.ts", content: "export default () => ({fixed:true})" }] };
    const { broker, ledger } = await setup([fixture(hypothesis), fixture(patch)]);
    const first = await broker.request(1, message), second = await broker.request(2, message);
    expect(first.untrustedOutput).toEqual(hypothesis);
    expect(second.untrustedOutput).toEqual(patch);
    expect(first.metadata).toMatchObject({ mode: "LOCAL_FAKE", sequence: 1 });
    expect(second.metadata).toMatchObject({ mode: "LOCAL_FAKE", sequence: 2 });
    expect((await broker.request(3, message)).untrustedOutput).toEqual({ action: "NO_CHANGE", reason: "LOCAL_FAKE" });
    expect((await broker.finish()).callCount).toBe(3);
    expect((await ledger.read()).runs[0].settlement?.kind).toBe("CONFIRMED");
  });
  it("snapshots nested data, scenario selection and returned objects independently at open", async () => {
    const response = { nested: { values: ["before"] } }, scenario = fixture(response);
    const scenarios = [scenario, fixture(response)];
    const { broker } = await setup(scenarios);
    response.nested.values[0] = "after";
    Object.assign(scenario, { response: { replaced: true } });
    scenarios[1] = { kind: "FAILURE" };
    const first = await broker.request(1, message);
    expect(first.untrustedOutput).toEqual({ nested: { values: ["before"] } });
    (first.untrustedOutput.nested as { values: string[] }).values[0] = "caller changed";
    expect((await broker.request(2, message)).untrustedOutput).toEqual({ nested: { values: ["before"] } });
    await broker.finish();
  });
  it("accepts exactly 2000 serialized UTF8 bytes and charges actual envelope and output bytes", async () => {
    const response = { text: "가".repeat(663) }; // 11 framing bytes + 1989 UTF8 bytes
    expect(Buffer.byteLength(JSON.stringify(response))).toBe(2000);
    const { broker, ledger } = await setup([fixture(response)]);
    expect((await broker.request(1, message)).untrustedOutput).toEqual(response);
    const envelope = JSON.stringify({ model: MODEL_POLICY.model, max_tokens: 2000, messages: [{ role: "user", content: "Synthetic repair only" }], task: "repair" });
    const expected = Math.ceil(((Buffer.byteLength(envelope) + 256) * 293 + 2000 * 2253) / 1000);
    expect((await broker.finish()).chargedUnits).toBe(expected);
    expect((await ledger.read()).runs[0].settlement?.consumedUnits).toBe(expected);
  });
  it("keeps forged usage, cost and PASS claims as untrusted data", async () => {
    const response = { action: "PASS", usage: { inputTokens: 0, outputTokens: 0 }, chargedUnits: 0, authorized: true };
    const { broker, ledger } = await setup([fixture(response)]);
    const result = await broker.request(1, message);
    expect(result).toEqual({ untrustedOutput: response, metadata: { mode: "LOCAL_FAKE", callId: expect.any(String), sequence: 1, receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect((await broker.finish()).chargedUnits).toBeGreaterThan(0);
    expect((await ledger.read()).runs[0].status).toBe("OBSERVED");
  });
  const invalidFixtures: [string, () => unknown][] = [
    ["UTF8 overflow", () => ({ text: "가".repeat(663) + "a" })],
    ["array root", () => []], ["null root", () => null], ["string root", () => "{}"],
    ["undefined", () => ({ value: undefined })], ["nonfinite", () => ({ value: Infinity })],
    ["BigInt", () => ({ value: 1n })], ["function", () => ({ value: () => ({}) })],
    ["prototype", () => ({ value: new Date() })], ["null prototype", () => Object.create(null)],
    ["cycle", () => { const value: { self?: unknown } = {}; value.self = value; return value; }],
    ["depth", () => { let value: unknown = {}; for (let i = 0; i < 13; i++) value = { child: value }; return value; }],
    ["nodes", () => ({ values: Array.from({ length: 2048 }, () => null) })],
    ["symbol key", () => ({ [Symbol("hidden")]: "value" })],
    ["sparse array", () => ({ value: new Array(1) })],
    ["hidden property", () => Object.defineProperty({}, "hidden", { value: 1 })],
    ["toJSON", () => ({ toJSON: () => ({ allowed: true }) })],
    ["dangerous key", () => JSON.parse('{"__proto__":{"polluted":true}}')],
  ];
  it.each(invalidFixtures)("rejects %s before reservation", async (_label, makeResponse) => {
    const { options, ledger, checkpointSink } = await prepare([fixture(makeResponse())]);
    const reserve = vi.spyOn(ledger, "reserve");
    await expect(LocalFakeModelBroker.open(options)).rejects.toThrow();
    expect(reserve).not.toHaveBeenCalled(); expect(checkpointSink).not.toHaveBeenCalled();
    expect((await ledger.read()).runs).toHaveLength(0);
  });
  it.each(["response", "scenario", "scenarios"])("rejects %s accessors and proxies without executing them", async boundary => {
    for (const proxy of [false, true]) {
      const executed = vi.fn(() => { throw new Error("must not execute"); });
      const wrap = (value: object) => proxy ? new Proxy(value, { get: executed, getPrototypeOf: executed, ownKeys: executed }) : Object.defineProperty(value, "trap", { enumerable: true, get: executed });
      const response = boundary === "response" ? { nested: wrap({}) } : {};
      const scenario = boundary === "scenario" ? wrap(fixture(response)) : fixture(response);
      const scenarios = boundary === "scenarios" ? wrap([scenario]) : [scenario];
      const { options, ledger } = await prepare(scenarios as FakeScenario[]);
      const reserve = vi.spyOn(ledger, "reserve");
      await expect(LocalFakeModelBroker.open(options)).rejects.toThrow();
      expect(executed).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
    }
  });
  it.each([
    { kind: "JSON_RESPONSE", response: {}, usage: { inputTokens: 0 } },
    { kind: "JSON_RESPONSE", response: {}, endpoint: "https://example.invalid" },
    { kind: "SUCCESS", response: {} }, { kind: "JSON_RESPONSE" },
  ])("rejects invalid variant authority before reserving: %j", async scenario => {
    const { options, ledger } = await prepare([scenario as FakeScenario]);
    const reserve = vi.spyOn(ledger, "reserve");
    await expect(LocalFakeModelBroker.open(options)).rejects.toThrow();
    expect(reserve).not.toHaveBeenCalled();
  });
  it("does not grant fixture or scenario selection through candidate IPC", async () => {
    const { broker } = await setup([fixture({ action: "HYPOTHESIS" })]);
    for (const [index, extra] of [{ response: {} }, { scenarios: [] }, { kind: "JSON_RESPONSE" }].entries()) {
      await expect(broker.request(index + 1, JSON.stringify({ schemaVersion: 1, task: "repair", message: "x", ...extra }))).rejects.toThrow("RSI_BROKER_INPUT");
    }
    expect((await broker.finish()).chargedUnits).toBe(0);
  });
  it("retains full-pool ambiguity for a delayed fixture timeout", async () => {
    const { broker, ledger } = await setup([fixture({ action: "PATCH" }, 31000)]); vi.useFakeTimers();
    const rejected = expect(broker.request(1, message)).rejects.toThrow("RSI_BROKER_TIMEOUT");
    await vi.advanceTimersByTimeAsync(30001); await rejected;
    expect((await broker.finish()).chargedUnits).toBe(73552);
    expect((await ledger.read()).runs[0].settlement?.kind).toBe("AMBIGUOUS");
  });
});

async function setupImprovement(scenarios: FakeScenario[] = []) {
  const prepared = await prepare(scenarios), { ledger, options } = prepared;
  const modules = { "scripts/rsi/agent/diagnostic-policy.ts": { digest, byteLength: 100 }, "scripts/rsi/agent/repair-policy.ts": { digest, byteLength: 100 } };
  await ledger.commitLabCatalog({ kind: "SEED", expectedCatalogRevision: -1, expectedCatalogHash: null,
    source: { schemaVersion: 1, modules, agentHash: deriveSourceAgentHash(modules), compiledDigest: digest, artifactDigest: digest, compiledByteLength: 200, artifactByteLength: 1000 } }, now);
  const catalog = (await ledger.readImprovement()).catalog[0], legacy = options.intent;
  const improvementIntent = { schemaVersion: 1 as const, purpose: "R4_SELF_IMPROVE" as const, executionId: randomUUID(), requestId: randomUUID(), campaignId: (await ledger.read()).config.campaignId,
    generation: 1 as const, parentExecutionId: null, expectedCatalogRevision: 0, expectedCatalogHash: catalog.hash, activeAgentHash: catalog.source.agentHash, activeCompiledDigest: digest, activeSourceArtifactDigest: digest,
    observation: legacy.observation, incidentKey: legacy.lineage.incidentKey, incidentEpoch: 1, observationFingerprint: legacy.lineage.eventFingerprint, baseAppSha: legacy.lineage.baseAppSha,
    controllerHash: digest, evaluatorHash: digest, memorySnapshotHash: digest, policyDigest: R4_POLICY_DIGEST, fakeFixtureDigest: digest };
  const improvementOptions = { ...options, intent: improvementIntent, rootTiming: { startedMs: 0, deadlineMs: 120000 } };
  const broker = await LocalFakeModelBroker.openImprovement(improvementOptions);
  return { ...prepared, options: improvementOptions, broker, executionId: improvementIntent.executionId };
}
async function beginGeneration(value: Awaited<ReturnType<typeof setupImprovement>>) {
  const phase = value.broker.phase("BASELINE_REPAIR");
  await phase.request(1, message); await phase.request(2, message);
  const input = value.options.intent;
  await value.ledger.recordImprovementEvent({ executionId: value.executionId, event: { kind: "BASELINE_VALIDATED", binding: {
    evidenceDigest: digest, controllerHash: digest, evaluatorHash: digest, memorySnapshotHash: digest, policyDigest: input.policyDigest, fakeFixtureDigest: digest } } }, now);
  await value.ledger.recordImprovementEvent({ executionId: value.executionId, event: { kind: "GENERATING" } }, now);
}

describe("R4 broker shares one pool with trusted phase capabilities", () => {
  it("uses one reservation and aggregate settlement, audits calls, and prevents generic-request bypass", async () => {
    const value = await setupImprovement(), { broker, ledger, executionId, checkpointSink } = value;
    await expect(broker.request(1, message)).rejects.toThrow("RSI_BROKER_PURPOSE");
    await beginGeneration(value);
    const generationMessage = JSON.stringify({ schemaVersion: 1, task: "improve-agent", message: "Synthetic generation" });
    for (let sequence = 3; sequence <= 6; sequence++) await broker.phase("GENERATE_AGENT").request(sequence, generationMessage);
    await expect(broker.phase("GENERATE_AGENT").request(7, generationMessage)).rejects.toThrow("RSI_BROKER_PHASE_LIMIT");
    const settle = vi.spyOn(ledger, "settleImprovement"), result = await broker.finish(), state = await ledger.readImprovement();
    expect(state.executions).toHaveLength(1); expect((await ledger.read()).runs).toHaveLength(0);
    expect(state.executions[0].maximumCostUnits).toBe(73552); expect(state.executions[0].settlement?.kind).toBe("CONFIRMED");
    expect(result.callCount).toBe(6); expect(settle).toHaveBeenCalledTimes(1);
    expect(state.executions[0].events.filter(e => e.kind === "CALL_STARTED")).toHaveLength(6);
    expect(state.executions[0].events.filter(e => e.kind === "CALL_RETURNED")).toHaveLength(6);
    expect(checkpointSink).toHaveBeenCalledTimes(14); // reserve + two events per call + aggregate
    await expect(LocalFakeModelBroker.openImprovement(value.options)).rejects.toThrow("RSI_BROKER_DUPLICATE");
    expect((await ledger.readImprovement()).executions[0].intent.executionId).toBe(executionId);
  });
  it("counts malformed requests in the phase quota and rejects phase/task authority in IPC", async () => {
    const { broker, ledger } = await setupImprovement(); const baseline = broker.phase("BASELINE_REPAIR");
    await expect(baseline.request(1, "{")).rejects.toThrow("RSI_BROKER_INPUT");
    await expect(baseline.request(2, JSON.stringify({ schemaVersion: 1, task: "repair", message: "x", phase: "GENERATE_AGENT" }))).rejects.toThrow("RSI_BROKER_INPUT");
    await expect(baseline.request(3, message)).rejects.toThrow("RSI_BROKER_PHASE_LIMIT");
    expect((await broker.finish()).callCount).toBe(2);
    expect((await ledger.readImprovement()).executions[0].events.filter(e => e.kind === "CALL_REJECTED")).toHaveLength(2);
  });
  it.each(["ledger", "checkpoint"])("dispatches zero calls and closes permanently when STARTED %s persistence fails", async failure => {
    const value = await setupImprovement([{ kind: "FAILURE" }]);
    if (failure === "ledger") vi.spyOn(value.ledger, "recordImprovementEvent").mockRejectedValueOnce(new Error("disk"));
    else value.checkpointSink.mockRejectedValueOnce(new Error("checkpoint"));
    await expect(value.broker.phase("BASELINE_REPAIR").request(1, message)).rejects.toThrow("RSI_BROKER_ACCOUNTING");
    await expect(value.broker.phase("BASELINE_REPAIR").request(2, message)).rejects.toThrow("RSI_BROKER_CLOSED");
    expect((await value.ledger.readImprovement()).executions[0].events.some(e => e.kind === "CALL_RETURNED" || (e.kind === "CALL_REJECTED" && e.usage !== "REJECTED_INPUT"))).toBe(false);
    await expect(LocalFakeModelBroker.openImprovement(value.options)).rejects.toThrow("RSI_BROKER_DUPLICATE");
  });
  it.each(["INVALID_USAGE", "LOST_RESPONSE", "FAILURE", "OVERSIZED_OUTPUT"] as const)("settles full-pool ambiguity for %s", async kind => {
    const { broker, ledger } = await setupImprovement([{ kind }]);
    await expect(broker.phase("BASELINE_REPAIR").request(1, message)).rejects.toThrow("RSI_BROKER_RESPONSE");
    expect((await broker.finish()).chargedUnits).toBe(73552);
    expect((await ledger.readImprovement()).executions[0].settlement?.kind).toBe("AMBIGUOUS");
  });
  it("records invalid JSON as rejected output with trusted confirmed cost", async () => {
    const { broker, ledger } = await setupImprovement([{ kind: "INVALID_JSON" }]);
    await expect(broker.phase("BASELINE_REPAIR").request(1, message)).rejects.toThrow("RSI_BROKER_RESPONSE");
    const receipt = await broker.finish(), row = (await ledger.readImprovement()).executions[0];
    expect(receipt.chargedUnits).toBeGreaterThan(0); expect(receipt.chargedUnits).toBeLessThan(9194);
    expect(row.settlement?.kind).toBe("CONFIRMED");
    expect(row.events.at(-1)).toMatchObject({ kind: "CALL_REJECTED", usage: "CONFIRMED", costUnits: receipt.chargedUnits });
  });
  it("shares the root deadline rather than restarting 120 seconds, and retains inflight-stop ambiguity", async () => {
    const value = await setupImprovement(); value.state.time = 119999;
    await value.broker.phase("BASELINE_REPAIR").request(1, message);
    value.state.time = 120000;
    await expect(value.broker.phase("BASELINE_REPAIR").request(2, message)).rejects.toThrow("RSI_BROKER_DEADLINE");
    await value.broker.finish();
    const stopped = await setupImprovement([{ kind: "SUCCESS", delayMs: 100 }]);
    const pending = expect(stopped.broker.phase("BASELINE_REPAIR").request(1, message)).rejects.toThrow(/RSI_BROKER_(CLOSED|TIMEOUT)/);
    stopped.broker.stop(); await pending;
    expect((await stopped.broker.finish()).chargedUnits).toBe(73552);
  });
});

describe("LOCAL_FAKE attempt budget pool", () => {
  it("reserves the entire 8-call pool before issuing a capability and settles one aggregate", async () => {
    const { broker, ledger, checkpointSink } = await setup();
    expect((await ledger.read()).runs[0].maximumCostUnits).toBe(73552);
    expect(checkpointSink).toHaveBeenCalledTimes(1);
    const response = await broker.request(1, message);
    expect(response.untrustedOutput).toEqual({ action: "NO_CHANGE", reason: "LOCAL_FAKE" });
    expect(MODEL_POLICY.mode).toBe("LOCAL_FAKE");
    const receipt = await broker.finish(); const state = await ledger.read();
    expect(state.runs).toHaveLength(1); expect(state.runs[0].status).toBe("OBSERVED");
    expect(state.runs[0].settlement?.consumedUnits).toBe(receipt.chargedUnits);
    expect(receipt.chargedUnits).toBeGreaterThan(0); expect(receipt.chargedUnits).toBeLessThan(9194);
    expect(checkpointSink).toHaveBeenCalledTimes(2);
    await expect(broker.request(2, message)).rejects.toThrow("RSI_BROKER_CLOSED");
  });
  it("never reauthorizes an existing R1 reservation after reopen", async () => {
    const { options, ledger } = await setup();
    await expect(LocalFakeModelBroker.open(options)).rejects.toThrow("RSI_BROKER_DUPLICATE");
    expect((await ledger.read()).runs).toHaveLength(1); expect((await ledger.read()).runs[0].settlement).toBeNull();
  });
  it("does not turn an incident alias with a new request/run identity into another capability", async () => {
    const {options,ledger}=await setup();
    const alias={...options.intent,requestId:randomUUID(),lineage:{...options.intent.lineage,runId:randomUUID()}};
    await expect(LocalFakeModelBroker.open({...options,intent:alias})).rejects.toThrow("RSI_BROKER_DUPLICATE");
    const state=await ledger.read();expect(state.runs).toHaveLength(1);expect(state.aliases).toHaveLength(1);
  });
  it("counts invalid IPC and retry attempts toward the eight-call cap", async () => {
    const { broker } = await setup();
    for (let i = 1; i <= 8; i++) await expect(broker.request(i, i % 2 ? "{" : JSON.stringify({ schemaVersion: 1, task: "repair", message: "x", endpoint: "http://169.254.169.254" }))).rejects.toThrow("RSI_BROKER_INPUT");
    await expect(broker.request(9, message)).rejects.toThrow("RSI_BROKER_LIMIT");
    expect((await broker.finish()).callCount).toBe(8);
  });
  it.each(["model", "endpoint", "tools", "credentials", "usage", "maximumCostUnits", "price", "checkpoint", "clock"])("rejects candidate %s authority", async field => {
    const { broker } = await setup();
    await expect(broker.request(1, JSON.stringify({ schemaVersion: 1, task: "repair", message: "x", [field]: "evil" }))).rejects.toThrow("RSI_BROKER_INPUT");
  });
  it("rejects duplicate/out-of-order calls without allowing simultaneous provider work", async () => {
    const { broker } = await setup([{ kind: "SUCCESS", delayMs: 20 }]);
    await expect(broker.request(2, message)).rejects.toThrow("RSI_BROKER_ORDER");
    const first = broker.request(1, message);
    await expect(broker.request(1, message)).rejects.toThrow("RSI_BROKER_BUSY");
    await expect(broker.request(2, message)).rejects.toThrow("RSI_BROKER_BUSY");
    await first; await expect(broker.request(1, message)).rejects.toThrow("RSI_BROKER_ORDER");
  });
  it.each(["INVALID_USAGE", "FAILURE", "LOST_RESPONSE", "OVERSIZED_OUTPUT"] as const)("consumes ambiguous full pool on %s without retry", async kind => {
    const { broker, ledger } = await setup([{ kind }]);
    await expect(broker.request(1, message)).rejects.toThrow("RSI_BROKER_RESPONSE");
    expect((await broker.finish()).chargedUnits).toBe(73552); expect((await ledger.read()).runs).toHaveLength(1); expect((await ledger.read()).runs[0].settlement?.kind).toBe("AMBIGUOUS");
  });
  it("separates confirmed usage from invalid model JSON", async () => {
    const { broker,ledger }=await setup([{kind:"INVALID_JSON"}]);
    await expect(broker.request(1,message)).rejects.toThrow("RSI_BROKER_RESPONSE");
    const receipt=await broker.finish();expect(receipt.chargedUnits).toBeGreaterThan(0);expect(receipt.chargedUnits).toBeLessThan(9194);
    expect((await ledger.read()).runs[0].settlement?.kind).toBe("CONFIRMED");
  });
  it("does not accept candidate response usage as trusted accounting", async () => {
    const { broker } = await setup([{ kind: "FORGED_USAGE" }]);
    const result = await broker.request(1, message); expect(result.untrustedOutput.usage).toBeDefined();
    expect((await broker.finish()).chargedUnits).toBeGreaterThan(0);
  });
  it("counts timeout and discards late response", async () => {
    const { broker } = await setup([{ kind: "SUCCESS", delayMs: 31000 }]); vi.useFakeTimers();
    const request = broker.request(1, message); const rejected = expect(request).rejects.toThrow("RSI_BROKER_TIMEOUT");
    await vi.advanceTimersByTimeAsync(30001); await rejected;
    expect((await broker.finish()).chargedUnits).toBe(73552);
  });
  it("enforces aggregate deadline and kill switch", async () => {
    const { broker, state } = await setup(); state.time = 120000;
    await expect(broker.request(1, message)).rejects.toThrow("RSI_BROKER_DEADLINE");
    const other = await setup(); other.state.killed = true;
    await expect(other.broker.request(1, message)).rejects.toThrow("RSI_BROKER_KILLED");
  });
  it("fails closed on checkpoint failure after reserve without releasing crash exposure", async () => {
    const { options, ledger, broker } = await setup(); await broker.finish();
    options.intent = intent(); options.checkpointSink.mockRejectedValue(new Error("sink down"));
    await expect(LocalFakeModelBroker.open(options)).rejects.toThrow("RSI_BROKER_ACCOUNTING");
    const state = await ledger.read(); expect(state.runs).toHaveLength(2);
    expect(state.runs[1].maximumCostUnits).toBe(73552); expect(state.runs[1].settlement).toBeNull();
    options.checkpointSink.mockResolvedValue(undefined);
    await expect(LocalFakeModelBroker.open(options)).rejects.toThrow("RSI_BROKER_DUPLICATE");
  });
  it("keeps the crash pool reserved across exact-checkpoint reopen", async () => {
    const { dir, ledger, options } = await setup();
    const reopened = await LocalRsiLedger.open(join(dir,"ledger"),ledger.checkpoint);
    await expect(LocalFakeModelBroker.open({...options,ledger:reopened})).rejects.toThrow("RSI_BROKER_DUPLICATE");
    expect((await reopened.read()).runs[0].settlement).toBeNull();
  });
  it("rejects over-budget pool before acquiring a broker capability", async () => {
    const { options, ledger } = await setup(); options.intent=intent();
    await expect(LocalFakeModelBroker.open(options)).rejects.toThrow("RSI_LEDGER_BUDGET");
    expect((await ledger.read()).runs).toHaveLength(1);
  });
  it("caps eight successful calls and binds aggregate count and receipts into the digest", async () => {
    const { broker, ledger } = await setup(); const settle=vi.spyOn(ledger,"settle");
    const receipts = [];
    for(let i=1;i<=8;i++) receipts.push((await broker.request(i,message)).metadata.receiptDigest);
    await expect(broker.request(9,message)).rejects.toThrow("RSI_BROKER_LIMIT");
    const result=await broker.finish(); expect(result.callCount).toBe(8);
    expect(new Set(receipts).size).toBe(8);
    expect(settle.mock.calls[0][0]).toMatchObject({kind:"CONFIRMED",receiptDigest:result.receiptDigest,chargedUnits:result.chargedUnits});
    expect(JSON.stringify((await ledger.read()).runs[0].settlement)).not.toContain("Synthetic repair only");
    await expect(broker.finish()).rejects.toThrow("RSI_BROKER_CLOSED");
  });
  it("bounds UTF8 input plus fixed framing and rejects duplicate JSON keys", async () => {
    const { broker }=await setup();
    await expect(broker.request(1,JSON.stringify({schemaVersion:1,task:"repair",message:"가".repeat(5400)}))).rejects.toThrow("RSI_BROKER_INPUT");
    await expect(broker.request(2,JSON.stringify({schemaVersion:1,task:"repair",message:"a".repeat(15800)}))).rejects.toThrow("RSI_BROKER_INPUT");
    await expect(broker.request(3,'{"schemaVersion":1,"schemaVersion":1,"task":"repair","message":"x"}')).rejects.toThrow("RSI_BROKER_INPUT");
    expect((await broker.finish()).chargedUnits).toBe(0);
  });
  it("rejects backwards trusted clock and consumes whole pool on uncertain aggregate", async () => {
    const { broker,state }=await setup();state.time=10; await broker.request(1,message);state.time=9;
    await expect(broker.request(2,message)).rejects.toThrow("RSI_BROKER_CLOCK");
    expect((await broker.finish()).chargedUnits).toBe(73552);
  });
  it("stops active work, rejects late response and retains full pool exposure", async () => {
    const { broker }=await setup([{kind:"SUCCESS",delayMs:100}]);
    const result=broker.request(1,message); const rejected=expect(result).rejects.toThrow(/RSI_BROKER_(CLOSED|TIMEOUT)/);
    await expect(broker.finish()).rejects.toThrow("RSI_BROKER_BUSY");
    broker.stop(); await rejected;
    expect((await broker.finish()).chargedUnits).toBe(73552);
  });
  it("checks kill switch during active work and preserves ambiguous full-pool charge", async () => {
    const { broker,state }=await setup([{kind:"SUCCESS",delayMs:100}]);
    const result=broker.request(1,message); const rejected=expect(result).rejects.toThrow("RSI_BROKER_KILLED");
    state.killed=true;await rejected;
    expect((await broker.finish()).chargedUnits).toBe(73552);
  });
  it("refuses further provider work if trusted ledger pool was settled outside the broker", async () => {
    const { broker,ledger,options }=await setup();
    await ledger.settle({runId:options.intent.lineage.runId,receiptId:randomUUID(),kind:"AMBIGUOUS",chargedUnits:null,receiptDigest:digest},now);
    await expect(broker.request(1,message)).rejects.toThrow("RSI_BROKER_ACCOUNTING");
    await expect(broker.request(2,message)).rejects.toThrow("RSI_BROKER_CLOSED");
  });
  it("retains reservation and closes capability on failed settlement", async () => {
    const { broker,ledger }=await setup(); await broker.request(1,message);
    vi.spyOn(ledger,"settle").mockRejectedValue(new Error("write failed"));
    await expect(broker.finish()).rejects.toThrow("RSI_BROKER_ACCOUNTING");
    expect((await ledger.read()).runs[0].settlement).toBeNull();
    await expect(broker.request(2,message)).rejects.toThrow("RSI_BROKER_CLOSED");
  });
  it("closes permanently on settlement checkpoint failure", async () => {
    const { broker, checkpointSink } = await setup(); await broker.request(1, message);
    checkpointSink.mockRejectedValue(new Error("sink down"));
    await expect(broker.finish()).rejects.toThrow("RSI_BROKER_ACCOUNTING");
    await expect(broker.request(2, message)).rejects.toThrow("RSI_BROKER_CLOSED");
  });
});
