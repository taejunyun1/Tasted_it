import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRsiLedger } from "../../scripts/rsi/ledger";
import { deriveIncidentId, deriveIncidentKey, deriveKst, deriveObservationFingerprint, RSI_PUBLIC_PATHS } from "../../scripts/rsi/contracts";
import { R4_POLICY_DIGEST, deriveSourceAgentHash, parseImprovementIntent } from "../../scripts/rsi/execution-contracts";

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
    await ledger.closeIncident({ kind: "RECOVERY_CONFIRMED", incidentKey: input.lineage.incidentKey, incidentEpoch: 1, evidence: { evidenceId: randomUUID(), kind: "LIVE_PROBE", digest, verdict: "PASS", commandId: null } }, now);
    await expect(ledger.reserve(next, later)).rejects.toThrow("RSI_LEDGER_BUDGET");
    next.maximumCostUnits = 40; expect((await ledger.reserve(next, later)).authorized).toBe(true);
    expect((await ledger.read()).closures).toHaveLength(1);
  });

  it("persists operator closure without recovery evidence and preserves caps for later linked recurrence", async () => {
    const p = await path(), ledger = await create(p), first = intent(60); await ledger.reserve(first, now);
    const close = { kind: "OPERATOR_CLOSED", incidentKey: first.lineage.incidentKey, incidentEpoch: 1,
      authorization: { ...evidence(), kind: "AUTHORIZATION", verdict: "PASS" },
      evidence: { ...evidence(), kind: "OUTCOME", verdict: "PASS" } };
    await expect(ledger.closeIncident(close, now)).rejects.toThrow("RSI_LEDGER");
    await ledger.transition({ runId: first.lineage.runId, transition: { ...terminal(), reasonCode: "OPERATOR_STOP" } }, now);
    await expect(ledger.closeIncident(close, now)).rejects.toThrow("RSI_LEDGER");
    await ledger.settle({ runId: first.lineage.runId, receiptId: randomUUID(), kind: "AMBIGUOUS", chargedUnits: null, receiptDigest: digest }, now);
    await ledger.closeIncident(close, now);
    const reopened = await LocalRsiLedger.open(p, ledger.checkpoint), head = reopened.checkpoint;
    await reopened.closeIncident(close, now); expect(reopened.checkpoint).toEqual(head);
    await expect(reopened.closeIncident({ ...close, authorization: { ...close.authorization, evidenceId: randomUUID() } }, now)).rejects.toThrow("RSI_LEDGER");
    const state = await reopened.read(); expect(state.closures[0].kind).toBe("OPERATOR_CLOSED");
    expect(state.runs[0].status).toBe("INCONCLUSIVE");
    expect(state.runs[0].transitions[0].reasonCode).toBe("OPERATOR_STOP");
    expect(state.runs[0].transitions.flatMap((t) => t.evidence).every((e) => e.kind !== "LIVE_PROBE")).toBe(true);
    const later = "2026-10-22T15:01:00.000Z", next = intent(50, observation(later));
    next.lineage.incidentEpoch = 2; next.lineage.parentIncidentId = deriveIncidentId({ incidentKey: first.lineage.incidentKey, incidentEpoch: 1 }) as never;
    await expect(reopened.reserve({ ...next, lineage: { ...next.lineage, parentIncidentId: digest } }, later)).rejects.toThrow("RSI_LEDGER");
    const staleObservation = intent(1, first.observation);
    staleObservation.lineage.incidentEpoch = 2; staleObservation.lineage.parentIncidentId = next.lineage.parentIncidentId;
    await expect(reopened.reserve(staleObservation, later)).rejects.toThrow("RSI_LEDGER");
    await expect(reopened.reserve(next, later)).rejects.toThrow("RSI_LEDGER_BUDGET");
    next.maximumCostUnits = 40; expect((await reopened.reserve(next, later)).authorized).toBe(true);
    expect((await reopened.read()).runs).toHaveLength(2);
    expect((await reopened.read()).config.limits).toEqual(limits);
  });

  it("requires distinct valid operator authorization and closure receipts", async () => {
    const ledger = await create(await path()), first = intent(); await ledger.reserve(first, now); await finish(ledger, first.lineage.runId);
    const close = { kind: "OPERATOR_CLOSED", incidentKey: first.lineage.incidentKey, incidentEpoch: 1,
      authorization: { ...evidence(), kind: "AUTHORIZATION", verdict: "PASS" }, evidence: { ...evidence(), kind: "OUTCOME", verdict: "PASS" } };
    const { authorization, ...missing } = close;
    for (const invalid of [missing,
      { ...close, authorization: { ...authorization, kind: "OBSERVATION" } },
      { ...close, authorization: { ...authorization, verdict: "UNKNOWN" } },
      { ...close, authorization: { ...authorization, verdict: "FAIL" } },
      { ...close, authorization: { ...authorization, evidenceId: close.evidence.evidenceId } },
      { ...close, evidence: { ...close.evidence, verdict: "UNKNOWN" } },
      { ...close, evidence: { ...close.evidence, kind: "LIVE_PROBE" } },
      { ...close, operatorName: "private-value" },
      { ...close, kind: "RECOVERY_CONFIRMED" },
    ]) await expect(ledger.closeIncident(invalid, now)).rejects.toThrow("RSI_LEDGER");
    expect((await ledger.read()).closures).toEqual([]);
    await ledger.closeIncident(close, now); expect((await ledger.read()).closures).toHaveLength(1);
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
    const close = { kind: "RECOVERY_CONFIRMED", incidentKey: first.lineage.incidentKey, incidentEpoch: 1, evidence: { ...evidence(), kind: "LIVE_PROBE", verdict: "PASS" } };
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

// These are trusted-writer structural fixtures, never actual container evidence.
const campaignId = "22222222-2222-4222-8222-222222222222";
function artifact(letter = "a") {
  const modules = { "scripts/rsi/agent/diagnostic-policy.ts": { digest: letter.repeat(64), byteLength: 100 },
    "scripts/rsi/agent/repair-policy.ts": { digest: "e".repeat(64), byteLength: 100 } };
  return { schemaVersion: 1 as const, modules, agentHash: deriveSourceAgentHash(modules), compiledDigest: letter.repeat(64), artifactDigest: letter.repeat(64), compiledByteLength: 200, artifactByteLength: 1000 };
}
async function improvement(ledger: LocalRsiLedger, obs = observation()) {
  const catalog = (await ledger.readImprovement()).catalog.at(-1)!;
  return { schemaVersion: 1 as const, purpose: "R4_SELF_IMPROVE" as const, executionId: randomUUID(), requestId: randomUUID(), campaignId,
    generation: 1 as 1 | 2, parentExecutionId: null as string | null, expectedCatalogRevision: catalog.revision, expectedCatalogHash: catalog.hash,
    activeAgentHash: catalog.source.agentHash, activeCompiledDigest: catalog.source.compiledDigest, activeSourceArtifactDigest: catalog.source.artifactDigest,
    observation: obs, incidentKey: deriveIncidentKey(obs.incident), incidentEpoch: 1, observationFingerprint: deriveObservationFingerprint(obs), baseAppSha: obs.incident.baseAppSha,
    controllerHash: digest, evaluatorHash: digest, memorySnapshotHash: digest, policyDigest: R4_POLICY_DIGEST, fakeFixtureDigest: digest };
}
async function seed(ledger: LocalRsiLedger) {
  await ledger.commitLabCatalog({ kind: "SEED", expectedCatalogRevision: -1, expectedCatalogHash: null, source: artifact() }, now);
}
async function createImprovement(caps = { incident: 500000, campaign: 500000, day: 500000, month: 500000 }) {
  const p = await path(), ledger = await create(p, caps); await seed(ledger); return { p, ledger, input: await improvement(ledger) };
}
function validation(input: Awaited<ReturnType<typeof improvement>>) {
  return { evidenceDigest: digest, controllerHash: input.controllerHash, evaluatorHash: input.evaluatorHash,
    memorySnapshotHash: input.memorySnapshotHash, policyDigest: input.policyDigest, fakeFixtureDigest: input.fakeFixtureDigest };
}
async function call(ledger: LocalRsiLedger, executionId: string, sequence: number, phase: "BASELINE_REPAIR" | "GENERATE_AGENT" | "PROMOTION_REPAIR", at = now) {
  const callId = randomUUID();
  await ledger.recordImprovementEvent({ executionId, event: { kind: "CALL_STARTED", sequence, phase, callId, requestDigest: digest } }, at);
  await ledger.recordImprovementEvent({ executionId, event: { kind: "CALL_RETURNED", sequence, callId, receiptDigest: digest, outputDigest: digest, costUnits: 1 } }, at);
  return callId;
}
async function validated(ledger: LocalRsiLedger, input: Awaited<ReturnType<typeof improvement>>, source = artifact("b")) {
  const executionId = input.executionId;
  await ledger.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, now);
  if (input.generation === 1) {
    await call(ledger, executionId, 1, "BASELINE_REPAIR"); await call(ledger, executionId, 2, "BASELINE_REPAIR");
    await ledger.recordImprovementEvent({ executionId, event: { kind: "BASELINE_VALIDATED", binding: validation(input) } }, now);
  }
  await ledger.recordImprovementEvent({ executionId, event: { kind: "GENERATING" } }, now);
  const sequence = input.generation === 1 ? 3 : 1, callId = await call(ledger, executionId, sequence, "GENERATE_AGENT");
  await ledger.recordImprovementEvent({ executionId, event: { kind: "PROPOSED", source, generationBinding: {
    executionId, activeAgentHash: input.activeAgentHash, activeCompiledDigest: input.activeCompiledDigest,
    sequence, callId, brokerRequestDigest: digest, brokerReceiptDigest: digest, brokerOutputDigest: digest,
    actualInputDigest: digest, actualOutputDigest: digest, generationEvidenceDigest: digest } } }, now);
  await ledger.recordImprovementEvent({ executionId, event: { kind: "PROBING" } }, now);
  await call(ledger, executionId, sequence + 1, "PROMOTION_REPAIR"); await call(ledger, executionId, sequence + 2, "PROMOTION_REPAIR");
  await ledger.recordImprovementEvent({ executionId, event: { kind: "VALIDATED", binding: validation(input) } }, now);
}
async function settleImprovement(ledger: LocalRsiLedger, executionId: string, kind: "CONFIRMED" | "AMBIGUOUS" = "CONFIRMED", chargedUnits = 5, at = now, receiptId = randomUUID()) {
  await ledger.settleImprovement({ executionId, receiptId, kind, chargedUnits: kind === "AMBIGUOUS" ? null : chargedUnits, receiptDigest: digest }, at);
}
async function promote(ledger: LocalRsiLedger, input: Awaited<ReturnType<typeof improvement>>) {
  await ledger.commitLabCatalog({ kind: "PROMOTE", executionId: input.executionId, expectedCatalogRevision: input.expectedCatalogRevision,
    expectedCatalogHash: input.expectedCatalogHash, source: artifact(input.generation === 1 ? "b" : "c"), binding: validation(input), settlementDigest: digest }, now);
}

describe("R4 execution contracts on the same ledger", () => {
  it("preserves legacy shape and bytes while persisting a distinct execution and immutable seed", async () => {
    const p = await path(), ledger = await create(p), bytes = await readFile(join(p, "00000.json"), "utf8"); await seed(ledger);
    const input = await improvement(ledger);
    await expect(ledger.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, now)).rejects.toThrow("RSI_LEDGER_BUDGET");
    expect(Object.keys(await ledger.read())).toEqual(["config", "lastAtUtc", "runs", "aliases", "closures"]);
    expect(await readFile(join(p, "00000.json"), "utf8")).toBe(bytes);
    expect((await ledger.readImprovement()).catalog[0].kind).toBe("SEED");
    await expect(seed(ledger)).rejects.toThrow("RSI_LEDGER");
  });
  it("deduplicates exact intent, rejects changed identities, spent generation slots and parent/CAS mismatches", async () => {
    const { ledger, input, p } = await createImprovement();
    expect((await ledger.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, now)).authorized).toBe(true);
    const head = ledger.checkpoint;
    expect((await ledger.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, now)).authorized).toBe(false);
    expect(ledger.checkpoint).toEqual(head);
    for (const bad of [{ ...input, fakeFixtureDigest: "b".repeat(64) }, { ...input, executionId: randomUUID(), requestId: randomUUID() },
      { ...input, requestId: input.executionId }, { ...input, expectedCatalogHash: digest }, { ...input, generation: 2, parentExecutionId: randomUUID() }]) {
      await expect(ledger.reserveImprovement({ intent: bad, maximumCostUnits: 73552 }, now)).rejects.toThrow("RSI_LEDGER");
    }
    const reopened = await LocalRsiLedger.open(p, ledger.checkpoint);
    expect((await reopened.readImprovement()).executions).toHaveLength(1);
    await expect(reopened.reserveImprovement({ intent: { ...input, executionId: randomUUID(), requestId: randomUUID() }, maximumCostUnits: 73552 }, now)).rejects.toThrow("RSI_LEDGER");
  });
  it.each(["incident", "campaign", "day", "month"] as const)("combines R1 and R4 pending/ambiguous exposure under %s caps in both directions", async cap => {
    const caps = { incident: 500000, campaign: 500000, day: 500000, month: 500000, [cap]: 73600 };
    const { ledger, input } = await createImprovement(caps), legacy = intent(49, input.observation);
    await ledger.reserve(legacy, now);
    await expect(ledger.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, now)).rejects.toThrow("RSI_LEDGER_BUDGET");
    await ledger.settle({ runId: legacy.lineage.runId, receiptId: randomUUID(), kind: "CONFIRMED", chargedUnits: 48, receiptDigest: digest }, now);
    await ledger.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, now);
    await settleImprovement(ledger, input.executionId, "AMBIGUOUS");
    const other = intent(1); other.observation.incident.workerVersion = randomUUID();
    other.lineage.incidentKey = deriveIncidentKey(other.observation.incident); other.lineage.eventFingerprint = deriveObservationFingerprint(other.observation);
    if (cap === "incident") { await ledger.transition({ runId: legacy.lineage.runId, transition: terminal() }, now); other.observation = legacy.observation; other.lineage = { ...legacy.lineage, runId: randomUUID(), parentRunId: legacy.lineage.runId as never, attempt: 2 }; }
    await expect(ledger.reserve(other, now)).rejects.toThrow("RSI_LEDGER_BUDGET");
  });
  it("carries mixed pending exposure across KST month and charges confirmed cost in reservation and settlement periods", async () => {
    const before = "2026-10-31T14:59:00.000Z", after = "2026-10-31T15:00:00.000Z";
    const { ledger } = await createImprovement({ incident: 500000, campaign: 500000, day: 73552, month: 73552 });
    const input = await improvement(ledger, observation(before));
    await ledger.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, before);
    const other = intent(1, observation(after));
    await expect(ledger.reserve(other, after)).rejects.toThrow("RSI_LEDGER_BUDGET");
    await settleImprovement(ledger, input.executionId, "CONFIRMED", 0, after);
    expect((await ledger.reserve(other, after)).authorized).toBe(true);
    const row = (await ledger.readImprovement()).executions[0];
    expect(row.day).toBe("2026-10-31"); expect(row.settlement?.day).toBe("2026-11-01");
  });
  it("rejects mixed safe-integer overflow and cross-purpose IDs including aliases and receipts", async () => {
    const caps = { incident: Number.MAX_SAFE_INTEGER, campaign: Number.MAX_SAFE_INTEGER, day: Number.MAX_SAFE_INTEGER, month: Number.MAX_SAFE_INTEGER };
    const { ledger, input } = await createImprovement(caps), legacy = intent(Number.MAX_SAFE_INTEGER, input.observation);
    await ledger.reserve(legacy, now);
    await expect(ledger.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, now)).rejects.toThrow("RSI_LEDGER_BUDGET");
    await ledger.settle({ runId: legacy.lineage.runId, receiptId: randomUUID(), kind: "CONFIRMED", chargedUnits: 0, receiptDigest: digest }, now);
    for (const value of [legacy.requestId, legacy.lineage.runId, (await ledger.read()).runs[0].settlement!.receiptId]) {
      await expect(ledger.reserveImprovement({ intent: { ...input, executionId: value }, maximumCostUnits: 73552 }, now)).rejects.toThrow("RSI_LEDGER");
    }
    await ledger.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, now);
    await expect(ledger.reserve({ ...intent(), requestId: input.executionId }, now)).rejects.toThrow("RSI_LEDGER");
    await expect(settleImprovement(ledger, input.executionId, "CONFIRMED", 0, now, legacy.requestId)).rejects.toThrow("RSI_LEDGER");
    await expect(ledger.settle({ runId: legacy.lineage.runId, receiptId: input.executionId, kind: "CONFIRMED", chargedUnits: 0, receiptDigest: digest }, now)).rejects.toThrow("RSI_LEDGER");
  });
  it("requires validated, confirmed promotion and a fresh exact checkpoint session for generation two", async () => {
    const { ledger, input, p } = await createImprovement(); await validated(ledger, input);
    await expect(promote(ledger, input)).rejects.toThrow("RSI_LEDGER");
    await settleImprovement(ledger, input.executionId); await promote(ledger, input);
    const next = { ...await improvement(ledger, input.observation), generation: 2 as const, parentExecutionId: input.executionId };
    await expect(ledger.reserveImprovement({ intent: next, maximumCostUnits: 73552 }, now)).rejects.toThrow("RSI_LEDGER");
    const reopened = await LocalRsiLedger.open(p, ledger.checkpoint);
    for (const bad of [{ ...next, parentExecutionId: randomUUID() }, { ...next, activeCompiledDigest: digest }, { ...next, memorySnapshotHash: "c".repeat(64) }]) {
      await expect(reopened.reserveImprovement({ intent: bad, maximumCostUnits: 73552 }, now)).rejects.toThrow("RSI_LEDGER");
    }
    await validated(reopened, next, artifact("c")); await settleImprovement(reopened, next.executionId, "CONFIRMED", 3); await promote(reopened, next);
    expect((await reopened.read()).runs).toHaveLength(0);
    expect((await reopened.readImprovement()).executions.map(e => e.status)).toEqual(["PROMOTED", "PROMOTED"]);
    await expect(reopened.reserveImprovement({ intent: { ...next, generation: 3 }, maximumCostUnits: 73552 }, now)).rejects.toThrow("RSI_LEDGER");
  });
  it("uses append-only rollback to the immediate previously verified catalog and preserves costs", async () => {
    const { ledger, input } = await createImprovement();
    const seedCatalog = (await ledger.readImprovement()).catalog[0];
    await expect(ledger.commitLabCatalog({ kind: "ROLLBACK", expectedCatalogRevision: 0, expectedCatalogHash: seedCatalog.hash, targetCatalogRevision: 0, targetCatalogHash: seedCatalog.hash, reasonCode: "FOLLOWUP_FAILED" }, now)).rejects.toThrow("RSI_LEDGER");
    await validated(ledger, input); await settleImprovement(ledger, input.executionId); await promote(ledger, input);
    const current = (await ledger.readImprovement()).catalog.at(-1)!;
    const rollback = { kind: "ROLLBACK", expectedCatalogRevision: current.revision, expectedCatalogHash: current.hash, targetCatalogRevision: 0, targetCatalogHash: seedCatalog.hash, reasonCode: "FOLLOWUP_FAILED" };
    await expect(ledger.commitLabCatalog({ ...rollback, targetCatalogHash: digest }, now)).rejects.toThrow("RSI_LEDGER");
    await ledger.commitLabCatalog(rollback, now);
    const state = await ledger.readImprovement(); expect(state.catalog.at(-1)?.source).toEqual(artifact());
    expect(state.catalog.map(c => c.kind)).toEqual(["SEED", "PROMOTE", "ROLLBACK"]);
    expect(state.executions[0].settlement?.consumedUnits).toBe(5);
  });
  it("rejects extra proposals, unchanged source, unbound generation receipts and closure swaps", async () => {
    const { ledger, input } = await createImprovement(); await validated(ledger, input);
    const row = (await ledger.readImprovement()).executions[0], event = row.events.find(e => e.kind === "PROPOSED")!;
    for (const bad of [event, { kind: "VALIDATED", binding: { ...validation(input), controllerHash: "b".repeat(64) } }]) {
      await expect(ledger.recordImprovementEvent({ executionId: input.executionId, event: bad }, now)).rejects.toThrow("RSI_LEDGER");
    }
    await settleImprovement(ledger, input.executionId, "AMBIGUOUS"); await expect(promote(ledger, input)).rejects.toThrow("RSI_LEDGER");
  });
  it("fails closed on R4 writer races, stale heads and partial writes without rewriting events", async () => {
    const { p, ledger, input } = await createImprovement(), other = await LocalRsiLedger.open(p, ledger.checkpoint);
    const results = await Promise.allSettled([ledger.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, now), other.reserveImprovement({ intent: input, maximumCostUnits: 73552 }, now)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const winner = results[0].status === "fulfilled" ? ledger : other;
    await writeFile(join(p, ".pending"), "partial");
    await expect(LocalRsiLedger.open(p, winner.checkpoint)).rejects.toThrow("RSI_LEDGER");
  });
  it("rejects active objects without invoking accessors/proxies and verifies derived context", async () => {
    const { ledger, input } = await createImprovement(); let executed = 0;
    const trap = () => { executed++; throw new Error("must not run"); };
    for (const bad of [new Proxy(input, { get: trap, getPrototypeOf: trap, ownKeys: trap }), Object.defineProperty({ ...input }, "private", { get: trap, enumerable: true }),
      { ...input, incidentKey: "b".repeat(64) }, { ...input, observationFingerprint: "b".repeat(64) }, { ...input, baseAppSha: "b".repeat(40) }, { ...input, proposalAgentHash: digest }]) {
      expect(() => parseImprovementIntent(bad)).toThrow("RSI_INVALID_EXECUTION_CONTRACT");
    }
    expect(executed).toBe(0);
  });
});
