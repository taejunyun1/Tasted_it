import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRsiLedger } from "../../scripts/rsi/ledger";
import { deriveIncidentId, deriveIncidentKey, deriveKst, deriveObservationFingerprint, RSI_PUBLIC_PATHS } from "../../scripts/rsi/contracts";

const digest = "a".repeat(64);
const now = "2026-10-22T14:59:00.000Z";
const limits = { incident: 100, campaign: 200, day: 100, month: 150 };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function path() { const dir = await mkdtemp(join(tmpdir(), "rsi-ledger-")); dirs.push(dir); return join(await realpath(dir), "store"); }
function observation(time = now) {
  return { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", target: "RSI_PUBLIC_SIX_PATHS",
    incident: { source: "LOCAL_SYNTHETIC", baseAppSha: "a".repeat(40), workerVersion: "11111111-1111-4111-8111-111111111111", errorCode: "HTTP_STATUS", failedPaths: ["/places"] },
    trigger: "scheduled", actor: "SYSTEM", sourceEventId: randomUUID(), observedAtUtc: time, observedAtKst: deriveKst(time),
    window: { startUtc: "2026-10-01T00:00:00.000Z", endUtc: "2026-12-01T00:00:00.000Z" },
    checkedPaths: [...RSI_PUBLIC_PATHS], verdict: "FAIL", evidence: [{ evidenceId: randomUUID(), kind: "OBSERVATION", digest, verdict: "FAIL", commandId: null }] };
}
function intent(cost = 40, obs = observation()) {
  return { requestId: randomUUID(), maximumCostUnits: cost, observation: obs,
    lineage: { schemaVersion: 1, runId: randomUUID(), parentRunId: null, attempt: 1, incidentKey: deriveIncidentKey(obs.incident), incidentEpoch: 1, parentIncidentId: null, eventFingerprint: deriveObservationFingerprint(obs), baseAppSha: obs.incident.baseAppSha, parentAgentHash: digest, candidateAgentHash: digest, controllerHash: digest, evaluatorHash: digest, memorySnapshotHash: digest } };
}
const evidence = () => ({ evidenceId: randomUUID(), kind: "OUTCOME", digest, verdict: "FAIL", commandId: null });
const terminal = () => ({ schemaVersion: 1, from: "OBSERVED", to: "INCONCLUSIVE", reasonCode: "EVIDENCE_UNKNOWN", evidence: [evidence()] });
async function create(p: string, caps = limits) { return LocalRsiLedger.create(p, { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", campaignId: "22222222-2222-4222-8222-222222222222", currencyUnit: "MICRO_USD", limits: caps }, now); }
async function finish(ledger: LocalRsiLedger, runId: string, time = now) {
  await ledger.settle({ runId, receiptId: randomUUID(), kind: "AMBIGUOUS", chargedUnits: null, receiptDigest: digest }, time);
  await ledger.transition({ runId, transition: terminal() }, time);
}

describe("local RSI ledger", () => {
  it("requires explicit creation and exact trusted checkpoint on reopen, preserving config and reservation", async () => {
    const p = await path(); await expect(LocalRsiLedger.open(p, { revision: 0, hash: digest })).rejects.toThrow("RSI_LEDGER");
    const ledger = await create(p); const input = intent();
    const result = await ledger.reserve(input, now); expect(result.authorized).toBe(true);
    await expect(create(p)).rejects.toThrow("RSI_LEDGER");
    const reopened = await LocalRsiLedger.open(p, ledger.checkpoint);
    expect((await reopened.read()).config.limits).toEqual(limits);
    expect((await reopened.read()).runs[0].maximumCostUnits).toBe(40);
    await expect(LocalRsiLedger.open(p, { revision: 0, hash: digest })).rejects.toThrow("RSI_LEDGER");
    await rm(p, { recursive: true });
    await expect(reopened.read()).rejects.toThrow("RSI_LEDGER");
  });

  it("deduplicates run/request and incident despite changed run/event/window identities", async () => {
    const p = await path(); const ledger = await create(p); const input = intent();
    await ledger.reserve(input, now); const checkpoint = ledger.checkpoint;
    expect((await ledger.reserve(input, now)).authorized).toBe(false);
    expect(ledger.checkpoint).toEqual(checkpoint);
    const duplicate = await ledger.reserve(intent(), now);
    expect(duplicate.authorized).toBe(false); expect(duplicate.runId).toBe(input.lineage.runId);
    const reopened = await LocalRsiLedger.open(p, ledger.checkpoint);
    expect((await reopened.reserve(input, now)).authorized).toBe(false);
    await expect(reopened.reserve({ ...input, maximumCostUnits: 41 }, now)).rejects.toThrow("RSI_LEDGER");
    await expect(reopened.reserve({ ...intent(), requestId: input.requestId }, now)).rejects.toThrow("RSI_LEDGER");
  });

  it("persists changed incident aliases so their request/run IDs cannot later authorize another incident", async () => {
    const p = await path(); const ledger = await create(p); const first = intent(); await ledger.reserve(first, now);
    const alias = intent(); expect((await ledger.reserve(alias, now)).authorized).toBe(false);
    const reopened = await LocalRsiLedger.open(p, ledger.checkpoint);
    expect((await reopened.reserve(alias, now)).runId).toBe(first.lineage.runId);
    const other = intent(); other.observation.incident.workerVersion = randomUUID();
    other.lineage.incidentKey = deriveIncidentKey(other.observation.incident);
    other.lineage.eventFingerprint = deriveObservationFingerprint(other.observation);
    await expect(reopened.reserve({ ...other, requestId: alias.requestId }, now)).rejects.toThrow("RSI_LEDGER");
    await expect(reopened.reserve({ ...other, lineage: { ...other.lineage, runId: alias.lineage.runId } }, now)).rejects.toThrow("RSI_LEDGER");
    expect((await reopened.read()).aliases).toHaveLength(1);
  });

  it("permits only one concurrent writer and rejects stale revision without budget double spending", async () => {
    const p = await path(); const a = await create(p); const b = await LocalRsiLedger.open(p, a.checkpoint);
    const results = await Promise.allSettled([a.reserve(intent(), now), b.reserve(intent(), now)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = results[0].status === "fulfilled" ? a : b; const loser = winner === a ? b : a;
    await expect(loser.reserve(intent(), now)).rejects.toThrow("RSI_LEDGER");
    expect((await winner.read()).runs).toHaveLength(1);
  });

  it("rejects orphan parents, active-parent retries and mismatched observation/lineage", async () => {
    const ledger = await create(await path()); const input = intent();
    await expect(ledger.reserve({ ...input, lineage: { ...input.lineage, eventFingerprint: "b".repeat(64) } }, now)).rejects.toThrow("RSI_LEDGER");
    await expect(ledger.reserve({ ...input, lineage: { ...input.lineage, baseAppSha: "b".repeat(40) } }, now)).rejects.toThrow("RSI_LEDGER");
    const retry = { ...intent(), lineage: { ...input.lineage, runId: randomUUID(), parentRunId: input.lineage.runId, attempt: 2 }, observation: input.observation };
    await expect(ledger.reserve(retry, now)).rejects.toThrow("RSI_LEDGER");
    await ledger.reserve(input, now); await expect(ledger.reserve(retry, now)).rejects.toThrow("RSI_LEDGER");
    await finish(ledger, input.lineage.runId);
    expect((await ledger.reserve(retry, now)).authorized).toBe(true);
    expect((await ledger.read()).runs[0].transitions[0].to).toBe("INCONCLUSIVE");
  });

  it("requires persisted recovery/closure before a linked later recurrence and retains incident spending", async () => {
    const ledger = await create(await path()); const input = intent(60); await ledger.reserve(input, now);
    const later = "2026-10-22T15:01:00.000Z"; const next = intent(50, observation(later));
    next.lineage.incidentEpoch = 2; next.lineage.parentIncidentId = deriveIncidentId({ incidentKey: input.lineage.incidentKey, incidentEpoch: 1 }) as never;
    await expect(ledger.reserve(next, later)).rejects.toThrow("RSI_LEDGER");
    await finish(ledger, input.lineage.runId);
    await ledger.closeIncident({ incidentKey: input.lineage.incidentKey, incidentEpoch: 1, evidence: { evidenceId: randomUUID(), kind: "LIVE_PROBE", digest, verdict: "PASS", commandId: null } }, now);
    await expect(ledger.reserve(next, later)).rejects.toThrow("RSI_LEDGER_BUDGET");
    next.maximumCostUnits = 40; expect((await ledger.reserve(next, later)).authorized).toBe(true);
    expect((await ledger.read()).closures).toHaveLength(1);
  });

  it("counts pending reservations on the new KST day/month until settled", async () => {
    const ledger = await LocalRsiLedger.create(await path(), { schemaVersion: 1, environment: "LOCAL_SYNTHETIC", campaignId: randomUUID(), currencyUnit: "MICRO_USD", limits: { incident: 1000, campaign: 1000, day: 100, month: 100 } }, "2026-10-31T14:58:00.000Z");
    const first = intent(80, observation("2026-10-31T14:59:00.000Z")); await ledger.reserve(first, first.observation.observedAtUtc);
    const second = intent(30, observation("2026-10-31T15:00:00.000Z")); second.observation.incident.workerVersion = randomUUID(); second.lineage.incidentKey = deriveIncidentKey(second.observation.incident); second.lineage.eventFingerprint = deriveObservationFingerprint(second.observation);
    await expect(ledger.reserve(second, second.observation.observedAtUtc)).rejects.toThrow("RSI_LEDGER_BUDGET");
    await ledger.settle({ runId: first.lineage.runId, receiptId: randomUUID(), kind: "CONFIRMED", chargedUnits: 10, receiptDigest: digest }, second.observation.observedAtUtc);
    expect((await ledger.reserve(second, second.observation.observedAtUtc)).authorized).toBe(true);
    expect((await ledger.read()).runs[0].settlement?.day).toBe("2026-11-01");
  });

  it("settles receipts idempotently, consumes ambiguous maximum, and rejects unknown/conflicting receipt", async () => {
    const p = await path(); const ledger = await create(p); const input = intent(); await ledger.reserve(input, now);
    const receipt = { runId: input.lineage.runId, receiptId: randomUUID(), kind: "AMBIGUOUS", chargedUnits: null, receiptDigest: digest };
    await ledger.settle(receipt, now); const reopened = await LocalRsiLedger.open(p, ledger.checkpoint);
    await reopened.settle(receipt, now); expect((await reopened.read()).runs[0].settlement?.consumedUnits).toBe(40);
    await expect(reopened.settle({ ...receipt, kind: "CONFIRMED", chargedUnits: 1 }, now)).rejects.toThrow("RSI_LEDGER");
    await expect(reopened.settle({ ...receipt, runId: randomUUID() }, now)).rejects.toThrow("RSI_LEDGER");
  });

  it.each(["incident", "campaign", "day", "month"] as const)("enforces cumulative %s caps across reopen", async (cap) => {
    const p = await path(); const caps = { incident: 1000, campaign: 1000, day: 1000, month: 1000, [cap]: 100 };
    const ledger = await create(p, caps), first = intent(80); await ledger.reserve(first, now); await finish(ledger, first.lineage.runId);
    const reopened = await LocalRsiLedger.open(p, ledger.checkpoint); const next = intent(21, first.observation);
    if (cap === "incident") next.lineage = { ...next.lineage, parentRunId: first.lineage.runId as never, attempt: 2 };
    else {
      next.observation = observation(); next.observation.incident.workerVersion = randomUUID();
      next.lineage.incidentKey = deriveIncidentKey(next.observation.incident); next.lineage.eventFingerprint = deriveObservationFingerprint(next.observation);
    }
    await expect(reopened.reserve(next, now)).rejects.toThrow("RSI_LEDGER_BUDGET");
    next.maximumCostUnits = 20; expect((await reopened.reserve(next, now)).authorized).toBe(true);
  });

  it("handles maximum safe integer amounts exactly and fails closed on addition overflow", async () => {
    const caps = { incident: Number.MAX_SAFE_INTEGER, campaign: Number.MAX_SAFE_INTEGER, day: Number.MAX_SAFE_INTEGER, month: Number.MAX_SAFE_INTEGER };
    const ledger = await create(await path(), caps), first = intent(Number.MAX_SAFE_INTEGER);
    await ledger.reserve(first, now); await finish(ledger, first.lineage.runId);
    const next = intent(1, first.observation); next.lineage = { ...next.lineage, parentRunId: first.lineage.runId as never, attempt: 2 };
    await expect(ledger.reserve(next, now)).rejects.toThrow("RSI_LEDGER_BUDGET");
    expect((await ledger.read()).runs[0].settlement?.consumedUnits).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects invalid, oversized, duplicate and mismatched receipt data without releasing reservation", async () => {
    const ledger = await create(await path()); const first = intent(); await ledger.reserve(first, now);
    const receipt = { runId: first.lineage.runId, receiptId: randomUUID(), kind: "CONFIRMED", chargedUnits: 41, receiptDigest: digest };
    for (const bad of [receipt, { ...receipt, chargedUnits: -1 }, { ...receipt, chargedUnits: 0.5 }, { ...receipt, chargedUnits: null }, { ...receipt, kind: "AMBIGUOUS", chargedUnits: 1 }, { ...receipt, chargedUnits: 1, body: "private-value" }]) {
      await expect(ledger.settle(bad, now)).rejects.toThrow("RSI_LEDGER");
    }
    expect((await ledger.read()).runs[0].settlement).toBe(null);
    receipt.chargedUnits = 1; await ledger.settle(receipt, now); await ledger.transition({ runId: first.lineage.runId, transition: terminal() }, now);
    const next = intent(1, first.observation); next.lineage = { ...next.lineage, parentRunId: first.lineage.runId as never, attempt: 2 }; await ledger.reserve(next, now);
    await expect(ledger.settle({ ...receipt, runId: next.lineage.runId }, now)).rejects.toThrow("RSI_LEDGER");
  });

  it("requires terminal settlement to close an epoch and preserves rejected evidence", async () => {
    const ledger = await create(await path()); const first = intent(); await ledger.reserve(first, now);
    const close = { incidentKey: first.lineage.incidentKey, incidentEpoch: 1, evidence: { ...evidence(), kind: "LIVE_PROBE", verdict: "PASS" } };
    await expect(ledger.closeIncident(close, now)).rejects.toThrow("RSI_LEDGER");
    await ledger.transition({ runId: first.lineage.runId, transition: { ...terminal(), to: "REJECTED", reasonCode: "POLICY_REJECTED" } }, now);
    await expect(ledger.closeIncident(close, now)).rejects.toThrow("RSI_LEDGER");
    await ledger.settle({ runId: first.lineage.runId, receiptId: randomUUID(), kind: "AMBIGUOUS", chargedUnits: null, receiptDigest: digest }, now);
    await expect(ledger.closeIncident({ ...close, evidence: { ...close.evidence, verdict: "UNKNOWN" } }, now)).rejects.toThrow("RSI_LEDGER");
    await ledger.closeIncident(close, now); const head = ledger.checkpoint; await ledger.closeIncident(close, now); expect(ledger.checkpoint).toEqual(head);
    expect((await ledger.read()).runs[0].transitions[0].reasonCode).toBe("POLICY_REJECTED");
    const next = intent(1, first.observation); next.lineage = { ...next.lineage, parentRunId: first.lineage.runId as never, attempt: 2 };
    await expect(ledger.reserve(next, now)).rejects.toThrow("RSI_LEDGER");
  });

  it.each([0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])("rejects invalid reservation amount %s", async (amount) => {
    const ledger = await create(await path()); await expect(ledger.reserve(intent(amount), now)).rejects.toThrow("RSI_LEDGER");
  });

  it("fails closed on caps overflow, backwards clock, future observations, unknown fields and illegal transitions", async () => {
    const ledger = await create(await path()); const input = intent();
    await expect(ledger.reserve({ ...input, token: "sensitive-value" }, now)).rejects.toThrow("RSI_LEDGER");
    await expect(ledger.reserve(intent(101), now)).rejects.toThrow("RSI_LEDGER_BUDGET");
    await expect(ledger.reserve(input, "2026-10-22T14:58:00.000Z")).rejects.toThrow("RSI_LEDGER");
    await expect(ledger.reserve(intent(1, observation("2026-10-22T15:00:00.000Z")), now)).rejects.toThrow("RSI_LEDGER");
    await ledger.reserve(input, now);
    await expect(ledger.transition({ runId: input.lineage.runId, transition: { ...terminal(), from: "TRIAGED" } }, now)).rejects.toThrow("RSI_LEDGER");
  });

  it.each(["truncate", "tamper", "unknown-schema", "temp", "lock", "missing-revision", "oversized", "unknown-file", "duplicate-json-key"]) ("rejects %s persisted state on reopen", async (mode) => {
    const p = await path(); const ledger = await create(p); await ledger.reserve(intent(), now);
    const files = (await readdir(p)).filter((f) => f.endsWith(".json")).sort(); const last = join(p, files[files.length - 1]);
    if (mode === "truncate") await writeFile(last, "{\"schemaVersion\":");
    if (mode === "tamper") await writeFile(last, (await readFile(last, "utf8")).replace('"maximumCostUnits":40', '"maximumCostUnits":1'));
    if (mode === "unknown-schema") await writeFile(last, (await readFile(last, "utf8")).replace('"schemaVersion":1', '"schemaVersion":99'));
    if (mode === "temp") await writeFile(join(p, ".pending"), "partial");
    if (mode === "lock") await mkdir(join(p, ".writer-lock"));
    if (mode === "duplicate-json-key") await writeFile(last, (await readFile(last, "utf8")).replace('{"schemaVersion":1', '{"schemaVersion":99,"schemaVersion":1'));
    if (mode === "oversized") await writeFile(last, " ".repeat(262_145));
    if (mode === "unknown-file") await writeFile(join(p, "unknown.json"), "{}");
    if (mode === "missing-revision") await rm(join(p, files[0]));
    await expect(LocalRsiLedger.open(p, ledger.checkpoint)).rejects.toThrow("RSI_LEDGER");
  });

  it("rejects replaced root inode and creation through a symlink ancestor", async () => {
    const p = await path(); const ledger = await create(p); const parent = join(p, "nested");
    const linkPath = `${p}-alias`; await symlink(p, linkPath);
    await expect(create(join(linkPath, "nested"))).rejects.toThrow("RSI_LEDGER");
    await mkdir(parent, { mode: 0o700 }); await expect(ledger.read()).rejects.toThrow("RSI_LEDGER");
    await rm(p, { recursive: true }); await mkdir(p, { mode: 0o700 });
    await expect(ledger.read()).rejects.toThrow("RSI_LEDGER");
  });

  it("rejects symlink roots, symlink files, path traversal and root replacement", async () => {
    const p = await path(); const ledger = await create(p); const alias = `${p}-link`; await symlink(p, alias);
    await expect(LocalRsiLedger.open(alias, ledger.checkpoint)).rejects.toThrow("RSI_LEDGER");
    await expect(LocalRsiLedger.open(`${p}/../store`, ledger.checkpoint)).rejects.toThrow("RSI_LEDGER");
    const file = (await readdir(p))[0]; const original = await readFile(join(p, file)); const outside = `${p}-outside`; await writeFile(outside, original); await rm(join(p, file)); await symlink(outside, join(p, file));
    await expect(ledger.read()).rejects.toThrow("RSI_LEDGER");
  });
});
