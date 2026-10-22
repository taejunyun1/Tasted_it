import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRsiLedger } from "../../scripts/rsi/ledger";
import { deriveIncidentKey, deriveKst, deriveObservationFingerprint, RSI_PUBLIC_PATHS } from "../../scripts/rsi/contracts";
import { LocalFakeModelBroker, MODEL_POLICY, type FakeScenario } from "../../scripts/rsi/model-broker";

const now = "2026-10-22T00:00:00.000Z", digest = "a".repeat(64), dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function intent() {
  const observation = { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", target: "RSI_PUBLIC_SIX_PATHS", incident: { source: "LOCAL_SYNTHETIC", baseAppSha: "a".repeat(40), workerVersion: randomUUID(), errorCode: "HTTP_STATUS", failedPaths: ["/places"] }, trigger: "scheduled", actor: "SYSTEM", sourceEventId: randomUUID(), observedAtUtc: now, observedAtKst: deriveKst(now), window: { startUtc: "2026-10-01T00:00:00.000Z", endUtc: "2026-12-01T00:00:00.000Z" }, checkedPaths: [...RSI_PUBLIC_PATHS], verdict: "FAIL", evidence: [{ evidenceId: randomUUID(), kind: "OBSERVATION", digest, verdict: "FAIL", commandId: null }] };
  return { requestId: randomUUID(), observation, lineage: { schemaVersion: 1, runId: randomUUID(), parentRunId: null, attempt: 1, incidentKey: deriveIncidentKey(observation.incident), incidentEpoch: 1, parentIncidentId: null, eventFingerprint: deriveObservationFingerprint(observation), baseAppSha: observation.incident.baseAppSha, parentAgentHash: digest, candidateAgentHash: digest, controllerHash: digest, evaluatorHash: digest, memorySnapshotHash: digest } };
}
const message = JSON.stringify({ schemaVersion: 1, task: "repair", message: "Synthetic repair only" });
async function setup(scenarios: FakeScenario[] = []) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "rsi-broker-"))); dirs.push(dir);
  const ledger = await LocalRsiLedger.create(join(dir, "ledger"), { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", campaignId: randomUUID(), currencyUnit: "MICRO_USD", limits: { incident: 100000, campaign: 100000, day: 100000, month: 100000 } }, now);
  const checkpointSink = vi.fn(async () => {}), state = { time: 0, killed: false };
  const options = { ledger, intent: intent(), checkpointSink, nowUtc: () => now, monotonicMs: () => state.time, killSwitch: () => state.killed, scenarios };
  return { dir, ledger, state, options, checkpointSink, broker: await LocalFakeModelBroker.open(options) };
}

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
